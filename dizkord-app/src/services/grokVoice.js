/**
 * Grok Voice Agent — Eve (group-aware).
 * Connects to xAI Realtime API via WebSocket from the browser.
 *
 * AUDIO ROUTING:
 *   Eve playback → eveGain → pipelineDest (broadcast to all peers via WebRTC)
 *                           → audioContext.destination (local speakers for summoner)
 *
 *   Capture (what Eve hears):
 *     captureStream (mic-only, NO Eve feedback) → mixerGain
 *     remoteStreams (all peers)                 → mixerGain → captureProcessor → PCM16 → xAI WebSocket
 *
 * Uses ephemeral token from Cloud Function for auth.
 * Subscribes to voiceStore for remote stream changes (peers joining/leaving).
 */
import { getFunctions, httpsCallable } from 'firebase/functions'
import { doc, deleteDoc } from 'firebase/firestore'
import { db, auth } from '../config/firebase'
import { useVoiceStore } from '../stores/voiceStore'
import { getVoiceAudioContext, getVoicePipelineDest, getVoiceCaptureStream, onVoiceStop } from './webrtc'

const XAI_REALTIME_URL = 'wss://api.x.ai/v1/realtime'
const SAMPLE_RATE = 48000
const CHUNK_SIZE = 4096

let ws = null
let active = false
let onTranscriptCb = null
let sessionCollectionId = null
let transcriptEntries = []  // accumulated transcript for this session

// Eve playback
let eveGain = null
let playbackQueue = []
let isPlaying = false
let currentPlaybackSource = null

// Capture mixer (all voices → xAI)
let mixerGain = null
let captureProcessor = null
let silentOutput = null
let localSource = null
let remoteSources = {}  // { peerId: MediaStreamSourceNode }

// voiceStore subscription
let storeUnsub = null
let lastLocalStreamRef = null

// pagehide cleanup for Eve (summoner tab close)
let evePagehideHandler = null

// --- PCM16 ↔ Float32 ↔ Base64 ---

function float32ToPCM16Base64(float32) {
  const pcm16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
  }
  const bytes = new Uint8Array(pcm16.buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64PCM16ToFloat32(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const pcm16 = new Int16Array(bytes.buffer)
  const float32 = new Float32Array(pcm16.length)
  for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0
  return float32
}

// --- Eve audio playback (queued, through voice AudioContext) ---

function playAudioChunk(base64Audio) {
  if (!active || !eveGain) return
  const ctx = getVoiceAudioContext()
  if (!ctx) return
  const float32 = base64PCM16ToFloat32(base64Audio)
  playbackQueue.push(float32)
  if (!isPlaying) { isPlaying = true; drainQueue() }
}

function drainQueue() {
  const ctx = getVoiceAudioContext()
  if (!ctx || playbackQueue.length === 0 || !eveGain) {
    isPlaying = false
    currentPlaybackSource = null
    return
  }
  const chunk = playbackQueue.shift()
  const buffer = ctx.createBuffer(1, chunk.length, SAMPLE_RATE)
  buffer.copyToChannel(chunk, 0)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(eveGain)
  currentPlaybackSource = src
  src.onended = () => {
    if (currentPlaybackSource === src) currentPlaybackSource = null
    drainQueue()
  }
  src.start()
}

function stopPlayback() {
  if (currentPlaybackSource) {
    try { currentPlaybackSource.stop(); currentPlaybackSource.disconnect() } catch { /* ok */ }
    currentPlaybackSource = null
  }
  playbackQueue = []
  isPlaying = false
}

// --- Capture mixer: all participants' audio → xAI ---

function setupMixer() {
  const ctx = getVoiceAudioContext()
  if (!ctx) return

  mixerGain = ctx.createGain()
  mixerGain.gain.value = 1.0

  captureProcessor = ctx.createScriptProcessor(CHUNK_SIZE, 1, 1)
  mixerGain.connect(captureProcessor)

  // processor must be in audio graph to run; route output to silent gain to prevent echo
  silentOutput = ctx.createGain()
  silentOutput.gain.value = 0
  captureProcessor.connect(silentOutput)
  silentOutput.connect(ctx.destination)

  // connect summoner's mic-only capture stream (NOT processedStream, which has Eve mixed in)
  const micCapture = getVoiceCaptureStream()
  if (micCapture) {
    try {
      localSource = ctx.createMediaStreamSource(micCapture)
      localSource.connect(mixerGain)
      lastLocalStreamRef = useVoiceStore.getState().localStream // track for change detection
      console.log('[grok-voice] mixer: mic capture connected (no Eve feedback)')
    } catch (err) {
      console.warn('[grok-voice] mixer: mic capture failed:', err.message)
    }
  }

  // connect all remote peer streams
  syncRemoteStreams(useVoiceStore.getState().remoteStreams)
}

function syncRemoteStreams(remoteStreams) {
  const ctx = getVoiceAudioContext()
  if (!ctx || !mixerGain) return
  const streams = remoteStreams || {}

  // add new peers
  for (const [peerId, stream] of Object.entries(streams)) {
    if (!remoteSources[peerId]) {
      try {
        const src = ctx.createMediaStreamSource(stream)
        src.connect(mixerGain)
        remoteSources[peerId] = src
        console.log('[grok-voice] mixer: +', peerId.slice(0, 8))
      } catch { /* stream may have ended */ }
    }
  }

  // remove departed peers
  for (const peerId of Object.keys(remoteSources)) {
    if (!streams[peerId]) {
      try { remoteSources[peerId].disconnect() } catch { /* ok */ }
      delete remoteSources[peerId]
      console.log('[grok-voice] mixer: -', peerId.slice(0, 8))
    }
  }
}

function handleLocalStreamChange(newStream) {
  const ctx = getVoiceAudioContext()
  if (!ctx || !mixerGain) return

  if (localSource) {
    try { localSource.disconnect() } catch { /* ok */ }
    localSource = null
  }
  // Use the mic-only capture stream, not processedStream (avoids Eve feedback)
  const micCapture = getVoiceCaptureStream()
  if (micCapture) {
    try {
      localSource = ctx.createMediaStreamSource(micCapture)
      localSource.connect(mixerGain)
      lastLocalStreamRef = newStream // track voiceStore's localStream for change detection
      console.log('[grok-voice] mixer: mic capture reconnected (device switch)')
    } catch (err) {
      console.warn('[grok-voice] mixer: mic capture reconnect failed:', err.message)
    }
  }

  // pipeline dest changed too — reconnect Eve broadcast
  reconnectEveToDest()
}

function reconnectEveToDest() {
  if (!eveGain || !active) return
  const ctx = getVoiceAudioContext()
  const dest = getVoicePipelineDest()
  if (!ctx) return

  try { eveGain.disconnect() } catch { /* ok */ }
  eveGain.connect(ctx.destination) // local speakers
  if (dest) eveGain.connect(dest)  // broadcast to peers
  console.log('[grok-voice] Eve broadcast reconnected to new pipeline dest')
}

// --- voiceStore subscription (react to peer/stream changes) ---

function startStoreSubscription() {
  storeUnsub = useVoiceStore.subscribe((state) => {
    if (!active) return
    syncRemoteStreams(state.remoteStreams)
    if (state.localStream && state.localStream !== lastLocalStreamRef) {
      handleLocalStreamChange(state.localStream)
    }
  })
}

// --- Cleanup ---

function cleanup() {
  active = false
  stopPlayback()

  // Unregister voice-stop callback (prevent double-call if cleanup triggered by voice stop)
  onVoiceStop(null)

  // Remove pagehide listener
  if (evePagehideHandler) {
    window.removeEventListener('pagehide', evePagehideHandler)
    window.removeEventListener('beforeunload', evePagehideHandler)
    evePagehideHandler = null
  }

  if (storeUnsub) { storeUnsub(); storeUnsub = null }
  if (captureProcessor) { captureProcessor.onaudioprocess = null; captureProcessor.disconnect(); captureProcessor = null }
  if (silentOutput) { silentOutput.disconnect(); silentOutput = null }
  if (localSource) { try { localSource.disconnect() } catch { /* ok */ }; localSource = null }
  for (const src of Object.values(remoteSources)) { try { src.disconnect() } catch { /* ok */ } }
  remoteSources = {}
  if (mixerGain) { mixerGain.disconnect(); mixerGain = null }
  if (eveGain) { try { eveGain.disconnect() } catch { /* ok */ }; eveGain = null }
  lastLocalStreamRef = null
  onTranscriptCb = null
}

// --- Public API ---

/**
 * Start a Grok Voice Agent session.
 * Voice must be active (AudioContext + pipeline running).
 * Eve hears all participants and broadcasts her audio to all peers.
 * @param {function} onTranscript — optional callback: { role, text, done }
 */
export async function startGrokVoice(onTranscript) {
  if (active) return
  active = true
  onTranscriptCb = onTranscript || null
  playbackQueue = []
  isPlaying = false
  console.log('[grok-voice] starting...')

  const ctx = getVoiceAudioContext()
  const dest = getVoicePipelineDest()
  if (!ctx) {
    console.error('[grok-voice] no voice AudioContext — voice must be active')
    active = false
    throw new Error('Join voice before summoning Eve')
  }

  const { voiceGroupId: groupId, voiceChannelId: channelId } = useVoiceStore.getState()
  let token
  sessionCollectionId = null
  transcriptEntries = []

  // 0. Claim Eve's presence (enforces single-channel, writes to Firestore via Admin SDK)
  try {
    const presenceFn = httpsCallable(getFunctions(), 'manageEvePresence')
    await presenceFn({ groupId, channelId, action: 'join' })
    console.log('[grok-voice] Eve presence claimed in channel')
  } catch (err) {
    console.error('[grok-voice] presence claim failed:', err.message)
    active = false
    throw err
  }

  // Register voice-stop callback so Eve is torn down before AudioContext closes
  onVoiceStop(() => stopGrokVoice())

  // Register pagehide handler so Eve is cleaned up if summoner's tab closes
  evePagehideHandler = () => {
    // Direct Firestore deletes (fire-and-forget, works in pagehide)
    deleteDoc(doc(db, 'groups', groupId, 'channels', channelId, 'voicePresence', 'eve')).catch(() => {})
    deleteDoc(doc(db, 'groups', groupId, '_meta', 'eve')).catch(() => {})
  }
  window.addEventListener('pagehide', evePagehideHandler)
  window.addEventListener('beforeunload', evePagehideHandler)

  // 1. Get ephemeral token + sync group history to xAI collection (parallel)
  const tokenPromise = (async () => {
    const fn = httpsCallable(getFunctions(), 'getGrokVoiceToken')
    const { data } = await fn()
    console.log('[grok-voice] token response keys:', data ? Object.keys(data) : 'null')
    if (!data?.client_secret?.value) {
      throw new Error('No token in response: ' + JSON.stringify(data).slice(0, 200))
    }
    console.log('[grok-voice] ephemeral token acquired')
    return data.client_secret.value
  })()

  const syncPromise = groupId ? (async () => {
    try {
      const fn = httpsCallable(getFunctions(), 'syncGroupToCollection')
      const { data } = await fn({ groupId })
      sessionCollectionId = data?.collectionId || null
      console.log('[grok-voice] collection synced:', data?.collectionId?.slice(0, 20), '| new docs:', data?.newDocsSynced)
      return data?.collectionId
    } catch (err) {
      console.warn('[grok-voice] collection sync failed (non-fatal):', err.message)
      return null
    }
  })() : Promise.resolve(null)

  try {
    const [tokenResult] = await Promise.all([tokenPromise, syncPromise])
    token = tokenResult
  } catch (err) {
    console.error('[grok-voice] token fetch failed:', err.message)
    // Clean up the presence we claimed
    httpsCallable(getFunctions(), 'manageEvePresence')({ groupId, channelId, action: 'leave' }).catch(() => {})
    active = false
    throw err
  }

  // 2. Setup Eve's audio output: gain → local speakers + pipeline dest (broadcast)
  eveGain = ctx.createGain()
  eveGain.gain.value = 1.0
  eveGain.connect(ctx.destination)
  if (dest) eveGain.connect(dest)
  console.log('[grok-voice] Eve output: speakers + pipeline broadcast')

  // 3. Setup capture mixer (local mic + all remote streams → xAI)
  setupMixer()
  startStoreSubscription()

  // 4. Connect WebSocket with ephemeral token
  ws = new WebSocket(XAI_REALTIME_URL, [
    'realtime',
    `openai-insecure-api-key.${token}`,
    'openai-beta.realtime-v1',
  ])

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket timeout')), 10000)
    ws.onopen = () => {
      clearTimeout(timer)
      console.log('[grok-voice] WebSocket connected')

      // Build tools list — always web search, add file_search if we have a collection
      const tools = [{ type: 'web_search' }]
      if (sessionCollectionId) {
        tools.push({
          type: 'file_search',
          vector_store_ids: [sessionCollectionId],
          max_num_results: 10,
        })
        console.log('[grok-voice] file_search enabled with collection:', sessionCollectionId.slice(0, 20))
      }

      // Send session config immediately on open (per xAI docs)
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          voice: 'Eve',
          instructions: `You are Eve, a fun and witty AI companion hanging out in a friend group voice chat called DizKord. You can hear everyone in the voice channel — multiple people may talk. Keep responses concise, 1-2 sentences max unless asked for more. Be sassy, playful, authentic. Roast gently if asked. Give real answers but keep it brief and conversational.${sessionCollectionId ? ' You have access to this group\'s chat history and past Eve session transcripts via file search. If someone asks about past conversations, use file_search to look them up. Don\'t mention the tool by name, just naturally reference what was said.' : ''}`,
          turn_detection: { type: 'server_vad' },
          tools,
          audio: {
            input: { format: { type: 'audio/pcm', rate: SAMPLE_RATE } },
            output: { format: { type: 'audio/pcm', rate: SAMPLE_RATE } },
          },
        },
      }))

      resolve()
    }
    ws.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket connection failed')) }
  })

  let sessionConfigured = false

  ws.onmessage = (event) => {
    let msg
    try { msg = JSON.parse(event.data) } catch { return }

    // Session configured → start capture + greeting
    if (msg.type === 'session.updated' && !sessionConfigured) {
      sessionConfigured = true
      console.log('[grok-voice] session configured, starting capture for all participants')

      // Start streaming mixed audio to xAI
      if (captureProcessor) {
        captureProcessor.onaudioprocess = (e) => {
          if (!active || !ws || ws.readyState !== WebSocket.OPEN || !sessionConfigured) return
          const float32 = e.inputBuffer.getChannelData(0)
          e.outputBuffer.getChannelData(0).fill(0) // silence output to prevent echo
          ws.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: float32ToPCM16Base64(float32),
          }))
        }
      }

      // Send greeting prompt
      ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message', role: 'user',
          content: [{ type: 'input_text', text: 'Hey Eve, you just joined our voice chat. Say hi briefly.' }],
        },
      }))
      ws.send(JSON.stringify({ type: 'response.create' }))
    }

    // Audio response → queue for playback (local + broadcast)
    if (msg.type === 'response.audio.delta' && msg.delta) {
      playAudioChunk(msg.delta)
      useVoiceStore.getState().setSpeaking('eve', true)
    }
    // Also handle the OpenAI-compatible event name
    if (msg.type === 'response.output_audio.delta' && msg.delta) {
      playAudioChunk(msg.delta)
      useVoiceStore.getState().setSpeaking('eve', true)
    }

    // User interrupted → stop current playback, Eve stops speaking
    if (msg.type === 'input_audio_buffer.speech_started') {
      stopPlayback()
      useVoiceStore.getState().setSpeaking('eve', false)
    }

    // Transcript of Eve's speech (accumulate for storage + UI callback)
    if (msg.type === 'response.audio_transcript.delta' && msg.delta) {
      if (onTranscriptCb) onTranscriptCb({ role: 'assistant', text: msg.delta, done: false })
    }
    if (msg.type === 'response.output_audio_transcript.delta' && msg.delta) {
      if (onTranscriptCb) onTranscriptCb({ role: 'assistant', text: msg.delta, done: false })
    }
    if (msg.type === 'response.done') {
      useVoiceStore.getState().setSpeaking('eve', false)
      if (onTranscriptCb) onTranscriptCb({ role: 'assistant', text: '', done: true })
      // Accumulate full Eve response for transcript storage
      const output = msg.response?.output
      if (output) {
        for (const item of output) {
          if (item.type === 'message' && item.content) {
            for (const c of item.content) {
              if (c.transcript) transcriptEntries.push({ role: 'Eve', text: c.transcript })
            }
          }
        }
      }
    }

    // Transcript of user's speech
    if (msg.type === 'conversation.item.input_audio_transcription.completed' && msg.transcript) {
      transcriptEntries.push({ role: 'user', text: msg.transcript })
      if (onTranscriptCb) onTranscriptCb({ role: 'user', text: msg.transcript, done: true })
    }
    if (msg.type === 'conversation.item.added' && msg.item?.role === 'user' && msg.item?.content) {
      for (const c of msg.item.content) {
        if (c.type === 'input_audio' && c.transcript) {
          transcriptEntries.push({ role: 'user', text: c.transcript })
          if (onTranscriptCb) onTranscriptCb({ role: 'user', text: c.transcript, done: true })
        }
      }
    }

    // Log unexpected errors from xAI
    if (msg.type === 'error') {
      console.error('[grok-voice] xAI error:', msg.error?.message || JSON.stringify(msg))
    }
  }

  ws.onclose = (e) => {
    console.log('[grok-voice] WebSocket closed:', e.code, e.reason || '')
    cleanup()
  }
  ws.onerror = () => console.error('[grok-voice] WebSocket error')
}

export function stopGrokVoice() {
  console.log('[grok-voice] stopping...')

  const { voiceGroupId: groupId } = useVoiceStore.getState()

  // Clear Eve's speaking state
  useVoiceStore.getState().setSpeaking('eve', false)

  // Remove Eve's voice presence
  if (groupId) {
    httpsCallable(getFunctions(), 'manageEvePresence')({ groupId, action: 'leave' })
      .then(() => console.log('[grok-voice] Eve presence removed'))
      .catch(err => console.warn('[grok-voice] Eve presence cleanup failed:', err.message))
  }

  // Save transcript via Cloud Function, then sync to xAI collection immediately.
  // Chained (not parallel) so the transcript is in Firestore before sync queries it.
  // Fire-and-forget — does not block UI.
  if (groupId && transcriptEntries.length > 0) {
    const displayName = auth.currentUser?.displayName || 'unknown'
    let text = `# Eve Voice Session Transcript\n`
    text += `# Summoned by: ${displayName}\n`
    text += `# Date: ${new Date().toISOString()}\n\n`
    for (const entry of transcriptEntries) {
      text += `[${entry.role}]: ${entry.text}\n`
    }
    const saveFn = httpsCallable(getFunctions(), 'saveEveTranscript')
    const syncFn = httpsCallable(getFunctions(), 'syncGroupToCollection')
    saveFn({ groupId, text, entryCount: transcriptEntries.length })
      .then(() => {
        console.log('[grok-voice] transcript saved → syncing to collection...')
        return syncFn({ groupId })
      })
      .then((res) => console.log('[grok-voice] post-dismiss sync done, new docs:', res?.data?.newDocsSynced ?? '?'))
      .catch(err => console.warn('[grok-voice] transcript save/sync failed:', err.message))
  } else if (groupId) {
    // No transcript but still sync any pending messages/transcripts from other sessions
    const syncFn = httpsCallable(getFunctions(), 'syncGroupToCollection')
    syncFn({ groupId })
      .then((res) => console.log('[grok-voice] post-dismiss sync done, new docs:', res?.data?.newDocsSynced ?? '?'))
      .catch(err => console.warn('[grok-voice] post-dismiss sync failed:', err.message))
  }

  transcriptEntries = []
  sessionCollectionId = null
  if (ws && ws.readyState === WebSocket.OPEN) ws.close()
  ws = null
  cleanup()
}

export function isGrokVoiceActive() {
  return active
}
