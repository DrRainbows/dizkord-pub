import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useVoiceStore } from '../../stores/voiceStore'
import { useAuthStore } from '../../stores/authStore'

const MODES = ['theatre', 'grid', 'pip', 'minimized']
const MODE_ICONS = { theatre: '▣', grid: '⊞', pip: '◱', minimized: '▬' }
const MODE_LABELS = { theatre: 'theatre', grid: 'grid', pip: 'pip', minimized: 'minimize' }

export default function StreamViewer() {
  const { user } = useAuthStore()
  const { remoteVideoStreams, isScreenSharing, screenStream, voiceUsers } = useVoiceStore()

  const [mode, setMode] = useState('theatre')
  const [userFocusedId, setFocusedId] = useState(null)
  const videoRefs = useRef({})
  const [streamVolumes, setStreamVolumes] = useState({})

  // collect all active video streams: { id, stream, name, isLocal }
  const videoStreams = useMemo(() => {
    const streams = []

    // local screen share
    if (isScreenSharing && screenStream && screenStream.getVideoTracks().length > 0) {
      streams.push({
        id: '__local__',
        stream: screenStream,
        name: user?.displayName || 'you',
        isLocal: true,
      })
    }

    // remote video streams (screen shares from other peers)
    for (const [peerId, stream] of Object.entries(remoteVideoStreams)) {
      if (stream.getVideoTracks().length > 0) {
        const vu = voiceUsers.find(u => u.uid === peerId || u.id === peerId)
        streams.push({
          id: peerId,
          stream,
          name: vu?.displayName || 'anon',
          isLocal: false,
        })
      }
    }

    return streams
  }, [remoteVideoStreams, isScreenSharing, screenStream, voiceUsers, user?.displayName])

  // derive effective focused ID (no setState in effect needed)
  const focusedId = useMemo(() => {
    if (userFocusedId && videoStreams.find(s => s.id === userFocusedId)) return userFocusedId
    return videoStreams.length > 0 ? videoStreams[0].id : null
  }, [userFocusedId, videoStreams])

  // derive effective mode: reset to theatre when no streams
  const effectiveMode = videoStreams.length === 0 ? 'theatre' : mode

  // attach streams to video elements + prune stale refs (P2-1)
  useEffect(() => {
    const activeIds = new Set(videoStreams.map(vs => vs.id))
    // prune refs for streams that no longer exist
    for (const id of Object.keys(videoRefs.current)) {
      if (!activeIds.has(id)) delete videoRefs.current[id]
    }
    // attach active streams
    for (const vs of videoStreams) {
      const el = videoRefs.current[vs.id]
      if (el && el.srcObject !== vs.stream) {
        try { el.srcObject = vs.stream } catch (err) { console.error('[stream] srcObject assign failed:', err.message) }
      }
    }
  }, [videoStreams])

  // cleanup on unmount
  useEffect(() => {
    const refs = videoRefs.current
    return () => {
      for (const el of Object.values(refs)) {
        if (el) el.srcObject = null
      }
    }
  }, [])

  const handleFullscreen = useCallback((id) => {
    const el = videoRefs.current[id]
    if (el?.requestFullscreen) {
      el.requestFullscreen().catch(() => {})
    }
  }, [])

  const handleStreamVolume = useCallback((id, vol) => {
    setStreamVolumes(prev => ({ ...prev, [id]: vol }))
    const el = videoRefs.current[id]
    if (el) el.volume = vol
  }, [])

  // stable ref callback factory — avoids inline closures that cause React 19 ref churn
  const getVideoRef = useCallback((id) => (el) => {
    if (el) videoRefs.current[id] = el
    else delete videoRefs.current[id]
  }, [])

  // nothing to show
  if (videoStreams.length === 0) return null

  const focusedStream = videoStreams.find(s => s.id === focusedId)
  const thumbnailStreams = videoStreams.filter(s => s.id !== focusedId)
  const sharerCount = videoStreams.length

  // minimized bar
  if (effectiveMode === 'minimized') {
    return (
      <div className="w-full bg-void-light border-b border-void-border px-4 py-2 flex items-center justify-between animate-fade-in">
        <span className="text-xs font-mono text-neon-cyan">
          {sharerCount} sharing
        </span>
        <button
          onClick={() => setMode('theatre')}
          className="text-xs font-mono text-neon-green hover:text-neon-green/80 transition-colors px-2 py-1 rounded hover:bg-void-lighter"
        >
          expand
        </button>
      </div>
    )
  }

  // pip mode
  if (effectiveMode === 'pip') {
    return (
      <div className="fixed bottom-20 right-4 z-40 animate-fade-in w-[280px] md:w-[320px]">
        <div className="rounded-xl overflow-hidden border border-void-border shadow-2xl bg-void">
          {/* toolbar */}
          <div className="flex items-center justify-between px-3 py-1.5 glass border-b border-void-border">
            <span className="text-[10px] font-mono text-text-muted">
              {focusedStream?.name || 'stream'}
            </span>
            <div className="flex items-center gap-1">
              {MODES.map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`text-xs px-1.5 py-0.5 rounded font-mono transition-colors ${
                    effectiveMode === m ? 'text-neon-green bg-neon-green/10' : 'text-text-muted hover:text-text-primary'
                  }`}
                  title={MODE_LABELS[m]}
                >
                  {MODE_ICONS[m]}
                </button>
              ))}
            </div>
          </div>
          {/* video */}
          {focusedStream && (
            <div className="relative aspect-video bg-void cursor-pointer" onClick={() => setMode('theatre')}>
              <video
                ref={getVideoRef(focusedStream.id)}
                autoPlay
                playsInline
                muted={focusedStream.isLocal}
                className="w-full h-full object-contain"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-void/80 to-transparent px-2 py-1">
                <span className="text-[10px] font-mono text-text-primary">{focusedStream.name}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // theatre + grid modes
  return (
    <div className="w-full bg-void border-b border-void-border animate-fade-in">
      {/* toolbar */}
      <div className="flex items-center justify-between px-4 py-2 glass border-b border-void-border">
        <span className="text-xs font-mono text-text-muted">
          {sharerCount} stream{sharerCount !== 1 ? 's' : ''} active
        </span>
        <div className="flex items-center gap-1">
          {MODES.map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`text-xs px-2 py-1 rounded font-mono transition-colors ${
                effectiveMode === m ? 'text-neon-green bg-neon-green/10' : 'text-text-muted hover:text-text-primary hover:bg-void-lighter'
              }`}
              title={MODE_LABELS[m]}
            >
              {MODE_ICONS[m]}
            </button>
          ))}
        </div>
      </div>

      {effectiveMode === 'theatre' && focusedStream && (
        <div className="p-3">
          {/* focused stream */}
          <div className="relative rounded-xl overflow-hidden border border-void-border bg-void-light" style={{ maxHeight: '50vh' }}>
            <video
              ref={getVideoRef(focusedStream.id)}
              autoPlay
              playsInline
              muted={focusedStream.isLocal}
              className="w-full h-full object-contain"
              style={{ maxHeight: '60vh' }}
            />
            {/* overlay */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-void/90 to-transparent p-3 flex items-end justify-between">
              <span className="text-sm font-mono text-text-primary">{focusedStream.name}</span>
              <div className="flex items-center gap-2">
                {/* volume for non-local streams with audio */}
                {!focusedStream.isLocal && focusedStream.stream.getAudioTracks().length > 0 && (
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={streamVolumes[focusedStream.id] ?? 1}
                    onChange={(e) => handleStreamVolume(focusedStream.id, parseFloat(e.target.value))}
                    className="w-20 h-1 bg-void-lighter rounded-lg appearance-none cursor-pointer accent-neon-cyan"
                    title="stream volume"
                  />
                )}
                <button
                  onClick={() => handleFullscreen(focusedStream.id)}
                  className="text-xs text-text-muted hover:text-neon-green font-mono px-2 py-1 rounded hover:bg-void-lighter transition-colors"
                  title="fullscreen"
                >
                  ⛶
                </button>
              </div>
            </div>
          </div>

          {/* thumbnails */}
          {thumbnailStreams.length > 0 && (
            <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
              {thumbnailStreams.map((vs) => (
                <div
                  key={vs.id}
                  className="relative flex-shrink-0 w-40 rounded-lg overflow-hidden border border-void-border hover:border-neon-green/50 cursor-pointer transition-colors"
                  onClick={() => setFocusedId(vs.id)}
                >
                  <video
                    ref={getVideoRef(vs.id)}
                    autoPlay
                    playsInline
                    muted={vs.isLocal}
                    className="w-full aspect-video object-contain bg-void-light"
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-void/80 to-transparent px-2 py-0.5">
                    <span className="text-[10px] font-mono text-text-primary">{vs.name}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {effectiveMode === 'grid' && (
        <div className={`p-3 grid gap-2 ${
          videoStreams.length === 1 ? 'grid-cols-1' :
          videoStreams.length <= 4 ? 'grid-cols-2' :
          'grid-cols-3'
        }`}>
          {videoStreams.map((vs) => (
            <div
              key={vs.id}
              className="relative rounded-xl overflow-hidden border border-void-border bg-void-light"
            >
              <video
                ref={getVideoRef(vs.id)}
                autoPlay
                playsInline
                muted={vs.isLocal}
                className="w-full aspect-video object-contain"
              />
              {/* overlay */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-void/90 to-transparent p-2 flex items-end justify-between">
                <span className="text-xs font-mono text-text-primary">{vs.name}</span>
                <div className="flex items-center gap-1">
                  {!vs.isLocal && vs.stream.getAudioTracks().length > 0 && (
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={streamVolumes[vs.id] ?? 1}
                      onChange={(e) => handleStreamVolume(vs.id, parseFloat(e.target.value))}
                      className="w-16 h-1 bg-void-lighter rounded-lg appearance-none cursor-pointer accent-neon-cyan"
                      title="stream volume"
                    />
                  )}
                  <button
                    onClick={() => handleFullscreen(vs.id)}
                    className="text-[10px] text-text-muted hover:text-neon-green font-mono px-1 py-0.5 rounded hover:bg-void-lighter transition-colors"
                    title="fullscreen"
                  >
                    ⛶
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
