import { useVoiceStore } from '../../stores/voiceStore'
import { useAuthStore } from '../../stores/authStore'
import VoiceUser from './VoiceUser'

export default function VoiceUserGrid({ onContextMenu }) {
  const user = useAuthStore(s => s.user)
  const voiceUsers = useVoiceStore(s => s.voiceUsers)
  const speakingUsers = useVoiceStore(s => s.speakingUsers)
  const userVolumes = useVoiceStore(s => s.userVolumes)
  const inVoice = useVoiceStore(s => s.inVoice)

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6 max-w-4xl w-full">
        {voiceUsers.map((vu) => {
          const isMe = vu.uid === user?.uid
          const isEve = vu.uid === 'eve' || vu.isBot
          return (
            <VoiceUser
              key={vu.uid}
              vu={vu}
              isSpeaking={!!speakingUsers[vu.uid]}
              isMe={isMe}
              isEve={isEve}
              inVoice={inVoice}
              volume={userVolumes[vu.uid] ?? 1.0}
              onContextMenu={(e) => {
                if (!isMe && !isEve) {
                  e.preventDefault()
                  onContextMenu?.({ user: vu, position: { x: e.clientX, y: e.clientY } })
                }
              }}
            />
          )
        })}
        {voiceUsers.length === 0 && (
          <div className="col-span-full text-center text-text-muted font-mono text-sm py-12">
            <p className="text-3xl mb-3">🎧</p>
            <p>voice channel is empty</p>
            <p className="text-xs text-text-muted/50 mt-1">hit join to be the first one in</p>
          </div>
        )}
      </div>
    </div>
  )
}
