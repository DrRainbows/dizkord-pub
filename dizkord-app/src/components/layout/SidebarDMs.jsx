import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { useChatStore } from '../../stores/chatStore'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../config/firebase'

export default function SidebarDMs({ onCloseMobile }) {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const dms = useChatStore(s => s.dms)
  const setActiveDM = useChatStore(s => s.setActiveDM)
  const [dmNames, setDmNames] = useState({})
  const dmFetchingRef = useRef(new Set())

  useEffect(() => {
    if (!dms.length || !user?.uid) return
    for (const dm of dms) {
      const otherUid = dm.participants?.find(p => p !== user.uid)
      if (!otherUid) continue
      if (dm.participantNames?.[otherUid] || dmNames[otherUid] || dmFetchingRef.current.has(otherUid)) continue
      dmFetchingRef.current.add(otherUid)
      getDoc(doc(db, 'users', otherUid)).then(snap => {
        if (snap.exists()) {
          const name = snap.data().displayName || 'anon'
          setDmNames(prev => ({ ...prev, [otherUid]: name }))
        }
      }).catch(() => {
        dmFetchingRef.current.delete(otherUid)
      })
    }
  }, [dms, user?.uid, dmNames])

  const navToDM = (dm) => {
    setActiveDM(dm)
    navigate(`/dm/${dm.id}`)
    onCloseMobile?.()
  }

  return (
    <div className="p-3 border-t border-void-border">
      <h3 className="text-text-muted text-xs font-mono uppercase tracking-wider mb-2">direct messages</h3>
      <div className="space-y-0.5">
        {dms.map((dm) => {
          const otherUid = dm.participants?.find(p => p !== user?.uid)
          const otherName = dm.participantNames?.[otherUid] || dmNames[otherUid] || 'loading...'
          return (
            <button
              key={dm.id}
              onClick={() => navToDM(dm)}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-void-lighter hover:text-text-primary transition-all"
            >
              {otherName}
            </button>
          )
        })}
      </div>
    </div>
  )
}
