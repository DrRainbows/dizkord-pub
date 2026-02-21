import { useEffect, lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useSearchParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import { useChatStore } from './stores/chatStore'
import AuthPage from './components/auth/AuthPage'
import AppShell from './components/layout/AppShell'
import LoadingScreen from './components/ui/LoadingScreen'
import Toast from './components/ui/Toast'

const GroupPage = lazy(() => import('./pages/GroupPage'))
const DMPage = lazy(() => import('./pages/DMPage'))
const InvitePage = lazy(() => import('./pages/InvitePage'))

function DefaultRoute() {
  const groups = useChatStore(s => s.groups)
  const activeGroup = useChatStore(s => s.activeGroup)

  if (activeGroup) {
    return <Navigate to={`/g/${activeGroup.id}`} replace />
  }

  return (
    <div className="flex-1 flex items-center justify-center text-text-muted font-mono text-sm">
      <div className="text-center">
        <p className="text-2xl mb-2">⚡</p>
        <p>{groups.length > 0 ? 'select a group from the sidebar' : 'no groups yet — create one or join with an invite link'}</p>
      </div>
    </div>
  )
}

function PendingInviteRedirect() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)

  useEffect(() => {
    if (!user) return

    // Check for ?invite= query param (from OG redirect in production)
    const inviteId = searchParams.get('invite')
    if (inviteId) {
      navigate(`/invite/${inviteId}`, { replace: true })
      return
    }

    // Check for pending invite stored before login
    const pending = localStorage.getItem('dizkord_pending_invite')
    if (pending) {
      localStorage.removeItem('dizkord_pending_invite')
      navigate(`/invite/${pending}`, { replace: true })
    }
  }, [user, searchParams, navigate])

  return null
}

function AuthGate() {
  const { user, loading, init } = useAuthStore()
  const listenGroups = useChatStore(s => s.listenGroups)
  const listenDMs = useChatStore(s => s.listenDMs)

  useEffect(() => {
    const unsub = init()
    return () => { if (unsub) unsub() }
  }, [init])

  // App-level Firestore subscriptions (groups + DMs)
  useEffect(() => {
    if (!user) return
    const unsubGroups = listenGroups()
    const unsubDMs = listenDMs()
    return () => {
      if (unsubGroups) unsubGroups()
      if (unsubDMs) unsubDMs()
    }
  }, [user, listenGroups, listenDMs])

  if (loading) return <LoadingScreen />

  if (!user) {
    // Store invite for after login if arriving at /invite/:id while logged out
    const pathMatch = window.location.pathname.match(/^\/invite\/(.+)/)
    if (pathMatch) {
      localStorage.setItem('dizkord_pending_invite', pathMatch[1])
    }
    const inviteParam = new URLSearchParams(window.location.search).get('invite')
    if (inviteParam) {
      localStorage.setItem('dizkord_pending_invite', inviteParam)
    }
    return <AuthPage />
  }

  return (
    <>
      <PendingInviteRedirect />
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/g/:groupId/c/:channelId" element={<Suspense fallback={<LoadingScreen />}><GroupPage /></Suspense>} />
          <Route path="/g/:groupId" element={<Suspense fallback={<LoadingScreen />}><GroupPage /></Suspense>} />
          <Route path="/dm/:dmId" element={<Suspense fallback={<LoadingScreen />}><DMPage /></Suspense>} />
          <Route path="/invite/:groupId" element={<Suspense fallback={<LoadingScreen />}><InvitePage /></Suspense>} />
          <Route path="*" element={<DefaultRoute />} />
        </Route>
      </Routes>
    </>
  )
}

export default function App() {
  return (
    <>
      <AuthGate />
      <Toast />
    </>
  )
}
