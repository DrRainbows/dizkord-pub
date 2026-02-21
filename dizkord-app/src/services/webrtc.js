/**
 * DizKord WebRTC Voice Engine
 * Mesh topology, Firestore signaling, screen sharing with explicit renegotiation.
 */
import {
  collection, doc, deleteDoc, onSnapshot, addDoc, updateDoc
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db, auth } from '../config/firebase'
import { useVoiceStore } from '../stores/voiceStore'
import { createAudioPipeline, createSpeakingDetector, resetWorkletState, playStreamLiveSound, playStreamEndSound } from './audio'

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

// Dynamic ICE servers including TURN (fetched from Cloud Function, cached 1hr)
let ICE_SERVERS = [...STUN_SERVERS]
let turnCacheExpiry = 0

async function fetchTurnCredentials() {
  // cache for 1 hour (credentials valid 24hrs, refresh well before expiry)
  if (Date.now() < turnCacheExpiry && ICE_SERVERS.length > STUN_SERVERS.length) {
    console.log('[voice] using cached TURN credentials')
    return
  }
  try {
    const functions = getFunctions()
    const fn = httpsCallable(functions, 'getTurnCredentials')
    const result = await fn({})
    const turnServers = result.data?.iceServers || []
    if (turnServers.length > 0) {
      ICE_SERVERS = [...STUN_SERVERS, ...turnServers]
      turnCacheExpiry = Date.now() + 3600000 // 1 hour
      console.log('[voice] TURN credentials fetched:', turnServers.length, 'servers')
    } else {
      ICE_SERVERS = [...STUN_SERVERS]
      console.warn('[voice] no TURN servers returned, STUN only')
    }
  } catch (err) {
    console.error('[voice] TURN credential fetch failed:', err.message, '- using STUN only')
    ICE_SERVERS = [...STUN_SERVERS]
  }
}

const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_DELAY_MS = 2000

let signalingUnsub = null
let audioContext = null
let currentRawStream = null
let pipelineDest = null    // MediaStreamDestination — Eve connects here to broadcast
let micMuteGain = null     // GainNode for mic mute (separate from VAD gate)
let captureStream = null   // mic-only stream for Eve's mixer (no Eve feedback)
let _onVoiceStopCb = null  // callback invoked BEFORE voice teardown (used by grokVoice)
const speakingDetectors = {}
let localSpeakingDetector = null
// per-peer ICE candidate queue: buffer candidates until remote description is set
const pendingIceCandidates = {}
let switchingDevice = false // guard for switchInputDevice concurrency

async function flushIceCandidates(peerId, pc) {
  const queued = pendingIceCandidates[peerId]
  if (!queued || queued.length === 0) return
  console.log('[voice] flushing', queued.length, 'queued ICE candidates for', peerId.slice(0, 8))
  for (const candidate of queued) {
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) }
    catch (err) { console.warn('[voice] queued ICE failed:', err.message) }
  }
  delete pendingIceCandidates[peerId]
}
const reconnectAttempts = {}
const reconnectTimers = {}
let activeGroupId = null
let activeChannelId = null
let voiceActive = false // guard against post-teardown operations

function setupAudioResilience(ctx) {
  const resume = () => { if (ctx.state === 'suspended') ctx.resume() }
  document.addEventListener('visibilitychange', resume)
  document.addEventListener('click', resume)
  document.addEventListener('keydown', resume)
  const interval = setInterval(resume, 3000)
  return () => {
    document.removeEventListener('visibilitychange', resume)
    document.removeEventListener('click', resume)
    document.removeEventListener('keydown', resume)
    clearInterval(interval)
  }
}

let cleanupResilience = null

async function acquireMic(deviceId) {
  const base = { echoCancellation: true, noiseSuppression: false, autoGainControl: true, channelCount: 1, sampleRate: 48000 }
  // try the requested device first, fall back to default if it fails (stale device ID from another machine)
  if (deviceId) {
    try {
      console.log('[voice] requesting mic access device:', deviceId.slice(0, 8))
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: deviceId } }, video: false })
      const track = stream.getAudioTracks()[0]
      console.log('[voice] mic acquired:', track.label, `(${track.getSettings().deviceId?.slice(0, 8)})`)
      return stream
    } catch (err) {
      console.warn('[voice] requested device failed:', err.name || err.message, '- falling back to default mic')
    }
  }
  console.log('[voice] requesting mic access (default)')
  const stream = await navigator.mediaDevices.getUserMedia({ audio: base, video: false })
  const track = stream.getAudioTracks()[0]
  console.log('[voice] mic acquired:', track.label, `(${track.getSettings().deviceId?.slice(0, 8)})`)
  return stream
}

/**
 * Send a renegotiation offer to a specific peer.
 * Used after addTrack/removeTrack to inform the remote end about track changes.
 */
async function sendRenegotiationOffer(peerId, pc, sigRef) {
  if (!voiceActive) return
  const uid = auth.currentUser?.uid
  try {
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await addDoc(sigRef, { type: 'offer', from: uid, to: peerId, sdp: offer.sdp })
    console.log('[voice] renegotiation offer sent to', peerId.slice(0, 8))
  } catch (err) {
    console.error('[voice] renegotiation failed for', peerId.slice(0, 8), ':', err.message)
  }
}

export async function startVoice(groupId, channelId) {
  if (voiceActive) {
    console.warn('[voice] startVoice called while already active, ignoring')
    return false
  }
  const store = useVoiceStore.getState()
  const uid = auth.currentUser?.uid
  if (!uid) return false

  console.log('[voice] === STARTING VOICE ===', { groupId: groupId.slice(0, 8), channelId: channelId.slice(0, 8), uid: uid.slice(0, 8) })

  activeGroupId = groupId
  activeChannelId = channelId
  voiceActive = true

  // fetch TURN credentials before mic access (non-blocking if fails)
  await fetchTurnCredentials()

  let rawStream
  try {
    rawStream = await acquireMic(store.selectedInput)
  } catch (err) {
    console.error('[voice] mic access failed:', err.message)
    useVoiceStore.setState({ error: 'mic access denied: ' + err.message })
    voiceActive = false
    return false
  }
  currentRawStream = rawStream
  store.enumerateDevices()

  audioContext = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
  cleanupResilience = setupAudioResilience(audioContext)
  console.log('[voice] AudioContext created, state:', audioContext.state)

  let processedStream, gateNode, vadAnalyser
  try {
    const result = await createAudioPipeline(audioContext, rawStream)
    processedStream = result.stream
    gateNode = result.gateNode
    vadAnalyser = result.vadAnalyser
    pipelineDest = result.dest
    micMuteGain = result.muteGain
    captureStream = result.captureStream
  } catch (err) {
    console.error('[voice] audio pipeline failed:', err.message)
    useVoiceStore.setState({ error: 'audio pipeline failed: ' + err.message })
    rawStream.getTracks().forEach(t => t.stop())
    audioContext.close(); audioContext = null
    voiceActive = false
    return false
  }

  localSpeakingDetector = createSpeakingDetector(audioContext, vadAnalyser, (speaking) => {
    const state = useVoiceStore.getState()
    if (state.isMuted || state.isDeafened) { state.setSpeaking(uid, false); return }
    state.setSpeaking(uid, speaking)
  }, { gateNode, getThreshold: () => useVoiceStore.getState().vadThreshold })

  // register mute callback so toggleMute uses gain node instead of track.enabled
  // (preserves Eve's audio broadcast when mic is muted)
  useVoiceStore.getState().registerMuteCallback((muted) => {
    if (micMuteGain) micMuteGain.gain.value = muted ? 0 : 1
  })

  useVoiceStore.setState({ localStream: processedStream })
  listenSignaling(groupId, channelId)
  console.log('[voice] signaling listeners active')
  return true
}

export async function switchInputDevice(deviceId) {
  if (switchingDevice) { console.warn('[voice] device switch already in progress'); return }
  const store = useVoiceStore.getState()
  if (!store.inVoice || !audioContext) return
  switchingDevice = true
  try {
    let newRawStream
    try { newRawStream = await acquireMic(deviceId) }
    catch (err) { console.error('[voice] device switch failed:', err.message); return }

    if (currentRawStream) currentRawStream.getTracks().forEach(t => t.stop())
    currentRawStream = newRawStream
    if (store.localStream) store.localStream.getTracks().forEach(t => t.stop())

    const pipelineResult = await createAudioPipeline(audioContext, newRawStream)
    const { stream: processedStream, gateNode, vadAnalyser } = pipelineResult
    pipelineDest = pipelineResult.dest
    micMuteGain = pipelineResult.muteGain
    captureStream = pipelineResult.captureStream
    // re-register mute callback with new gain node
    useVoiceStore.getState().registerMuteCallback((muted) => {
      if (micMuteGain) micMuteGain.gain.value = muted ? 0 : 1
    })
    // apply current mute state to new muteGain
    if (useVoiceStore.getState().isMuted && micMuteGain) micMuteGain.gain.value = 0
    if (localSpeakingDetector) localSpeakingDetector.stop()
    const uid = auth.currentUser?.uid
    localSpeakingDetector = createSpeakingDetector(audioContext, vadAnalyser, (speaking) => {
      const state = useVoiceStore.getState()
      if (state.isMuted || state.isDeafened) { state.setSpeaking(uid, false); return }
      state.setSpeaking(uid, speaking)
    }, { gateNode, getThreshold: () => useVoiceStore.getState().vadThreshold })

    const newTrack = processedStream.getAudioTracks()[0]
    for (const [peerId, pc] of Object.entries(store.peerConnections)) {
      const sender = pc.getSenders().find(s => s.track?.kind === 'audio')
      if (sender) { await sender.replaceTrack(newTrack); console.log('[voice] replaced audio track for', peerId.slice(0, 8)) }
    }
    useVoiceStore.setState({ localStream: processedStream })
  } finally {
    switchingDevice = false
  }
}

function listenSignaling(groupId, channelId) {
  const uid = auth.currentUser?.uid
  const sigRef = collection(db, 'groups', groupId, 'channels', channelId, 'signaling')
  const presRef = collection(db, 'groups', groupId, 'channels', channelId, 'voicePresence')

  const unsubPres = onSnapshot(presRef, async (snap) => {
    if (!voiceActive) return
    const users = snap.docs.map(d => d.data())
    // Filter out self AND Eve (bot presence, not a real WebRTC peer)
    const otherUsers = users.filter(u => u.uid !== uid && u.uid !== 'eve' && !u.isBot)
    const store = useVoiceStore.getState()

    console.log('[voice] presence:', otherUsers.length, 'others:', otherUsers.map(u => u.displayName))

    for (const user of otherUsers) {
      if (!store.peerConnections[user.uid]) {
        const isOfferer = uid < user.uid
        if (isOfferer) {
          const currentStream = useVoiceStore.getState().localStream
          await createPeerConnection(user.uid, currentStream, groupId, channelId, true)
        }
      }
    }

    for (const peerId of Object.keys(store.peerConnections)) {
      if (!otherUsers.find(u => u.uid === peerId)) {
        console.log('[voice] peer left:', peerId.slice(0, 8))
        removePeer(peerId)
      }
    }
  })

  signalingUnsub = onSnapshot(sigRef, async (snap) => {
    if (!voiceActive) return
    for (const change of snap.docChanges()) {
      if (change.type !== 'added') continue
      const data = change.doc.data()
      if (data.to !== uid) continue

      const store = useVoiceStore.getState()

      try {
        if (data.type === 'offer') {
          const existingPc = store.peerConnections[data.from]
          if (existingPc && existingPc.connectionState !== 'closed') {
            console.log('[voice] renegotiation offer from', data.from.slice(0, 8))
            await existingPc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }))
            await flushIceCandidates(data.from, existingPc)
            const answer = await existingPc.createAnswer()
            await existingPc.setLocalDescription(answer)
            await addDoc(sigRef, { type: 'answer', from: uid, to: data.from, sdp: answer.sdp })
          } else {
            const currentStream = store.localStream
            await createPeerConnection(data.from, currentStream, groupId, channelId, false, data.sdp)
          }
        } else if (data.type === 'answer' && store.peerConnections[data.from]) {
          const pc = store.peerConnections[data.from]
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }))
            await flushIceCandidates(data.from, pc)
          } else {
            console.warn('[voice] ignoring answer in state:', pc.signalingState)
          }
        } else if (data.type === 'ice-candidate' && store.peerConnections[data.from]) {
          const pc = store.peerConnections[data.from]
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate))
          } else {
            // queue until remote description arrives
            if (!pendingIceCandidates[data.from]) pendingIceCandidates[data.from] = []
            pendingIceCandidates[data.from].push(data.candidate)
            console.log('[voice] queued ICE candidate for', data.from.slice(0, 8), '(no remote desc yet)')
          }
        }
      } catch (err) {
        console.error(`[voice] signaling error (${data.type}):`, err.message)
      }

      try { await deleteDoc(change.doc.ref) } catch { /* ok */ }
    }
  })

  const prevUnsub = useVoiceStore.getState().unsubVoice
  useVoiceStore.setState({
    unsubVoice: () => { if (typeof prevUnsub === 'function') prevUnsub(); unsubPres(); if (signalingUnsub) signalingUnsub() },
  })
}

async function createPeerConnection(peerId, localStream, groupId, channelId, isOfferer, remoteSdp) {
  const uid = auth.currentUser?.uid
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  const sigRef = collection(db, 'groups', groupId, 'channels', channelId, 'signaling')

  console.log('[voice] creating PC to', peerId.slice(0, 8), isOfferer ? '(offerer)' : '(answerer)')

  // add ONLY audio tracks during initial connection
  if (localStream) {
    localStream.getAudioTracks().forEach(track => pc.addTrack(track, localStream))
  } else {
    console.warn('[voice] no localStream when creating PC for', peerId.slice(0, 8))
  }

  // NO onnegotiationneeded - we manage renegotiation explicitly to avoid races

  // bootstrap SCTP transport: create a data channel so m=application is in the SDP.
  // this enables negotiated data channels (e.g. Tron game) to be opened later.
  if (isOfferer) pc.createDataChannel('_sctp')

  pc.ontrack = (event) => {
    const track = event.track
    const stream = event.streams[0]
    console.log('[voice] TRACK from', peerId.slice(0, 8), '- kind:', track.kind, 'stream:', stream?.id?.slice(0, 8))

    const currentStore = useVoiceStore.getState()

    if (track.kind === 'audio') {
      // distinguish mic audio from screen share audio:
      // screen audio shares a stream with screen video (both added via screenStream)
      // mic audio is on a stream with no video tracks
      const isScreenAudio = stream && stream.getVideoTracks().length > 0
      if (isScreenAudio) {
        console.log('[voice] screen share audio from', peerId.slice(0, 8), '- played by video element')
      } else {
        // mic audio — always update to handle stream replacement during renegotiation
        console.log('[voice] storing mic audio stream for', peerId.slice(0, 8), currentStore.remoteStreams[peerId] ? '(renegotiation update)' : '(initial)')
        if (speakingDetectors[peerId]) speakingDetectors[peerId].stop()
        if (audioContext) {
          speakingDetectors[peerId] = createSpeakingDetector(audioContext, stream, (speaking) => {
            useVoiceStore.getState().setSpeaking(peerId, speaking)
          })
        }
        useVoiceStore.setState({
          remoteStreams: { ...currentStore.remoteStreams, [peerId]: stream },
        })
      }
    } else if (track.kind === 'video') {
      console.log('[voice] storing video stream for', peerId.slice(0, 8))
      try { playStreamLiveSound() } catch { /* non-critical */ }
      // clean up when the video track ends (screen share stopped)
      track.onended = () => {
        console.log('[voice] video track ended from', peerId.slice(0, 8))
        try { playStreamEndSound() } catch { /* non-critical */ }
        const store = useVoiceStore.getState()
        const { [peerId]: _, ...rest } = store.remoteVideoStreams
        useVoiceStore.setState({ remoteVideoStreams: rest })
      }
      useVoiceStore.setState({
        remoteVideoStreams: { ...currentStore.remoteVideoStreams, [peerId]: stream },
      })
    }
  }

  pc.onicecandidate = async (event) => {
    if (!voiceActive || !event.candidate) return
    try {
      await addDoc(sigRef, { type: 'ice-candidate', from: uid, to: peerId, candidate: event.candidate.toJSON() })
    } catch (err) { console.error('[voice] ICE send failed:', err.message) }
  }

  pc.oniceconnectionstatechange = () => { if (voiceActive) console.log('[voice] ICE:', peerId.slice(0, 8), pc.iceConnectionState) }

  pc.onconnectionstatechange = () => {
    if (!voiceActive) return
    const state = pc.connectionState
    console.log('[voice] connection:', peerId.slice(0, 8), state)
    if (state === 'failed') handlePeerReconnect(peerId, groupId, channelId)
    else if (state === 'connected') { console.log('[voice] ✓ CONNECTED to', peerId.slice(0, 8)); reconnectAttempts[peerId] = 0 }
  }

  const currentStore = useVoiceStore.getState()
  useVoiceStore.setState({ peerConnections: { ...currentStore.peerConnections, [peerId]: pc } })

  try {
    if (isOfferer) {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await addDoc(sigRef, { type: 'offer', from: uid, to: peerId, sdp: offer.sdp })
      console.log('[voice] offer sent to', peerId.slice(0, 8))
    } else if (remoteSdp) {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: remoteSdp }))
      await flushIceCandidates(peerId, pc)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await addDoc(sigRef, { type: 'answer', from: uid, to: peerId, sdp: answer.sdp })
      console.log('[voice] answer sent to', peerId.slice(0, 8))
    }
  } catch (err) {
    console.error('[voice] peer setup failed:', err.message)
    removePeer(peerId)
    return null
  }

  // if we're already sharing screen, add video + audio tracks and renegotiate AFTER initial offer/answer
  const voiceState = useVoiceStore.getState()
  if (isOfferer && voiceState.isScreenSharing && voiceState.screenStream) {
    const videoTrack = voiceState.screenStream.getVideoTracks()[0]
    if (videoTrack) {
      pc.addTrack(videoTrack, voiceState.screenStream)
      for (const audioTrack of voiceState.screenStream.getAudioTracks()) {
        pc.addTrack(audioTrack, voiceState.screenStream)
      }
      console.log('[voice] added screen tracks to new peer, sending renegotiation')
      // small delay to ensure initial offer/answer completes; guard against teardown during wait
      setTimeout(() => { if (voiceActive) sendRenegotiationOffer(peerId, pc, sigRef) }, 500)
    }
  }

  return pc
}

function handlePeerReconnect(peerId, groupId, channelId) {
  const attempts = (reconnectAttempts[peerId] || 0) + 1
  reconnectAttempts[peerId] = attempts
  if (attempts > MAX_RECONNECT_ATTEMPTS) { console.error('[voice] giving up on', peerId.slice(0, 8)); removePeer(peerId); return }
  console.warn('[voice] reconnecting to', peerId.slice(0, 8), `(${attempts}/${MAX_RECONNECT_ATTEMPTS})`)
  removePeer(peerId)
  reconnectTimers[peerId] = setTimeout(async () => {
    delete reconnectTimers[peerId]
    if (!voiceActive) return
    const store = useVoiceStore.getState()
    if (!store.inVoice || !store.voiceUsers.some(u => u.uid === peerId)) return
    const uid = auth.currentUser?.uid
    if (uid < peerId) await createPeerConnection(peerId, store.localStream, groupId, channelId, true)
  }, Math.min(RECONNECT_DELAY_MS * attempts, 10000))
}

function removePeer(peerId) {
  console.log('[voice] removing peer', peerId.slice(0, 8))
  const store = useVoiceStore.getState()
  const pc = store.peerConnections[peerId]
  if (pc) pc.close()
  delete pendingIceCandidates[peerId]
  if (speakingDetectors[peerId]) { speakingDetectors[peerId].stop(); delete speakingDetectors[peerId] }
  const { [peerId]: _pc, ...restPCs } = store.peerConnections
  const { [peerId]: _stream, ...restStreams } = store.remoteStreams
  const { [peerId]: _vstream, ...restVideoStreams } = store.remoteVideoStreams
  useVoiceStore.setState({ peerConnections: restPCs, remoteStreams: restStreams, remoteVideoStreams: restVideoStreams })
  store.setSpeaking(peerId, false)
}

export function stopVoice() {
  console.log('[voice] === STOPPING VOICE ===')
  voiceActive = false // prevent any post-teardown operations

  // Stop Eve BEFORE closing AudioContext (she has nodes attached to it)
  if (_onVoiceStopCb) { _onVoiceStopCb(); _onVoiceStopCb = null }

  if (useVoiceStore.getState().isScreenSharing) stopScreenShare()
  if (localSpeakingDetector) { localSpeakingDetector.stop(); localSpeakingDetector = null }
  for (const peerId of Object.keys(speakingDetectors)) { speakingDetectors[peerId].stop(); delete speakingDetectors[peerId] }
  for (const key of Object.keys(reconnectTimers)) { clearTimeout(reconnectTimers[key]); delete reconnectTimers[key] }
  for (const key of Object.keys(reconnectAttempts)) delete reconnectAttempts[key]
  for (const key of Object.keys(pendingIceCandidates)) delete pendingIceCandidates[key]
  switchingDevice = false
  if (currentRawStream) { currentRawStream.getTracks().forEach(t => t.stop()); currentRawStream = null }
  activeGroupId = null; activeChannelId = null
  pipelineDest = null; micMuteGain = null; captureStream = null
  useVoiceStore.getState().registerMuteCallback(null)
  if (cleanupResilience) { cleanupResilience(); cleanupResilience = null }
  if (audioContext) { audioContext.close(); audioContext = null; resetWorkletState() }
  if (signalingUnsub) { signalingUnsub(); signalingUnsub = null }
  console.log('[voice] stopped, all resources cleaned up')
}

// --- EXPORTS FOR GROK VOICE AGENT ---
export function getVoiceAudioContext() { return audioContext }
export function getVoicePipelineDest() { return pipelineDest }
export function getVoiceCaptureStream() { return captureStream }
/** Register a callback that runs BEFORE voice teardown (Eve uses this for cleanup). */
export function onVoiceStop(cb) { _onVoiceStopCb = cb }

// --- SCREEN SHARING ---
let screenStream = null

export async function startScreenShare() {
  const store = useVoiceStore.getState()
  if (!store.inVoice || !voiceActive) return false

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: true,
    })
    console.log('[voice] screen share started, tracks:', screenStream.getTracks().map(t => `${t.kind}:${t.label}`))

    // getDisplayMedia can suspend the AudioContext on some platforms — resume it
    if (audioContext && audioContext.state !== 'running') {
      console.warn('[voice] AudioContext suspended after getDisplayMedia, state:', audioContext.state)
      try { await audioContext.resume() } catch (e) { console.error('[voice] AudioContext resume failed:', e) }
    }

    const videoTrack = screenStream.getVideoTracks()[0]
    const audioTracks = screenStream.getAudioTracks()
    const micTrack = store.localStream?.getAudioTracks()[0]

    // add video + audio tracks to all peers then explicitly renegotiate each
    const pcs = store.peerConnections
    for (const [peerId, pc] of Object.entries(pcs)) {
      if (pc.connectionState === 'closed') continue
      pc.addTrack(videoTrack, screenStream)
      for (const audioTrack of audioTracks) {
        pc.addTrack(audioTrack, screenStream)
      }
      console.log('[voice] added screen tracks to', peerId.slice(0, 8), `(video + ${audioTracks.length} audio)`)
      const sigRef = collection(db, 'groups', activeGroupId, 'channels', activeChannelId, 'signaling')
      await sendRenegotiationOffer(peerId, pc, sigRef)

      // defensive: verify the mic sender still has the correct track after renegotiation
      if (micTrack) {
        const micSender = pc.getSenders().find(s => s.track?.kind === 'audio' && s.track?.id === micTrack.id)
        if (!micSender) {
          // mic sender lost its track — find the first audio sender without a screen audio track and re-attach
          const orphanSender = pc.getSenders().find(s => s.track?.kind === 'audio' && !audioTracks.some(at => at.id === s.track?.id))
            || pc.getSenders().find(s => s.track === null)
          if (orphanSender) {
            await orphanSender.replaceTrack(micTrack)
            console.warn('[voice] re-attached mic track to sender for', peerId.slice(0, 8))
          } else {
            console.error('[voice] could not find sender for mic track on', peerId.slice(0, 8))
          }
        }
      }
    }

    videoTrack.onended = () => { console.log('[voice] screen share ended by user'); stopScreenShare() }

    useVoiceStore.setState({ isScreenSharing: true, screenStream })

    // update voicePresence for badge
    if (activeGroupId && activeChannelId) {
      const uid = auth.currentUser?.uid
      if (uid) updateDoc(doc(db, 'groups', activeGroupId, 'channels', activeChannelId, 'voicePresence', uid), { isScreenSharing: true }).catch(() => {})
    }
    return true
  } catch (err) {
    console.error('[voice] screen share failed:', err.message)
    return false
  }
}

export function stopScreenShare() {
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null }

  const store = useVoiceStore.getState()
  // identify the mic track so we can preserve its sender regardless of iteration order
  const micTrackId = store.localStream?.getAudioTracks()[0]?.id
  for (const [peerId, pc] of Object.entries(store.peerConnections)) {
    if (pc.connectionState === 'closed') continue
    for (const sender of pc.getSenders()) {
      if (!sender.track) continue
      if (sender.track.kind === 'video') {
        pc.removeTrack(sender)
        console.log('[voice] removed screen video track from', peerId.slice(0, 8))
      } else if (sender.track.kind === 'audio' && sender.track.id !== micTrackId) {
        pc.removeTrack(sender)
        console.log('[voice] removed screen audio track from', peerId.slice(0, 8))
      }
    }
    // renegotiate to inform remote that video track is gone
    if (voiceActive && activeGroupId && activeChannelId) {
      const sigRef = collection(db, 'groups', activeGroupId, 'channels', activeChannelId, 'signaling')
      sendRenegotiationOffer(peerId, pc, sigRef)
    }
  }

  useVoiceStore.setState({ isScreenSharing: false, screenStream: null })
  if (activeGroupId && activeChannelId) {
    const uid = auth.currentUser?.uid
    if (uid) updateDoc(doc(db, 'groups', activeGroupId, 'channels', activeChannelId, 'voicePresence', uid), { isScreenSharing: false }).catch(() => {})
  }
  console.log('[voice] screen share stopped')
}
