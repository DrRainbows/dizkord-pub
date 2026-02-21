import { useState, useEffect } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db, auth } from '../../config/firebase'
import { useChatStore } from '../../stores/chatStore'

export default function TypingIndicator() {
  const { activeGroup, activeChannel } = useChatStore()
  const [typingUsers, setTypingUsers] = useState([])

  useEffect(() => {
    if (!activeGroup || !activeChannel || activeChannel.type !== 'text') return

    const typingRef = collection(
      db, 'groups', activeGroup.id, 'channels', activeChannel.id, 'typing'
    )

    const unsub = onSnapshot(typingRef, (snap) => {
      const uid = auth.currentUser?.uid
      const now = Date.now()
      const users = snap.docs
        .map(d => ({ uid: d.id, ...d.data() }))
        .filter(u => u.uid !== uid && u.timestamp?.toMillis && (now - u.timestamp.toMillis()) < 5000)
      setTypingUsers(users)
    })

    return () => {
      unsub()
      setTypingUsers([])
    }
  }, [activeGroup, activeChannel])

  if (typingUsers.length === 0) return null

  const names = typingUsers.map(u => u.displayName).join(', ')

  return (
    <div className="px-4 py-1 text-text-muted text-xs font-mono animate-fade-in flex items-center gap-1.5">
      <span className="flex gap-0.5">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="w-1 h-1 bg-neon-green rounded-full"
            style={{ animation: `typing-dot 1s ease-in-out ${i * 0.15}s infinite` }}
          />
        ))}
      </span>
      <span>{names} {typingUsers.length === 1 ? 'is' : 'are'} cooking...</span>
    </div>
  )
}
