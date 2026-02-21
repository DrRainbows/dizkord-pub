import Avatar from '../ui/Avatar'

export default function MemberSidebar({ members, onClose }) {
  return (
    <>
      {/* Mobile: slide-in drawer with backdrop */}
      <div className="md:hidden fixed inset-0 z-40" onClick={onClose}>
        <div className="absolute inset-0 bg-black/50" />
        <div className="absolute right-0 top-0 bottom-0 w-64 bg-void-light border-l border-void-border overflow-y-auto p-3 animate-fade-in"
          onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-text-muted text-[10px] font-mono uppercase tracking-wider">
              members — {members.length}
            </h3>
            <button onClick={onClose} className="text-text-muted hover:text-neon-pink text-xs font-mono">[close]</button>
          </div>
          <MemberList members={members} />
        </div>
      </div>

      {/* Desktop: inline sidebar */}
      <div className="hidden md:block w-48 border-l border-void-border bg-void-light/50 overflow-y-auto shrink-0 p-3">
        <h3 className="text-text-muted text-[10px] font-mono uppercase tracking-wider mb-2">
          members — {members.length}
        </h3>
        <MemberList members={members} />
      </div>
    </>
  )
}

function MemberList({ members }) {
  return (
    <div className="space-y-1.5">
      {members.length === 0 && (
        <p className="text-text-muted text-xs font-mono">loading...</p>
      )}
      {members.map(m => (
        <div key={m.uid} className="flex items-center gap-2">
          <Avatar src={m.photoURL} name={m.displayName} size="xs" status={m.status || 'offline'} />
          <div className="min-w-0">
            <p className="text-xs text-text-primary truncate">{m.displayName}</p>
            {m.customStatus && <p className="text-[9px] text-text-muted truncate">{m.customStatus}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}
