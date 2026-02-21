import { useEffect, useState, useCallback } from 'react'
import { useVoiceStore } from '../../stores/voiceStore'
import { switchInputDevice, startScreenShare, stopScreenShare } from '../../services/webrtc'
import { startGrokVoice, stopGrokVoice, isGrokVoiceActive } from '../../services/grokVoice'

export default function VoiceControls() {
  const {
    isMuted, isDeafened, isScreenSharing, toggleMute, toggleDeafen,
    audioDevices, selectedInput, selectedOutput, localStream,
    setSelectedInput, setSelectedOutput, enumerateDevices,
    vadThreshold, setVadThreshold,
  } = useVoiceStore()
  const [showSettings, setShowSettings] = useState(false)
  const [eveActive, setEveActive] = useState(false)
  const [eveLoading, setEveLoading] = useState(false)
  const [eveTranscript, setEveTranscript] = useState('')

  const toggleEve = useCallback(async () => {
    if (eveActive || isGrokVoiceActive()) {
      stopGrokVoice()
      setEveActive(false)
      setEveTranscript('')
      return
    }
    if (!localStream) return
    setEveLoading(true)
    try {
      await startGrokVoice(({ role, text, done }) => {
        if (role === 'assistant' && !done) {
          setEveTranscript(prev => prev + text)
        } else if (role === 'user' && done && text) {
          // briefly show what user said
          setEveTranscript(`[you] ${text}`)
          setTimeout(() => setEveTranscript(''), 2000)
        } else if (done) {
          setTimeout(() => setEveTranscript(''), 4000)
        }
      })
      setEveActive(true)
    } catch (err) {
      console.error('Failed to start Eve:', err)
    } finally {
      setEveLoading(false)
    }
  }, [eveActive, localStream])

  useEffect(() => {
    enumerateDevices()
    navigator.mediaDevices.addEventListener('devicechange', enumerateDevices)
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', enumerateDevices)
    }
  }, [enumerateDevices])

  // derive a readable label from the device info
  const deviceLabel = (device, fallback) => {
    if (device.label) return device.label
    return `${fallback} (${device.deviceId.slice(0, 6)})`
  }

  return (
    <div className="border-t border-void-border bg-void-light p-3">
      <div className="flex items-center justify-center gap-2 md:gap-3 flex-wrap">
        {/* Mute */}
        <button
          onClick={toggleMute}
          className={`px-3 md:px-4 py-2.5 rounded-lg font-mono text-sm transition-all flex items-center gap-2
            ${isMuted
              ? 'bg-neon-pink/20 text-neon-pink border border-neon-pink/30 hover:bg-neon-pink/30'
              : 'bg-void-lighter text-text-primary border border-void-border hover:border-neon-green/30'
            }`}
          title={isMuted ? 'Unmute' : 'Mute'}
          aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {isMuted ? '🔇' : '🎤'}
          <span className="hidden md:inline">{isMuted ? 'muted' : 'mic on'}</span>
        </button>

        {/* Deafen */}
        <button
          onClick={toggleDeafen}
          className={`px-3 md:px-4 py-2.5 rounded-lg font-mono text-sm transition-all flex items-center gap-2
            ${isDeafened
              ? 'bg-neon-pink/20 text-neon-pink border border-neon-pink/30 hover:bg-neon-pink/30'
              : 'bg-void-lighter text-text-primary border border-void-border hover:border-neon-green/30'
            }`}
          title={isDeafened ? 'Undeafen' : 'Deafen'}
          aria-label={isDeafened ? 'Undeafen' : 'Toggle deafen'}
        >
          {isDeafened ? '🔇' : '🔊'}
          <span className="hidden md:inline">{isDeafened ? 'deafened' : 'audio on'}</span>
        </button>

        {/* Screen share */}
        <button
          onClick={() => isScreenSharing ? stopScreenShare() : startScreenShare()}
          className={`px-3 md:px-4 py-2.5 rounded-lg font-mono text-sm transition-all flex items-center gap-2 border
            ${isScreenSharing
              ? 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan/30 hover:bg-neon-cyan/30'
              : 'bg-void-lighter text-text-primary border-void-border hover:border-neon-cyan/30'
            }`}
          title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
          aria-label={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
        >
          🖥️
          <span className="hidden md:inline">{isScreenSharing ? 'stop share' : 'screen'}</span>
        </button>

        {/* Eve (Grok Voice Agent) */}
        <button
          onClick={toggleEve}
          disabled={eveLoading || !localStream}
          className={`px-3 md:px-4 py-2.5 rounded-lg font-mono text-sm transition-all flex items-center gap-2 border
            ${eveActive
              ? 'bg-neon-purple/20 text-neon-purple border-neon-purple/30 hover:bg-neon-purple/30 animate-pulse'
              : 'bg-void-lighter text-text-primary border-void-border hover:border-neon-purple/30'
            }
            ${eveLoading ? 'opacity-50 cursor-wait' : ''}
            ${!localStream ? 'opacity-30 cursor-not-allowed' : ''}
          `}
          title={eveActive ? 'Dismiss Eve' : 'Summon Eve (AI voice companion)'}
        >
          {eveLoading ? '⏳' : '🤖'}
          <span className="hidden md:inline">{eveLoading ? 'connecting...' : eveActive ? 'dismiss eve' : 'summon eve'}</span>
        </button>

        {/* Settings toggle */}
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`px-3 md:px-4 py-2.5 rounded-lg font-mono text-sm transition-all border
            ${showSettings
              ? 'bg-neon-purple/20 text-neon-purple border-neon-purple/30'
              : 'bg-void-lighter text-text-secondary border-void-border hover:border-neon-purple/30'
            }`}
        >
          ⚙️<span className="hidden md:inline"> devices</span>
        </button>
      </div>

      {/* Eve transcript — fixed-height reserved space to prevent layout jitter */}
      {eveActive && (
        <div className="mt-2 px-3 py-1.5 min-h-[36px] rounded-lg bg-neon-purple/5 border border-neon-purple/20 flex items-center">
          {eveTranscript ? (
            <div className="w-full overflow-hidden">
              <p className="text-[10px] font-mono text-neon-purple/60 mb-0.5">eve</p>
              <p className="text-xs font-mono text-text-primary leading-relaxed truncate">{eveTranscript}</p>
            </div>
          ) : (
            <p className="text-[10px] font-mono text-neon-purple/30">eve is listening...</p>
          )}
        </div>
      )}

      {/* Device Settings Panel */}
      {showSettings && (
        <div className="mt-3 p-4 rounded-lg bg-void border border-void-border animate-fade-in space-y-4">
          {/* Input Device */}
          <div>
            <label className="block text-text-muted text-xs font-mono uppercase tracking-wider mb-1.5">
              microphone
            </label>
            <select
              value={selectedInput || ''}
              onChange={(e) => {
                setSelectedInput(e.target.value)
                switchInputDevice(e.target.value)
              }}
              className="w-full px-3 py-2 rounded-lg text-sm"
            >
              <option value="">system default</option>
              {audioDevices.inputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {deviceLabel(d, 'microphone')}
                </option>
              ))}
            </select>
          </div>

          {/* Output Device */}
          <div>
            <label className="block text-text-muted text-xs font-mono uppercase tracking-wider mb-1.5">
              speaker / headphones
            </label>
            <select
              value={selectedOutput || ''}
              onChange={(e) => setSelectedOutput(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
            >
              <option value="">system default</option>
              {audioDevices.outputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {deviceLabel(d, 'speakers')}
                </option>
              ))}
            </select>
          </div>

          {/* Voice Activation Threshold */}
          <div>
            <label className="block text-text-muted text-xs font-mono uppercase tracking-wider mb-1.5">
              voice activation sensitivity
            </label>
            <input
              type="range"
              min="5"
              max="60"
              step="1"
              value={vadThreshold}
              onChange={(e) => setVadThreshold(parseInt(e.target.value))}
              className="w-full h-1 bg-void-lighter rounded-lg appearance-none cursor-pointer accent-neon-green"
            />
            <div className="flex justify-between text-[10px] text-text-muted font-mono mt-1">
              <span>sensitive</span>
              <span>{vadThreshold}</span>
              <span>aggressive</span>
            </div>
            <p className="text-text-muted text-[10px] font-mono mt-1">
              // higher = less background noise but need to speak louder. changes apply immediately.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
