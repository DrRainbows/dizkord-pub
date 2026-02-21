import { useVoiceStore } from '../../stores/voiceStore'
import Avatar from '../ui/Avatar'

export default function VoiceUser({ vu, isSpeaking, isMe, isEve, inVoice, volume, onContextMenu }) {
  return (
    <div
      className={`flex flex-col items-center gap-2 md:gap-3 p-4 md:p-6 rounded-2xl glass transition-all duration-200
        ${isEve && isSpeaking ? 'ring-2 ring-neon-purple/60 shadow-[0_0_24px_rgba(168,85,247,0.25)]' : ''}
        ${!isEve && isSpeaking ? 'speaking-ring' : ''}
        ${!isSpeaking ? 'border border-void-border' : ''}
        ${isEve ? 'bg-neon-purple/5' : ''}
        ${!isEve ? 'cursor-pointer' : ''}
      `}
      onContextMenu={onContextMenu}
    >
      {isEve ? (
        <div className={`relative w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center
          ${isSpeaking ? 'bg-neon-purple/20 ring-2 ring-neon-purple animate-pulse' : 'bg-neon-purple/10 ring-1 ring-neon-purple/30'}
          transition-all duration-200`}>
          <span className="text-3xl md:text-4xl">🤖</span>
        </div>
      ) : (
        <Avatar src={vu.photoURL} name={vu.displayName} size="lg" speaking={isSpeaking} className="avatar-hover" />
      )}

      <span className={`text-sm font-medium truncate max-w-[120px]
        ${isEve ? 'text-neon-purple' : isMe ? 'text-neon-green' : 'text-text-primary'}`}>
        {vu.displayName}
        {isMe && <span className="text-text-muted text-xs ml-1">(you)</span>}
        {isEve && <span className="text-neon-purple/50 text-xs ml-1">AI</span>}
      </span>

      <div className="flex items-center gap-1">
        {isSpeaking ? (
          <div className="flex items-center gap-0.5">
            {[...Array(5)].map((_, i) => (
              <div key={i} className={`w-0.5 rounded-full ${isEve ? 'bg-neon-purple' : 'bg-neon-green'}`}
                style={{ height: '12px', animation: `pulse-bar 0.4s ease-in-out ${i * 0.1}s infinite alternate` }} />
            ))}
          </div>
        ) : (
          <div className={`w-2 h-2 rounded-full ${isEve ? 'bg-neon-purple/40' : 'bg-text-muted'}`} />
        )}
      </div>

      {!isMe && !isEve && inVoice && (
        <div className="w-full mt-1">
          <input type="range" min="0" max="1" step="0.05" value={Math.min(volume, 1.0)}
            onChange={(e) => useVoiceStore.getState().setUserVolume(vu.uid, parseFloat(e.target.value))}
            className="w-full h-1 bg-void-lighter rounded-lg appearance-none cursor-pointer accent-neon-green"
            title={`Volume: ${Math.round(volume * 100)}%`} />
          <p className="text-[10px] text-text-muted text-center font-mono mt-0.5">{Math.round(Math.min(volume, 1.0) * 100)}%</p>
        </div>
      )}
    </div>
  )
}
