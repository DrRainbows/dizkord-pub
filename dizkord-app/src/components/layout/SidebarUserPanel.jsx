import { useAuthStore } from '../../stores/authStore'
import Avatar from '../ui/Avatar'

export default function SidebarUserPanel({ onOpenSettings }) {
  const user = useAuthStore(s => s.user)
  const userProfile = useAuthStore(s => s.userProfile)
  const logout = useAuthStore(s => s.logout)

  return (
    <div className="p-3 border-t border-void-border bg-void">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar src={user?.photoURL} name={user?.displayName} size="sm" status="online" className="avatar-hover" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{user?.displayName || 'anon'}</p>
            {userProfile?.customStatus ? (
              <p className="text-[10px] text-neon-purple font-mono truncate">{userProfile.customStatus}</p>
            ) : (
              <p className="text-[10px] text-neon-green font-mono">online</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onOpenSettings}
            className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-neon-purple hover:bg-void-lighter transition-all"
            title="settings"
            data-tour="settings"
            aria-label="Settings"
          >
            ⚙
          </button>
          <button
            onClick={logout}
            className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-neon-pink hover:bg-void-lighter transition-all"
            title="sign out"
            aria-label="Sign out"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
