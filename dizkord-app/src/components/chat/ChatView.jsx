import { useState, useEffect, useMemo, useCallback } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useAuthStore } from '../../stores/authStore'
import { playMessageSound, playMentionSound } from '../../services/audio'
import { auth } from '../../config/firebase'
import useAutoScroll from '../../hooks/useAutoScroll'
import Avatar from '../ui/Avatar'
import TypingIndicator from './TypingIndicator'
import MessageContent from './MessageContent'
import MessageInput from './MessageInput'
import MemberSidebar from './MemberSidebar'

const QUICK_REACTIONS = ['🔥', '😂', '❤️', '💀', '👀', '🫡', '💯', '⚡']

function getRelativeTime(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  const now = new Date()
  const diff = Math.floor((now - d) / 1000)
  if (diff < 10) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function ReactionBar({ reactions, messageId, uid, showPicker, setShowPicker }) {
  const toggleReaction = useChatStore(s => s.toggleReaction)
  const reactionEntries = reactions ? Object.entries(reactions).filter(([, uids]) => uids.length > 0) : []
  if (reactionEntries.length === 0 && !showPicker) return null

  return (
    <div className="flex items-center gap-1 mt-1 pl-8 flex-wrap">
      {reactionEntries.map(([emoji, uids]) => (
        <button key={emoji} onClick={() => toggleReaction(messageId, emoji)}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs transition-all border ${
            uids.includes(uid) ? 'bg-neon-green/10 border-neon-green/30 text-neon-green' : 'bg-void-lighter border-void-border text-text-secondary hover:border-neon-green/20'
          }`}>
          <span>{emoji}</span><span className="font-mono text-[10px]">{uids.length}</span>
        </button>
      ))}
      {showPicker && (
        <div className="relative">
          <div className="absolute bottom-full left-0 mb-1 flex gap-0.5 p-1 rounded-lg glass border border-void-border animate-fade-in z-20">
            {QUICK_REACTIONS.map((emoji) => (
              <button key={emoji} onClick={() => { toggleReaction(messageId, emoji); setShowPicker(false) }}
                className="w-7 h-7 rounded hover:bg-void-lighter flex items-center justify-center transition-all hover:scale-110">
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ChatView({ type = 'channel' }) {
  const user = useAuthStore(s => s.user)
  const activeGroup = useChatStore(s => s.activeGroup)
  const activeChannel = useChatStore(s => s.activeChannel)
  const messages = useChatStore(s => s.messages)
  const activeDM = useChatStore(s => s.activeDM)
  const dmMessages = useChatStore(s => s.dmMessages)
  const editMessage = useChatStore(s => s.editMessage)
  const deleteMessage = useChatStore(s => s.deleteMessage)
  const togglePinMessage = useChatStore(s => s.togglePinMessage)
  const setChannelTopic = useChatStore(s => s.setChannelTopic)
  const groupMembers = useChatStore(s => s.groupMembers)
  const loadGroupMembers = useChatStore(s => s.loadGroupMembers)

  const [input, setInput] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState(null)
  const [tappedMsgId, setTappedMsgId] = useState(null)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showPinned, setShowPinned] = useState(false)
  const [editingTopic, setEditingTopic] = useState(false)
  const [topicDraft, setTopicDraft] = useState('')
  const [showMembers, setShowMembers] = useState(false)
  const [replyingTo, setReplyingTo] = useState(null)
  // tick every 60s to refresh relative timestamps
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000)
    return () => clearInterval(id)
  }, [])

  const currentMessages = type === 'dm' ? dmMessages : messages

  const filteredMessages = useMemo(() => {
    if (searchQuery) return currentMessages.filter(m => m.text?.toLowerCase().includes(searchQuery.toLowerCase()))
    if (showPinned) return currentMessages.filter(m => m.pinned)
    return currentMessages
  }, [currentMessages, searchQuery, showPinned])

  const handleNewMessage = useCallback((msg) => {
    if (msg.mentions?.includes(auth.currentUser?.uid)) playMentionSound()
    else playMessageSound()
  }, [])

  const { endRef, containerRef } = useAutoScroll(currentMessages, user?.uid, { onNewMessage: handleNewMessage })

  useEffect(() => {
    if (activeGroup?.id) loadGroupMembers(activeGroup.id)
  }, [activeGroup?.id, loadGroupMembers])

  // close reaction picker on click outside
  useEffect(() => {
    if (!reactionPickerMsgId) return
    const close = () => setReactionPickerMsgId(null)
    const timer = setTimeout(() => document.addEventListener('click', close), 0)
    return () => { clearTimeout(timer); document.removeEventListener('click', close) }
  }, [reactionPickerMsgId])

  if (type === 'channel' && !activeGroup) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted font-mono text-sm">
        <div className="text-center">
          <p className="text-2xl mb-2">{"<"}/{">"}</p>
          <p>select a group to start chatting</p>
          <p className="text-text-muted/50 text-xs mt-1">or create one from the sidebar</p>
        </div>
      </div>
    )
  }

  if (type === 'channel' && activeGroup && !activeChannel) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted font-mono text-sm">
        <div className="text-center">
          <p className="text-2xl mb-2">#</p>
          <p>pick a channel from the sidebar</p>
          <p className="text-text-muted/50 text-xs mt-1">text or voice, your call</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
      {/* Channel header */}
      {type === 'channel' && activeChannel && (
        <div className="border-b border-void-border px-4 py-2 bg-void-light/50 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="font-display font-semibold text-text-primary flex items-center gap-2 shrink-0">
                <span className="text-text-muted font-mono text-sm">#</span>{activeChannel.name}
              </h2>
              {activeChannel.topic && !editingTopic && (
                <span className="text-text-muted text-xs font-mono truncate cursor-pointer hover:text-text-secondary transition-colors"
                  onClick={() => { setEditingTopic(true); setTopicDraft(activeChannel.topic || '') }} title="click to edit topic">
                  — {activeChannel.topic}
                </span>
              )}
              {!activeChannel.topic && !editingTopic && (
                <button className="text-text-muted/40 text-xs font-mono hover:text-text-muted transition-colors"
                  onClick={() => { setEditingTopic(true); setTopicDraft('') }}>+ set topic</button>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => setShowSearch(!showSearch)}
                className={`w-7 h-7 rounded-md flex items-center justify-center text-xs transition-all ${showSearch ? 'text-neon-green bg-neon-green/10' : 'text-text-muted hover:text-text-primary hover:bg-void-lighter'}`}
                title="search" aria-label="Search messages">🔍</button>
              <button onClick={() => setShowPinned(!showPinned)}
                className={`w-7 h-7 rounded-md flex items-center justify-center text-xs transition-all ${showPinned ? 'text-neon-yellow bg-neon-yellow/10' : 'text-text-muted hover:text-text-primary hover:bg-void-lighter'}`}
                title="pinned messages" aria-label="Pinned messages">📌</button>
              <button onClick={() => setShowMembers(!showMembers)}
                className={`w-7 h-7 rounded-md flex items-center justify-center text-xs transition-all ${showMembers ? 'text-neon-purple bg-neon-purple/10' : 'text-text-muted hover:text-text-primary hover:bg-void-lighter'}`}
                title="members" aria-label="Members list">👥</button>
            </div>
          </div>
          {editingTopic && (
            <form className="flex gap-1.5 mt-1.5" onSubmit={async (e) => { e.preventDefault(); await setChannelTopic(activeChannel.id, topicDraft.trim() || null); setEditingTopic(false) }}>
              <input type="text" value={topicDraft} onChange={(e) => setTopicDraft(e.target.value)}
                className="flex-1 px-2 py-1 rounded text-xs" placeholder="channel topic..." autoFocus maxLength={100}
                onKeyDown={(e) => { if (e.key === 'Escape') setEditingTopic(false) }} />
              <button type="submit" className="text-neon-green text-[10px] font-mono px-2 py-1 rounded hover:bg-neon-green/10">save</button>
              <button type="button" onClick={() => setEditingTopic(false)} className="text-text-muted text-[10px] font-mono px-2 py-1">esc</button>
            </form>
          )}
          {showSearch && (
            <div className="mt-1.5">
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg text-xs" placeholder="search messages..." autoFocus />
            </div>
          )}
        </div>
      )}

      {type === 'dm' && activeDM && (
        <div className="border-b border-void-border px-4 py-3 bg-void-light/50">
          <h2 className="font-display font-semibold text-text-primary">Direct Message</h2>
        </div>
      )}

      {/* Messages + side panels */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
          {filteredMessages.length === 0 && activeChannel?.type === 'text' && (
            <div className="text-center text-text-muted font-mono text-sm py-8">
              <p className="text-lg mb-1">{showPinned ? '📌' : searchQuery ? '🔍' : '{ }'}</p>
              <p>{showPinned ? 'no pinned messages' : searchQuery ? 'no results' : 'no messages yet'}</p>
              <p className="text-xs text-text-muted/50">{!showPinned && !searchQuery && 'be the main character, send the first message'}</p>
            </div>
          )}
          {filteredMessages.map((msg, i, arr) => {
            const isOwn = msg.uid === user?.uid
            const showHeader = i === 0 || arr[i - 1]?.uid !== msg.uid
            return (
              <div key={msg.id} className="group animate-fade-in relative"
                onClick={() => setTappedMsgId(tappedMsgId === msg.id ? null : msg.id)}>
                {showHeader && (
                  <div className={`flex items-center gap-2 mb-1 ${i > 0 ? 'mt-4' : ''}`}>
                    <Avatar src={msg.photoURL} name={msg.displayName} size="xs" className="avatar-hover" />
                    <span className={`font-semibold text-sm ${isOwn ? 'text-neon-green' : 'text-neon-purple'}`}>{msg.displayName}</span>
                    <span className="text-text-muted text-[10px] font-mono">
                      {getRelativeTime(msg.createdAt)}
                      {msg.editedAt && <span className="ml-1 text-text-muted/50">(edited)</span>}
                    </span>
                  </div>
                )}
                {msg.pinned && <div className="pl-8 mb-0.5"><span className="text-neon-yellow text-[10px] font-mono">📌 pinned</span></div>}
                {msg.replyTo && (
                  <div className="pl-8 mb-1">
                    <div className="border-l-2 border-neon-purple/30 pl-3 py-1 text-xs text-text-muted flex items-center gap-1.5">
                      {msg.replyTo.imageURL && <img src={msg.replyTo.imageURL} alt="" className="w-6 h-6 rounded object-cover shrink-0" />}
                      <span>
                        <span className="text-neon-purple/70">@{msg.replyTo.displayName}</span>
                        {msg.replyTo.text ? `: ${msg.replyTo.text.length > 80 ? msg.replyTo.text.slice(0, 80) + '...' : msg.replyTo.text}` : ''}
                      </span>
                    </div>
                  </div>
                )}
                {/* message actions */}
                {type !== 'dm' && editingId !== msg.id && (
                  <div className={`absolute right-0 top-0 items-center gap-0.5 bg-void-light border border-void-border rounded-md px-1 py-0.5 z-10 ${tappedMsgId === msg.id ? 'flex' : 'hidden group-hover:flex'}`}>
                    <button onClick={() => setReactionPickerMsgId(reactionPickerMsgId === msg.id ? null : msg.id)}
                      className="text-text-muted hover:text-neon-green text-[10px] font-mono px-1.5 py-0.5 rounded hover:bg-void-lighter transition-all">+</button>
                    <button onClick={() => setReplyingTo(msg)}
                      className="text-text-muted hover:text-neon-cyan text-[10px] font-mono px-1.5 py-0.5 rounded hover:bg-void-lighter transition-all">reply</button>
                    <button onClick={() => togglePinMessage(msg.id)}
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded hover:bg-void-lighter transition-all ${msg.pinned ? 'text-neon-yellow' : 'text-text-muted hover:text-neon-yellow'}`}>
                      {msg.pinned ? 'unpin' : 'pin'}
                    </button>
                    {isOwn && msg.text && (
                      <button onClick={() => { setEditingId(msg.id); setEditText(msg.text) }}
                        className="text-text-muted hover:text-neon-green text-[10px] font-mono px-1.5 py-0.5 rounded hover:bg-void-lighter transition-all">edit</button>
                    )}
                    {isOwn && (
                      <button onClick={() => { if (window.confirm('Delete this message?')) deleteMessage(msg.id) }}
                        className="text-text-muted hover:text-neon-pink text-[10px] font-mono px-1.5 py-0.5 rounded hover:bg-void-lighter transition-all">del</button>
                    )}
                  </div>
                )}
                {/* text content */}
                {editingId === msg.id ? (
                  <form className="pl-8 flex gap-1.5 items-center"
                    onSubmit={async (e) => { e.preventDefault(); if (editText.trim() && editText.trim() !== msg.text) await editMessage(msg.id, editText.trim()); setEditingId(null) }}>
                    <input type="text" value={editText} onChange={(e) => setEditText(e.target.value)}
                      className="flex-1 px-2 py-1 rounded text-sm" autoFocus onKeyDown={(e) => { if (e.key === 'Escape') setEditingId(null) }} />
                    <button type="submit" className="text-neon-green text-[10px] font-mono px-1.5 py-1 rounded hover:bg-neon-green/10 transition-all">save</button>
                    <button type="button" onClick={() => setEditingId(null)} className="text-text-muted text-[10px] font-mono px-1.5 py-1 rounded hover:bg-void-lighter transition-all">esc</button>
                  </form>
                ) : msg.text ? (
                  <div className="text-text-primary text-sm pl-8 leading-relaxed"><MessageContent text={msg.text} /></div>
                ) : null}
                {/* image content */}
                {msg.imageURL && (
                  <div className="pl-8 mt-1 relative group/img inline-block">
                    <img src={msg.imageURL} alt="shared" loading="lazy"
                      className="max-w-[80vw] md:max-w-sm max-h-80 rounded-lg border border-void-border object-contain cursor-pointer hover:border-neon-green/30 transition-all"
                      onClick={(e) => { e.stopPropagation(); window.open(msg.imageURL, '_blank') }} />
                    {type !== 'dm' && (
                      <div className={`absolute top-2 right-2 gap-1 ${tappedMsgId === msg.id ? 'flex' : 'hidden group-hover/img:flex'}`}>
                        <button onClick={(e) => { e.stopPropagation(); setReplyingTo(msg); setInput('@grok imagine ') }}
                          className="px-2 py-1 rounded-md glass border border-void-border text-[10px] font-mono text-neon-cyan hover:bg-void-lighter transition-all" title="edit image with grok">
                          🎨 edit
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setReplyingTo(msg); setInput('@grok video ') }}
                          className="px-2 py-1 rounded-md glass border border-void-border text-[10px] font-mono text-neon-purple hover:bg-void-lighter transition-all" title="make video from image">
                          🎬 video
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {msg.videoURL && (
                  <div className="pl-8 mt-1">
                    <video src={msg.videoURL} controls className="max-w-[80vw] md:max-w-md max-h-80 rounded-lg border border-void-border" preload="metadata" />
                  </div>
                )}
                <ReactionBar reactions={msg.reactions} messageId={msg.id} uid={user?.uid}
                  showPicker={reactionPickerMsgId === msg.id} setShowPicker={(show) => setReactionPickerMsgId(show ? msg.id : null)} />
              </div>
            )
          })}
          <div ref={endRef} />
        </div>

        {showMembers && <MemberSidebar members={groupMembers} onClose={() => setShowMembers(false)} />}
      </div>

      {type === 'channel' && <TypingIndicator />}

      <MessageInput
        type={type}
        input={input}
        setInput={setInput}
        replyingTo={replyingTo}
        onClearReply={() => setReplyingTo(null)}
      />
    </div>
  )
}
