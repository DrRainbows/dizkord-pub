import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useAuthStore } from '../../stores/authStore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../../config/firebase'
import AutocompleteDropdown from './AutocompleteDropdown'

const INPUT_PLACEHOLDERS = [
  'drop something based...',
  'say something iconic...',
  'speak your truth...',
  'manifest a message...',
  'cook up a take...',
  'bless the chat...',
]

export default function MessageInput({ type, input, setInput, replyingTo, onClearReply }) {
  const user = useAuthStore(s => s.user)
  const activeGroup = useChatStore(s => s.activeGroup)
  const activeChannel = useChatStore(s => s.activeChannel)
  const sendMessage = useChatStore(s => s.sendMessage)
  const sendImageMessage = useChatStore(s => s.sendImageMessage)
  const sendDM = useChatStore(s => s.sendDM)
  const startTyping = useChatStore(s => s.startTyping)
  const stopTyping = useChatStore(s => s.stopTyping)
  const groupMembers = useChatStore(s => s.groupMembers)

  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [mentionQuery, setMentionQuery] = useState(null)
  const [autocompleteIdx, setAutocompleteIdx] = useState(0)
  const typingTimeoutRef = useRef(null)
  const fileInputRef = useRef(null)
  const [placeholder] = useState(() => INPUT_PLACEHOLDERS[Math.floor(Math.random() * INPUT_PLACEHOLDERS.length)])

  const autocompleteItems = useMemo(() => {
    if (mentionQuery === null) return []
    const grokCommands = [
      { type: 'grok', cmd: '@grok ', label: 'ask grok anything', icon: '🤖', desc: '@grok what is...' },
      { type: 'grok', cmd: '@grok imagine ', label: 'generate an image', icon: '🎨', desc: '@grok imagine a cat in space' },
      { type: 'grok', cmd: '@grok video ', label: 'generate a video', icon: '🎬', desc: '@grok video a sunset timelapse' },
    ].filter(c => c.cmd.toLowerCase().startsWith(`@${mentionQuery}`) || 'grok'.startsWith(mentionQuery))
    const memberMatches = groupMembers
      .filter(m => m.uid !== user?.uid && m.displayName?.toLowerCase().includes(mentionQuery))
      .slice(0, 5)
      .map(m => ({ type: 'member', ...m }))
    return [...grokCommands, ...memberMatches]
  }, [mentionQuery, groupMembers, user?.uid])

  // clean up typing indicator on unmount / tab close
  useEffect(() => {
    const cleanup = () => stopTyping()
    window.addEventListener('beforeunload', cleanup)
    return () => { window.removeEventListener('beforeunload', cleanup); stopTyping() }
  }, [stopTyping])

  const handleInputChange = useCallback((e) => {
    const val = e.target.value
    setInput(val)
    const atMatch = val.match(/@(\w*)$/)
    if (atMatch) { setMentionQuery(atMatch[1].toLowerCase()); setAutocompleteIdx(0) }
    else setMentionQuery(null)

    if (type !== 'dm' && val.trim()) {
      startTyping()
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = setTimeout(() => stopTyping(), 3000)
    }
  }, [type, startTyping, stopTyping, setInput])

  const handleAutocompleteSelect = useCallback((item) => {
    if (item?.type === 'grok') setInput(prev => prev.replace(/@\w*$/, item.cmd))
    else if (item?.type === 'member') setInput(prev => prev.replace(/@\w*$/, `@${item.displayName} `))
    setMentionQuery(null)
  }, [setInput])

  const handleInputKeyDown = useCallback((e) => {
    if (mentionQuery === null || autocompleteItems.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setAutocompleteIdx(i => (i + 1) % autocompleteItems.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAutocompleteIdx(i => (i - 1 + autocompleteItems.length) % autocompleteItems.length) }
    else if (e.key === 'Tab' || (e.key === 'Enter' && autocompleteItems.length > 0)) {
      e.preventDefault()
      handleAutocompleteSelect(autocompleteItems[autocompleteIdx])
    } else if (e.key === 'Escape') { setMentionQuery(null) }
  }, [mentionQuery, autocompleteItems, autocompleteIdx, handleAutocompleteSelect])

  const handleSend = async (e) => {
    e.preventDefault()
    if (!input.trim()) return
    const text = input.trim()
    const reply = replyingTo
    setInput('')
    onClearReply?.()
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    if (type === 'dm') await sendDM(text)
    else await sendMessage(text, reply)
  }

  const handleImageUpload = async (file) => {
    if (!file || !activeGroup || !activeChannel) return
    if (file.size > 10 * 1024 * 1024 || !file.type.startsWith('image/')) return
    setUploading(true); setUploadError(null)
    try {
      const storageRef = ref(storage, `groups/${activeGroup.id}/attachments/${Date.now()}-${file.name}`)
      await uploadBytes(storageRef, file)
      const url = await getDownloadURL(storageRef)
      await sendImageMessage(url)
    } catch (err) {
      console.error('image upload failed:', err)
      setUploadError('upload failed, try again')
      setTimeout(() => setUploadError(null), 4000)
    }
    setUploading(false)
  }

  // paste handler for images
  const imageUploadRef = useRef(null)
  useEffect(() => { imageUploadRef.current = handleImageUpload })
  useEffect(() => {
    const handlePaste = (e) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) { e.preventDefault(); imageUploadRef.current?.(item.getAsFile()); return }
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])

  if (type === 'channel' && activeChannel?.type !== 'text') return null
  if (type === 'dm' && !useChatStore.getState().activeDM) return null

  return (
    <>
      {/* Reply preview bar */}
      {replyingTo && (
        <div className="px-3 py-2 bg-void-lighter border-t border-void-border flex items-center justify-between shrink-0 animate-fade-in">
          <div className="flex items-center gap-2 min-w-0 text-xs text-text-muted">
            {replyingTo.imageURL && <img src={replyingTo.imageURL} alt="" className="w-6 h-6 rounded object-cover shrink-0" />}
            <span className="truncate">
              replying to <span className="text-neon-purple">@{replyingTo.displayName}</span>
              {replyingTo.text ? `: ${replyingTo.text.length > 60 ? replyingTo.text.slice(0, 60) + '...' : replyingTo.text}` : ''}
            </span>
          </div>
          <button onClick={onClearReply}
            className="text-text-muted hover:text-neon-pink text-xs font-mono px-1.5 py-0.5 rounded hover:bg-void-lighter transition-all shrink-0 ml-2"
            aria-label="Clear reply">
            ✕
          </button>
        </div>
      )}

      {/* Upload indicators */}
      {uploading && (
        <div className="px-4 py-1 text-neon-green text-xs font-mono animate-fade-in flex items-center gap-2">
          <span className="w-2 h-2 bg-neon-green rounded-full animate-pulse" /> uploading image...
        </div>
      )}
      {uploadError && (
        <div className="px-4 py-1 text-neon-pink text-xs font-mono animate-fade-in flex items-center gap-2">
          <span className="w-2 h-2 bg-neon-pink rounded-full" /> {uploadError}
        </div>
      )}

      {/* Autocomplete */}
      {mentionQuery !== null && (
        <AutocompleteDropdown items={autocompleteItems} activeIdx={autocompleteIdx} onSelect={handleAutocompleteSelect} />
      )}

      {/* Input form */}
      <form onSubmit={handleSend} className="p-3 border-t border-void-border shrink-0" data-tour="chat-input">
        <div className="flex gap-2">
          {type !== 'dm' && (
            <>
              <button type="button" onClick={() => fileInputRef.current?.click()}
                className="px-3 py-2.5 rounded-lg text-text-muted hover:text-neon-green hover:bg-void-lighter border border-void-border transition-all"
                title="upload image" aria-label="Upload image">
                📎
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { handleImageUpload(e.target.files?.[0]); e.target.value = '' }} />
            </>
          )}
          <input type="text" value={input} onChange={handleInputChange} onKeyDown={handleInputKeyDown}
            placeholder={type === 'dm' ? 'send a dm...' : placeholder}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm" />
          <button type="submit" disabled={!input.trim()}
            className="px-4 py-2.5 bg-neon-green text-void rounded-lg font-semibold text-sm hover:bg-neon-green/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:shadow-[0_0_15px_rgba(0,255,136,0.3)]"
            aria-label="Send message">
            send
          </button>
        </div>
        {type !== 'dm' && (
          <p className="text-text-muted/40 text-[9px] font-mono mt-1 px-1">
            // @grok to chat &nbsp;·&nbsp; imagine / video &nbsp;·&nbsp; hover images for ai edit &nbsp;·&nbsp; @name to mention
          </p>
        )}
      </form>
    </>
  )
}
