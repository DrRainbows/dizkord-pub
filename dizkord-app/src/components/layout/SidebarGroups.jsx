import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChatStore } from '../../stores/chatStore'
import { toast } from '../../stores/toastStore'
import Avatar from '../ui/Avatar'

function sanitizeSingleLineInput(value) {
  return Array.from(value).filter((ch) => {
    const code = ch.charCodeAt(0)
    return code >= 32 && code !== 127
  }).join('')
}

export default function SidebarGroups({ onCloseMobile }) {
  const navigate = useNavigate()
  const groups = useChatStore(s => s.groups)
  const createGroup = useChatStore(s => s.createGroup)
  const joinGroup = useChatStore(s => s.joinGroup)
  const setActiveGroup = useChatStore(s => s.setActiveGroup)
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [joinId, setJoinId] = useState('')
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)

  const navToGroup = (group) => {
    setActiveGroup(group)
    navigate(`/g/${group.id}`)
    onCloseMobile?.()
  }

  const handleCreateGroup = async (e) => {
    e.preventDefault()
    if (!groupName.trim() || creating) return
    setCreating(true)
    try {
      const newId = await createGroup(groupName.trim())
      setGroupName('')
      setShowCreate(false)
      if (newId) navigate(`/g/${newId}`)
    } catch {
      toast.error('Failed to create group')
    } finally {
      setCreating(false)
    }
  }

  const handleJoinGroup = async (e) => {
    e.preventDefault()
    if (!joinId.trim() || joining) return
    setJoining(true)
    try {
      await joinGroup(joinId.trim())
      setJoinId('')
      setShowJoin(false)
    } catch {
      toast.error('Failed to join group')
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-text-muted text-xs font-mono uppercase tracking-wider">groups</h3>
        <div className="flex gap-1">
          <button
            onClick={() => setShowJoin(!showJoin)}
            className="text-text-muted hover:text-neon-purple text-sm px-1.5 py-0.5 rounded hover:bg-void-lighter transition-all"
            title="Join group"
            aria-label="Join group"
          >
            +id
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="text-text-muted hover:text-neon-green text-lg leading-none px-1.5 rounded hover:bg-void-lighter transition-all"
            title="Create group"
            aria-label="Create group"
          >
            +
          </button>
        </div>
      </div>

      {showJoin && (
        <form onSubmit={handleJoinGroup} className="mb-2 animate-fade-in">
          <input type="text" value={joinId} onChange={(e) => setJoinId(e.target.value)}
            placeholder="paste group id..." className="w-full px-2 py-1.5 rounded text-xs mb-1" autoFocus />
          <div className="flex gap-1">
            <button type="submit" disabled={joining} className="flex-1 bg-neon-purple text-void text-xs py-1 rounded font-semibold hover:bg-neon-purple/80 disabled:opacity-50">{joining ? '...' : 'join'}</button>
            <button type="button" onClick={() => setShowJoin(false)} className="text-text-muted text-xs px-2">nah</button>
          </div>
        </form>
      )}

      {showCreate && (
        <form onSubmit={handleCreateGroup} className="mb-2 animate-fade-in">
          <input type="text" value={groupName} onChange={(e) => setGroupName(sanitizeSingleLineInput(e.target.value))}
            placeholder="group name..." className="w-full px-2 py-1.5 rounded text-xs mb-1" autoFocus maxLength={64} />
          <div className="flex gap-1">
            <button type="submit" disabled={creating} className="flex-1 bg-neon-green text-void text-xs py-1 rounded font-semibold hover:bg-neon-green/80 disabled:opacity-50">{creating ? '...' : 'create'}</button>
            <button type="button" onClick={() => setShowCreate(false)} className="text-text-muted text-xs px-2">nah</button>
          </div>
        </form>
      )}

      <div className="space-y-0.5" data-tour="groups">
        {groups.map((group) => (
          <button
            key={group.id}
            onClick={() => navToGroup(group)}
            className="w-full text-left px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-void-lighter hover:text-text-primary transition-all flex items-center gap-2"
          >
            <Avatar src={group.icon} name={group.name} size="sm" className="shrink-0" />
            <div className="min-w-0">
              <span className="block truncate">{group.name}</span>
              <span className="text-[10px] text-text-muted block font-mono">{group.members?.length || 0} members</span>
            </div>
          </button>
        ))}
        {groups.length === 0 && (
          <p className="text-text-muted text-xs font-mono px-3 py-2">
            no groups yet... create one or join with an id
          </p>
        )}
      </div>
    </div>
  )
}
