import { useEffect, useRef, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVoiceStore } from '../../stores/voiceStore'
import { useChatStore } from '../../stores/chatStore'
import { useAuthStore } from '../../stores/authStore'
import { startVoice, stopVoice } from '../../services/webrtc'
import { playJoinSound, playLeaveSound } from '../../services/audio'
import VoiceControls from './VoiceControls'
import VoiceUserGrid from './VoiceUserGrid'
import UserContextMenu from './UserContextMenu'
import StreamViewer from './StreamViewer'

export default function VoiceChannel() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { activeGroup, activeChannel, startDM } = useChatStore()
  const [contextMenu, setContextMenu] = useState(null)
  const {
    inVoice, voiceUsers, joinVoiceChannel, leaveVoiceChannel,
    remoteVideoStreams, isDeafened,
    error: voiceError, isScreenSharing, screenStream,
  } = useVoiceStore()

  const prevUidsRef = useRef(new Set())
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    if (!voiceError) return
    const t = setTimeout(() => useVoiceStore.setState({ error: null }), 5000)
    return () => clearTimeout(t)
  }, [voiceError])

  // join/leave sounds
  useEffect(() => {
    const prevUids = prevUidsRef.current
    const currUids = new Set(voiceUsers.map(u => u.uid))
    const myUid = user?.uid
    let hasJoin = false, hasLeave = false
    for (const uid of currUids) { if (uid !== myUid && !prevUids.has(uid)) hasJoin = true }
    for (const uid of prevUids) { if (uid !== myUid && !currUids.has(uid)) hasLeave = true }
    if (hasJoin && !isDeafened) playJoinSound()
    if (hasLeave && !isDeafened) playLeaveSound()
    prevUidsRef.current = currUids
  }, [voiceUsers, user?.uid, isDeafened])

  const handleJoin = async () => {
    if (joining || !activeGroup || !activeChannel) return
    setJoining(true)
    try {
      await joinVoiceChannel(activeGroup.id, activeChannel.id)
      const success = await startVoice(activeGroup.id, activeChannel.id)
      if (!success) { await leaveVoiceChannel(); return }
      playJoinSound()
    } catch { await leaveVoiceChannel().catch(() => {}) }
    finally { setJoining(false) }
  }

  const handleLeave = async () => {
    stopVoice()
    playLeaveSound()
    await leaveVoiceChannel()
  }

  const handleDM = async (otherUid) => {
    const dmId = await startDM(otherUid)
    if (dmId) navigate(`/dm/${dmId}`)
  }

  const hasVideoStreams = useMemo(() => {
    if (isScreenSharing && screenStream?.getVideoTracks().length > 0) return true
    for (const stream of Object.values(remoteVideoStreams)) {
      if (stream.getVideoTracks().length > 0) return true
    }
    return false
  }, [remoteVideoStreams, isScreenSharing, screenStream])

  if (!activeChannel || activeChannel.type !== 'voice') return null

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-void-border px-4 py-3 bg-void-light/50 flex items-center justify-between">
        <div>
          <h2 className="font-display font-semibold text-text-primary flex items-center gap-2">
            🎤 {activeChannel.name}
            {inVoice && (
              <span className="text-xs font-mono text-neon-green bg-neon-green/10 px-2 py-0.5 rounded-full">connected</span>
            )}
          </h2>
          <p className="text-text-muted text-xs font-mono">{voiceUsers.length} in voice</p>
        </div>
        {!inVoice ? (
          <button onClick={handleJoin} disabled={joining}
            className="px-6 py-2 bg-neon-green text-void rounded-lg font-display font-semibold text-sm hover:bg-neon-green/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:shadow-[0_0_20px_rgba(0,255,136,0.4)] glow-green">
            {joining ? 'joining...' : 'JOIN VOICE'}
          </button>
        ) : (
          <button onClick={handleLeave}
            className="px-6 py-2 bg-neon-pink text-white rounded-lg font-display font-semibold text-sm hover:bg-neon-pink/90 transition-all hover:shadow-[0_0_20px_rgba(255,55,95,0.4)]">
            DISCONNECT
          </button>
        )}
      </div>

      {voiceError && (
        <div className="mx-4 mt-2 bg-neon-pink/10 border border-neon-pink/30 rounded-lg p-3 text-neon-pink text-sm font-mono animate-fade-in">
          {voiceError}
        </div>
      )}

      {hasVideoStreams && <StreamViewer />}

      <VoiceUserGrid onContextMenu={setContextMenu} />

      {inVoice && <VoiceControls />}

      {contextMenu && (
        <UserContextMenu
          user={contextMenu.user}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
          onDM={handleDM}
        />
      )}

      <style>{`
        @keyframes pulse-bar {
          0% { transform: scaleY(0.5); }
          100% { transform: scaleY(1.5); }
        }
      `}</style>
    </div>
  )
}
