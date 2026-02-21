import { useEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useChatStore } from '../stores/chatStore'

export default function InvitePage() {
  const { groupId: pathGroupId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const groups = useChatStore(s => s.groups)
  const joinGroup = useChatStore(s => s.joinGroup)
  const setActiveGroup = useChatStore(s => s.setActiveGroup)
  const handled = useRef(false)

  // Accept groupId from path (/invite/:groupId) or query (?invite=groupId)
  const groupId = pathGroupId || searchParams.get('invite')

  useEffect(() => {
    if (!groupId || handled.current) return
    handled.current = true

    async function join() {
      try {
        // Already a member? Navigate directly.
        const existing = groups.find(g => g.id === groupId)
        if (existing) {
          setActiveGroup(existing)
          navigate(`/g/${groupId}`, { replace: true })
          return
        }

        await joinGroup(groupId)

        // Poll for the group to appear in the store (snapshot is async)
        const poll = setInterval(() => {
          const current = useChatStore.getState().groups
          const joined = current.find(g => g.id === groupId)
          if (joined) {
            clearInterval(poll)
            setActiveGroup(joined)
            navigate(`/g/${groupId}`, { replace: true })
          }
        }, 200)
        setTimeout(() => {
          clearInterval(poll)
          // If still not resolved after 5s, navigate home
          if (window.location.pathname.includes('invite')) {
            navigate('/', { replace: true })
          }
        }, 5000)
      } catch (err) {
        console.error('[invite] join failed:', err.message)
        navigate('/', { replace: true })
      }
    }

    join()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  return (
    <div className="flex-1 flex items-center justify-center text-text-muted font-mono text-sm">
      joining group...
    </div>
  )
}
