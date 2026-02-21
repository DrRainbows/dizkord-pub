/**
 * VoiceEngine — class interface over the WebRTC voice system.
 *
 * Currently a thin wrapper around services/webrtc.js module-level functions.
 * This establishes the class API so consumers (hooks, components) can migrate
 * away from direct service imports. Internally, webrtc.js still owns the state.
 *
 * Future: move all module-level state into instance properties for full isolation.
 */
import {
  startVoice,
  stopVoice,
  switchInputDevice,
  startScreenShare,
  stopScreenShare,
  getVoiceAudioContext,
  getVoicePipelineDest,
  getVoiceCaptureStream,
  onVoiceStop,
} from '../services/webrtc'

let _instance = null

export default class VoiceEngine {
  constructor() {
    if (_instance) {
      console.warn('[VoiceEngine] instance already exists, returning existing')
      return _instance
    }
    _instance = this
    this._active = false
  }

  async start(groupId, channelId) {
    const ok = await startVoice(groupId, channelId)
    this._active = ok
    return ok
  }

  stop() {
    stopVoice()
    this._active = false
    _instance = null
  }

  get active() { return this._active }

  async switchDevice(deviceId) { return switchInputDevice(deviceId) }
  async startScreenShare() { return startScreenShare() }
  stopScreenShare() { return stopScreenShare() }

  getAudioContext() { return getVoiceAudioContext() }
  getPipelineDest() { return getVoicePipelineDest() }
  getCaptureStream() { return getVoiceCaptureStream() }
  onStop(cb) { onVoiceStop(cb) }

  destroy() {
    if (this._active) this.stop()
    _instance = null
  }

  static getInstance() { return _instance }
}
