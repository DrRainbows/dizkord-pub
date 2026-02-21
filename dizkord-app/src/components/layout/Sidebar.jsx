import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChatStore } from '../../stores/chatStore'
import { useVoiceStore } from '../../stores/voiceStore'
import GlitchText from '../ui/GlitchText'
import SidebarGroups from './SidebarGroups'
import SidebarChannels from './SidebarChannels'
import SidebarDMs from './SidebarDMs'
import SidebarUserPanel from './SidebarUserPanel'

export default function Sidebar({ onCloseMobile, onOpenSettings }) {
  const navigate = useNavigate()
  const activeGroup = useChatStore(s => s.activeGroup)
  const setActiveGroup = useChatStore(s => s.setActiveGroup)
  const inVoice = useVoiceStore(s => s.inVoice)

  const navToGroupList = () => {
    setActiveGroup(null)
    navigate('/')
    onCloseMobile?.()
  }

  return (
    <div className="w-64 h-screen bg-void-light border-r border-void-border flex flex-col relative z-10">
      {/* Header */}
      <div className="p-4 border-b border-void-border">
        {activeGroup ? (
          <div className="flex items-center justify-between">
            <button
              onClick={navToGroupList}
              className="text-text-muted hover:text-neon-green text-xs font-mono transition-colors"
            >
              ← groups
            </button>
            <CopyInviteButton groupId={activeGroup.id} />
          </div>
        ) : (
          <>
            <GlitchText text="DIZKORD" className="text-xl font-bold font-display text-neon-green" />
            <p className="text-text-muted text-[10px] font-mono mt-0.5">v1.7.0 // no kyc needed</p>
          </>
        )}
      </div>

      {/* Main Navigation */}
      <div className="flex-1 overflow-y-auto">
        {activeGroup ? (
          <SidebarChannels onCloseMobile={onCloseMobile} />
        ) : (
          <>
            <SidebarGroups onCloseMobile={onCloseMobile} />
            <SidebarDMs onCloseMobile={onCloseMobile} />
          </>
        )}
      </div>

      {/* Voice Status */}
      {inVoice && (
        <div className="p-3 border-t border-neon-green/20 bg-neon-green/5 animate-fade-in">
          <div className="flex items-center gap-2 text-neon-green text-xs font-mono">
            <span className="w-2 h-2 bg-neon-green rounded-full animate-pulse" />
            connected to voice
          </div>
        </div>
      )}

      <SidebarUserPanel onOpenSettings={onOpenSettings} />
    </div>
  )
}

function CopyInviteButton({ groupId }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const text = `${window.location.origin}/invite/${groupId}`
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      onClick={handleCopy}
      className="text-text-muted hover:text-neon-green text-[10px] font-mono transition-colors"
      title="Copy invite link to share"
      aria-label="Copy invite link"
      data-tour="invite"
    >
      {copied ? 'link copied!' : '🔗 invite link'}
    </button>
  )
}
