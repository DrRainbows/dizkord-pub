import { useEffect, useRef } from 'react'
import { useVoiceStore } from '../../stores/voiceStore'
import Avatar from '../ui/Avatar'

/**
 * Right-click context menu for voice channel users.
 * Shows profile info, volume control, and DM option.
 */
export default function UserContextMenu({ user, position, onClose, onDM }) {
  const menuRef = useRef(null)
  const { userVolumes, setUserVolume } = useVoiceStore()
  const volume = userVolumes[user.uid] ?? 1.0

  // close on click outside
  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose()
    }
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [onClose])

  // position menu within viewport
  const style = {
    position: 'fixed',
    left: Math.min(position.x, window.innerWidth - 220),
    top: Math.min(position.y, window.innerHeight - 260),
    zIndex: 100,
  }

  return (
    <div ref={menuRef} style={style} className="w-52 glass rounded-xl border border-void-border shadow-xl animate-fade-in p-3 space-y-3">
      {/* profile header */}
      <div className="flex items-center gap-3">
        <Avatar src={user.photoURL} name={user.displayName} size="md" status="online" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">{user.displayName}</p>
          <p className="text-[10px] text-neon-green font-mono">in voice</p>
        </div>
      </div>

      {/* volume slider */}
      <div>
        <label className="text-[10px] text-text-muted font-mono uppercase">volume</label>
        <input
          type="range"
          min="0" max="1" step="0.05"
          value={Math.min(volume, 1.0)}
          onChange={(e) => setUserVolume(user.uid, parseFloat(e.target.value))}
          className="w-full h-1 bg-void-lighter rounded-lg appearance-none cursor-pointer accent-neon-green mt-1"
        />
        <p className="text-[10px] text-text-muted text-right font-mono">{Math.round(volume * 100)}%</p>
      </div>

      {/* actions */}
      <div className="space-y-0.5 border-t border-void-border pt-2">
        <button
          onClick={() => { onDM?.(user.uid); onClose() }}
          className="w-full text-left px-2 py-1.5 rounded-md text-xs font-mono text-text-secondary hover:bg-void-lighter hover:text-neon-green transition-all"
        >
          send dm
        </button>
      </div>
    </div>
  )
}
