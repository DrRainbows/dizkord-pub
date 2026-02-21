/**
 * EveSession — class interface over the Grok Voice Agent.
 *
 * Thin wrapper around services/grokVoice.js module-level functions.
 * Establishes the class API for hook/component consumers.
 */
import { startGrokVoice, stopGrokVoice, isGrokVoiceActive } from '../services/grokVoice'

export default class EveSession {
  constructor() {
    this._active = false
  }

  async start(onTranscript) {
    await startGrokVoice(onTranscript)
    this._active = true
  }

  stop() {
    stopGrokVoice()
    this._active = false
  }

  get active() { return isGrokVoiceActive() }

  destroy() {
    if (this.active) this.stop()
  }
}
