import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChatStore } from '../../stores/chatStore'
import { useVoiceStore } from '../../stores/voiceStore'
import { startVoice, stopVoice } from '../../services/webrtc'
import { playJoinSound, playLeaveSound } from '../../services/audio'
import { collection, doc, updateDoc, query, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../../config/firebase'
import Avatar from '../ui/Avatar'
import { toast } from '../../stores/toastStore'

function sanitizeSingleLineInput(value) {
  return Array.from(value).filter((ch) => {
    const code = ch.charCodeAt(0)
    return code >= 32 && code !== 127
  }).join('')
}

export default function SidebarChannels({ onCloseMobile }) {
  const navigate = useNavigate()
  const {
    activeGroup, activeChannel, channels, createChannel,
  } = useChatStore()
  const { inVoice, joinVoiceChannel, leaveVoiceChannel, voiceChannelId } = useVoiceStore()

  const [joiningVoice, setJoiningVoice] = useState(false)
  const joiningVoiceRef = useRef(false)
  const [voicePresence, setVoicePresence] = useState({})
  const [latestMessages, setLatestMessages] = useState({})
  const [showAddChannel, setShowAddChannel] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [newChannelType, setNewChannelType] = useState('text')
  const [newChannelGame, setNewChannelGame] = useState('tron')
  const [newChannelCategory, setNewChannelCategory] = useState('')
  const groupPhotoRef = useRef(null)
  const readTimestampsRef = useRef({})

  useEffect(() => {
    try { readTimestampsRef.current = JSON.parse(localStorage.getItem('dizkord_reads') || '{}') } catch { readTimestampsRef.current = {} }
  }, [activeChannel])

  // listen to voice presence for all voice channels
  useEffect(() => {
    if (!activeGroup) return
    const voiceChans = channels.filter(c => c.type === 'voice')
    if (voiceChans.length === 0) return
    const unsubs = voiceChans.map((ch) => {
      const presRef = collection(db, 'groups', activeGroup.id, 'channels', ch.id, 'voicePresence')
      return onSnapshot(presRef, (snap) => {
        const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
        setVoicePresence(prev => ({ ...prev, [ch.id]: users }))
      })
    })
    return () => { unsubs.forEach(u => u()); setVoicePresence({}) }
  }, [activeGroup, channels])

  // listen for latest message in each text channel (unread badges)
  useEffect(() => {
    if (!activeGroup) return
    const textChans = channels.filter(c => c.type === 'text')
    if (textChans.length === 0) return
    const unsubs = textChans.map((ch) => {
      const q = query(
        collection(db, 'groups', activeGroup.id, 'channels', ch.id, 'messages'),
        orderBy('createdAt', 'desc'), limit(1)
      )
      return onSnapshot(q, (snap) => {
        if (snap.docs.length > 0) {
          const msg = snap.docs[0].data()
          const ts = msg.createdAt?.toMillis?.() || 0
          setLatestMessages(prev => prev[ch.id] === ts ? prev : { ...prev, [ch.id]: ts })
        }
      })
    })
    return () => { unsubs.forEach(u => u()); setLatestMessages({}) }
  }, [activeGroup, channels])

  const hasUnread = (channelId) => {
    const latest = latestMessages[channelId] || 0
    const lastRead = readTimestampsRef.current[channelId] || 0
    return latest > lastRead && activeChannel?.id !== channelId
  }

  const navToChannel = (ch) => {
    navigate(`/g/${activeGroup.id}/c/${ch.id}`)
    onCloseMobile?.()
  }

  const handleVoiceChannelClick = async (ch) => {
    navToChannel(ch)
    if (!inVoice && !joiningVoiceRef.current && activeGroup) {
      joiningVoiceRef.current = true
      setJoiningVoice(true)
      try {
        await joinVoiceChannel(activeGroup.id, ch.id)
        const ok = await startVoice(activeGroup.id, ch.id)
        if (ok) playJoinSound()
        else await leaveVoiceChannel()
      } catch { await leaveVoiceChannel().catch(() => {}) }
      finally { joiningVoiceRef.current = false; setJoiningVoice(false) }
    } else if (inVoice && voiceChannelId !== ch.id && activeGroup) {
      if (joiningVoiceRef.current) return
      try { stopVoice(); playLeaveSound(); await leaveVoiceChannel() } catch { /* continue */ }
      joiningVoiceRef.current = true
      setJoiningVoice(true)
      try {
        await joinVoiceChannel(activeGroup.id, ch.id)
        const ok = await startVoice(activeGroup.id, ch.id)
        if (ok) playJoinSound()
        else await leaveVoiceChannel()
      } catch { await leaveVoiceChannel().catch(() => {}) }
      finally { joiningVoiceRef.current = false; setJoiningVoice(false) }
    }
  }

  const handleGroupPhotoUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !activeGroup) return
    if (file.size > 5 * 1024 * 1024) { toast.error('Image too large (max 5MB)'); return }
    if (!file.type.startsWith('image/')) { toast.error('Only image files allowed'); return }
    try {
      const storageRef = ref(storage, `groups/${activeGroup.id}/icon`)
      await uploadBytes(storageRef, file)
      const url = await getDownloadURL(storageRef)
      await updateDoc(doc(db, 'groups', activeGroup.id), { icon: url })
    } catch (err) {
      console.error('group photo upload failed:', err)
      toast.error('Failed to upload group photo')
    }
  }

  const [creatingChannel, setCreatingChannel] = useState(false)
  const handleCreateChannel = async (e) => {
    e.preventDefault()
    if (!newChannelName.trim() || creatingChannel) return
    setCreatingChannel(true)
    try {
      const meta = newChannelType === 'arcade' ? { game: newChannelGame } : {}
      await createChannel(
        newChannelName.trim().toLowerCase().replace(/\s+/g, '-'),
        newChannelType, newChannelCategory.trim() || null, meta
      )
      setNewChannelName(''); setNewChannelType('text'); setNewChannelGame('tron'); setNewChannelCategory(''); setShowAddChannel(false)
    } catch {
      toast.error('Failed to create channel')
    } finally {
      setCreatingChannel(false)
    }
  }

  const textChannels = channels.filter(c => c.type === 'text')
  const voiceChannels = channels.filter(c => c.type === 'voice')
  const spinnerChannels = channels.filter(c => c.type === 'spinner')
  const arcadeChannels = channels.filter(c => c.type === 'arcade')

  if (!activeGroup) return null

  return (
    <div className="p-3">
      {/* Group header + photo */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className="relative group/gphoto cursor-pointer shrink-0" role="button" aria-label="Upload group photo" onClick={() => groupPhotoRef.current?.click()}>
          <Avatar src={activeGroup.icon} name={activeGroup.name} size="md" />
          <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover/gphoto:opacity-100 transition-opacity flex items-center justify-center">
            <span className="text-white text-[8px] font-mono">edit</span>
          </div>
          <input ref={groupPhotoRef} type="file" accept="image/*" className="hidden" onChange={handleGroupPhotoUpload} />
        </div>
        <div>
          <h2 className="font-display font-semibold text-text-primary text-sm">{activeGroup.name}</h2>
          <span className="text-text-muted text-[10px] font-mono">{activeGroup.members?.length || 0} members</span>
        </div>
      </div>

      {/* Text Channels */}
      <div className="mb-4" data-tour="channels">
        <h3 className="text-text-muted text-[10px] font-mono uppercase tracking-wider mb-1.5 px-1">text channels</h3>
        <div className="space-y-0.5">
          {textChannels.map((ch) => {
            const unread = hasUnread(ch.id)
            return (
              <button key={ch.id} onClick={() => navToChannel(ch)}
                className={`w-full text-left px-3 py-1.5 rounded-md text-sm font-mono transition-all flex items-center justify-between ${
                  activeChannel?.id === ch.id ? 'bg-neon-green/10 text-neon-green'
                    : unread ? 'text-text-primary font-semibold hover:bg-void-lighter'
                    : 'text-text-secondary hover:bg-void-lighter hover:text-text-primary'
                }`}>
                <span><span className="text-text-muted mr-1">#</span>{ch.name}</span>
                {unread && <span className="w-2 h-2 bg-neon-green rounded-full shrink-0" />}
              </button>
            )
          })}
        </div>
      </div>

      {/* Voice Channels */}
      <div className="mb-4">
        <h3 className="text-text-muted text-[10px] font-mono uppercase tracking-wider mb-1.5 px-1">voice channels</h3>
        <div className="space-y-0.5">
          {voiceChannels.map((ch) => {
            const usersInChannel = voicePresence[ch.id] || []
            return (
              <div key={ch.id}>
                <button onClick={() => handleVoiceChannelClick(ch)} disabled={joiningVoice}
                  aria-label={voiceChannelId === ch.id ? `Leave voice channel ${ch.name}` : `Join voice channel ${ch.name}`}
                  className={`w-full text-left px-3 py-1.5 rounded-md text-sm font-mono transition-all ${
                    voiceChannelId === ch.id ? 'bg-neon-purple/10 text-neon-purple'
                      : activeChannel?.id === ch.id ? 'bg-neon-purple/5 text-neon-purple/80'
                      : 'text-text-secondary hover:bg-void-lighter hover:text-text-primary'
                  }`}>
                  <span className="flex items-center justify-between">
                    <span>
                      <span className="mr-1">{voiceChannelId === ch.id ? '🟢' : '🔊'}</span>
                      {ch.name}
                      {joiningVoice && activeChannel?.id === ch.id && <span className="ml-1 text-[10px] text-text-muted">joining...</span>}
                    </span>
                    {usersInChannel.length > 0 && (
                      <span className="text-neon-green text-[10px] bg-neon-green/10 px-1.5 py-0.5 rounded-full">{usersInChannel.length}</span>
                    )}
                  </span>
                </button>
                {usersInChannel.length > 0 && (
                  <div className="ml-4 mt-1 mb-2 space-y-1">
                    {usersInChannel.map((vu) => (
                      <div key={vu.uid} className="flex items-center gap-2 px-2 py-0.5 rounded hover:bg-void-lighter transition-all">
                        <Avatar src={vu.photoURL} name={vu.displayName} size="xs" status="online" />
                        <span className="text-[11px] text-text-secondary font-mono truncate">{vu.displayName || 'anon'}</span>
                        {(vu.isScreenSharing) && <span className="text-[10px] shrink-0" title="sharing screen">🖥️</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Spinner Channels */}
      {spinnerChannels.length > 0 && (
        <div className="mb-4">
          <h3 className="text-text-muted text-[10px] font-mono uppercase tracking-wider mb-1.5 px-1">spinner</h3>
          <div className="space-y-0.5">
            {spinnerChannels.map((ch) => (
              <button key={ch.id} onClick={() => navToChannel(ch)}
                className={`w-full text-left px-3 py-1.5 rounded-md text-sm font-mono transition-all ${
                  activeChannel?.id === ch.id ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-text-secondary hover:bg-void-lighter hover:text-text-primary'
                }`}>
                <span className="text-text-muted mr-1">🎰</span>{ch.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Arcade Channels */}
      {arcadeChannels.length > 0 && (
        <div className="mb-4">
          <h3 className="text-text-muted text-[10px] font-mono uppercase tracking-wider mb-1.5 px-1">arcade</h3>
          <div className="space-y-0.5">
            {arcadeChannels.map((ch) => (
              <button key={ch.id} onClick={() => navToChannel(ch)}
                className={`w-full text-left px-3 py-1.5 rounded-md text-sm font-mono transition-all ${
                  activeChannel?.id === ch.id ? 'bg-neon-green/10 text-neon-green' : 'text-text-secondary hover:bg-void-lighter hover:text-text-primary'
                }`}>
                <span className="text-text-muted mr-1">{ch.game === 'stocks' ? '📈' : '🕹️'}</span>{ch.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Add Channel */}
      <div className="px-1">
        {showAddChannel ? (
          <form onSubmit={handleCreateChannel} className="animate-fade-in space-y-1.5">
            <input type="text" value={newChannelName} onChange={(e) => setNewChannelName(sanitizeSingleLineInput(e.target.value))}
              placeholder="channel name..." className="w-full px-2 py-1.5 rounded text-xs" autoFocus maxLength={64} />
            <div className="flex gap-1 flex-wrap">
              {[
                ['text', '# text', 'bg-neon-green/20 text-neon-green'],
                ['voice', '🔊 voice', 'bg-neon-purple/20 text-neon-purple'],
                ['spinner', '🎰 rng', 'bg-neon-cyan/20 text-neon-cyan'],
              ].map(([type, label, activeClass]) => (
                <button key={type} type="button" onClick={() => setNewChannelType(type)}
                  className={`flex-1 text-xs py-1.5 rounded font-mono min-w-[60px] ${newChannelType === type ? activeClass : 'bg-void text-text-muted'}`}>
                  {label}
                </button>
              ))}
              <button type="button" onClick={() => { setNewChannelType('arcade'); setNewChannelGame('tron') }}
                className={`flex-1 text-xs py-1.5 rounded font-mono min-w-[60px] ${newChannelType === 'arcade' && newChannelGame === 'tron' ? 'bg-neon-green/20 text-neon-green' : 'bg-void text-text-muted'}`}>
                🕹️ tron
              </button>
              <button type="button" onClick={() => { setNewChannelType('arcade'); setNewChannelGame('stocks') }}
                className={`flex-1 text-xs py-1.5 rounded font-mono min-w-[60px] ${newChannelType === 'arcade' && newChannelGame === 'stocks' ? 'bg-neon-green/20 text-neon-green' : 'bg-void text-text-muted'}`}>
                📈 stocks
              </button>
            </div>
            <input type="text" value={newChannelCategory} onChange={(e) => setNewChannelCategory(e.target.value)}
              placeholder="category (optional)..." className="w-full px-2 py-1.5 rounded text-xs" />
            <div className="flex gap-1">
              <button type="submit" disabled={creatingChannel} className="flex-1 bg-neon-green text-void text-xs py-1 rounded font-semibold hover:bg-neon-green/80 disabled:opacity-50">{creatingChannel ? '...' : 'create'}</button>
              <button type="button" onClick={() => setShowAddChannel(false)} className="text-text-muted text-xs px-2">nah</button>
            </div>
          </form>
        ) : (
          <button onClick={() => setShowAddChannel(true)}
            className="w-full text-left text-text-muted hover:text-neon-green text-xs font-mono py-1 px-2 rounded hover:bg-void-lighter transition-all">
            + add channel
          </button>
        )}
      </div>
    </div>
  )
}
