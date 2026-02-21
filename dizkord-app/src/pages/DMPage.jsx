import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useChatStore } from '../stores/chatStore'
import ChatView from '../components/chat/ChatView'

export default function DMPage() {
  const { dmId } = useParams()
  const navigate = useNavigate()
  const dms = useChatStore(s => s.dms)
  const activeDM = useChatStore(s => s.activeDM)
  const setActiveDM = useChatStore(s => s.setActiveDM)

  // Sync DM from URL — skip if Sidebar already set it
  useEffect(() => {
    if (!dmId || !dms.length) return
    if (activeDM?.id === dmId) return
    const dm = dms.find(d => d.id === dmId)
    if (dm) {
      setActiveDM(dm)
    } else {
      navigate('/', { replace: true })
    }
  }, [dmId, dms, activeDM?.id, setActiveDM, navigate])

  if (!activeDM) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted font-mono text-sm">
        loading...
      </div>
    )
  }

  return <ChatView key={activeDM.id} type="dm" />
}
