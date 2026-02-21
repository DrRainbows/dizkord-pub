/**
 * DizKord Audio Pipeline
 *
 * ML noise suppression via RNNoise (same tech as Jitsi Meet).
 * Pipeline: Mic → RNNoise (ML denoise) → VAD analyser → NoiseGate → Output
 *
 * RNNoise is a neural network that separates speech from noise on every
 * audio frame. Unlike a binary gate, it removes noise WHILE you're speaking.
 * Keyboard clacking, fan noise, background music - filtered in real-time.
 */
import { NoiseSuppressorWorklet_Name } from '@timephy/rnnoise-wasm'
// Vite: `?worker&url` generates a working script and returns its URL
import NoiseSuppressorWorkletUrl from '@timephy/rnnoise-wasm/NoiseSuppressorWorklet?worker&url'

let workletLoaded = false

/**
 * Creates the audio pipeline with ML noise suppression.
 * Must be called after AudioContext is created.
 */
export async function createAudioPipeline(audioContext, rawStream) {
  const source = audioContext.createMediaStreamSource(rawStream)

  // load RNNoise AudioWorklet (once per AudioContext)
  if (!workletLoaded) {
    console.log('[voice] loading RNNoise WASM AudioWorklet...')
    try {
      await audioContext.audioWorklet.addModule(NoiseSuppressorWorkletUrl)
      workletLoaded = true
      console.log('[voice] RNNoise loaded')
    } catch (err) {
      console.error('[voice] RNNoise load failed:', err.message)
      throw err // let caller handle - don't set workletLoaded so retry is possible
    }
  }

  // ML noise suppression node - runs a neural network on every audio frame
  const rnnoise = new AudioWorkletNode(audioContext, NoiseSuppressorWorklet_Name)

  // VAD analyser - tapped after RNNoise so it sees clean audio
  const vadAnalyser = audioContext.createAnalyser()
  vadAnalyser.fftSize = 512
  vadAnalyser.smoothingTimeConstant = 0.4

  // noise gate - starts OPEN, VAD closes it on silence
  const gate = audioContext.createGain()
  gate.gain.value = 1.0

  // mute gain - separate from VAD gate so mute doesn't interfere with Eve broadcast
  const muteGain = audioContext.createGain()
  muteGain.gain.value = 1.0

  const dest = audioContext.createMediaStreamDestination()
  // Separate capture dest for Eve's mixer — mic audio only, Eve's output NOT mixed in.
  // Without this, Eve hears herself through the pipeline → feedback loop → stutter.
  const captureDest = audioContext.createMediaStreamDestination()

  // source → rnnoise → vadAnalyser (analysis tap)
  // source → rnnoise → gate → muteGain → dest (audio to WebRTC, Eve mixes in here too)
  //                                     → captureDest (mic-only capture for Eve's input)
  source.connect(rnnoise)
  rnnoise.connect(vadAnalyser)
  rnnoise.connect(gate)
  gate.connect(muteGain)
  muteGain.connect(dest)
  muteGain.connect(captureDest)

  console.log('[voice] audio pipeline: mic → RNNoise(ML) → gate → muteGain → webrtc + capture')

  return { stream: dest.stream, gateNode: gate, muteGain, vadAnalyser, dest, captureStream: captureDest.stream }
}

/**
 * Reset worklet loaded state (call when AudioContext is closed).
 */
export function resetWorkletState() {
  workletLoaded = false
}

/**
 * Speaking detector + noise gate controller.
 * Reads threshold from getThreshold() every frame for live updates.
 * Onset delay filters short transients (keyboard clicks that survive RNNoise).
 */
export function createSpeakingDetector(audioContext, input, onSpeaking, { gateNode, getThreshold } = {}) {
  let analyser
  let source = null

  if (input instanceof AnalyserNode) {
    analyser = input
  } else {
    source = audioContext.createMediaStreamSource(input)
    analyser = audioContext.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.4
    source.connect(analyser)
  }

  const data = new Uint8Array(analyser.frequencyBinCount)
  let speaking = false
  let silenceFrames = 0
  let onsetFrames = 0
  let animFrameId = null
  let stopped = false
  const SILENCE_DELAY = 15
  const ONSET_DELAY = gateNode ? 3 : 0

  function check() {
    if (stopped) return

    analyser.getByteFrequencyData(data)
    const speechThreshold = getThreshold ? getThreshold() : 15

    const sampleRate = audioContext.sampleRate
    const binSize = sampleRate / analyser.fftSize
    const startBin = Math.floor(300 / binSize)
    const endBin = Math.floor(3400 / binSize)

    let sum = 0
    for (let i = startBin; i < endBin && i < data.length; i++) {
      sum += data[i]
    }
    const avg = sum / (endBin - startBin)

    if (avg > speechThreshold) {
      silenceFrames = 0
      onsetFrames++
      if (!speaking && onsetFrames >= ONSET_DELAY) {
        speaking = true
        onSpeaking(true)
        if (gateNode) {
          gateNode.gain.cancelScheduledValues(audioContext.currentTime)
          gateNode.gain.setValueAtTime(gateNode.gain.value, audioContext.currentTime)
          gateNode.gain.linearRampToValueAtTime(1.0, audioContext.currentTime + 0.005)
        }
      }
    } else {
      onsetFrames = 0
      silenceFrames++
      if (speaking && silenceFrames > SILENCE_DELAY) {
        speaking = false
        onSpeaking(false)
        if (gateNode) {
          gateNode.gain.cancelScheduledValues(audioContext.currentTime)
          gateNode.gain.setValueAtTime(gateNode.gain.value, audioContext.currentTime)
          gateNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.15)
        }
      }
    }

    animFrameId = requestAnimationFrame(check)
  }

  check()

  return {
    analyser,
    stop: () => {
      stopped = true
      if (animFrameId != null) cancelAnimationFrame(animFrameId)
      if (source) source.disconnect()
      try { analyser.disconnect() } catch { /* may already be disconnected */ }
    },
  }
}

/**
 * Notification sounds
 */
let notifCtx = null

function getNotifContext() {
  if (!notifCtx || notifCtx.state === 'closed') {
    notifCtx = new AudioContext()
  }
  return notifCtx
}

/**
 * Ensure notif AudioContext is running before scheduling sound.
 * Chrome suspends AudioContexts without recent user gesture.
 * Scheduling on a suspended context produces silence.
 */
function withNotifCtx(fn) {
  const ctx = getNotifContext()
  if (ctx.state === 'suspended') {
    ctx.resume().then(() => fn(ctx)).catch(() => {})
  } else {
    fn(ctx)
  }
}

/** Close the notification AudioContext (call on logout to free resources). */
export function closeNotifContext() {
  if (notifCtx && notifCtx.state !== 'closed') {
    notifCtx.close().catch(() => {})
  }
  notifCtx = null
}

export function playJoinSound() {
  withNotifCtx((ctx) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(440, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1)
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.3)
  })
}

export function playLeaveSound() {
  withNotifCtx((ctx) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.15)
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.3)
  })
}

export function playMessageSound() {
  withNotifCtx((ctx) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(587, ctx.currentTime)
    osc.frequency.setValueAtTime(784, ctx.currentTime + 0.08)
    gain.gain.setValueAtTime(0.2, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.2)
  })
}

// distinct mention sound - higher pitch, two-tone ping
export function playMentionSound() {
  withNotifCtx((ctx) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.setValueAtTime(1174, ctx.currentTime + 0.1)
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.2)
    gain.gain.setValueAtTime(0.35, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.35)
  })
}

// stream going live — ascending two-tone broadcast chime
export function playStreamLiveSound() {
  withNotifCtx((ctx) => {
    const t = ctx.currentTime
    // tone 1: C5 → G5
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.type = 'square'
    osc1.frequency.setValueAtTime(523, t)
    osc1.frequency.setValueAtTime(784, t + 0.1)
    gain1.gain.setValueAtTime(0.12, t)
    gain1.gain.exponentialRampToValueAtTime(0.01, t + 0.25)
    osc1.start(t)
    osc1.stop(t + 0.25)
    // tone 2: higher octave shimmer
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(1047, t + 0.12)
    gain2.gain.setValueAtTime(0, t)
    gain2.gain.setValueAtTime(0.18, t + 0.12)
    gain2.gain.exponentialRampToValueAtTime(0.01, t + 0.45)
    osc2.start(t)
    osc2.stop(t + 0.45)
  })
}

// stream ended — soft descending resolve
export function playStreamEndSound() {
  withNotifCtx((ctx) => {
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(784, t)
    osc.frequency.exponentialRampToValueAtTime(392, t + 0.2)
    gain.gain.setValueAtTime(0.15, t)
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3)
    osc.start(t)
    osc.stop(t + 0.3)
  })
}
