import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useVoiceStore } from '../../stores/voiceStore'
import { useChatStore } from '../../stores/chatStore'
import { useAuthStore } from '../../stores/authStore'
import Sidebar from './Sidebar'
import AudioPlayback from '../voice/AudioPlayback'
import SettingsModal from '../settings/SettingsModal'
import OnboardingTutorial from '../ui/OnboardingTutorial'
import MatrixRain from '../ui/MatrixRain'
import { stopVoice } from '../../services/webrtc'
import { playLeaveSound } from '../../services/audio'

export default function AppShell() {
  const { inVoice, leaveVoiceChannel } = useVoiceStore()
  const activeChannel = useChatStore(s => s.activeChannel)
  const { userProfile } = useAuthStore()
  const [showSettings, setShowSettings] = useState(false)
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const showOnboarding = !onboardingDismissed && userProfile && !userProfile.onboardingComplete
  const showVoice = activeChannel?.type === 'voice'

  const handleDisconnect = async () => {
    stopVoice()
    playLeaveSound()
    await leaveVoiceChannel()
  }

  return (
    <div className="flex h-screen bg-void relative scanlines">
      <MatrixRain />

      {/* mobile sidebar backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* sidebar: slide-in drawer on mobile, fixed on desktop */}
      <div className={`
        fixed inset-y-0 left-0 z-40 transform transition-transform duration-200 ease-in-out
        md:relative md:translate-x-0 md:z-10
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <Sidebar
          onCloseMobile={() => setSidebarOpen(false)}
          onOpenSettings={() => { setShowSettings(true); setSidebarOpen(false) }}
        />
      </div>

      <main className="flex-1 relative z-10 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* mobile top bar with hamburger */}
        <div className="md:hidden flex items-center gap-3 px-3 py-2 border-b border-void-border bg-void-light/50 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="w-8 h-8 flex items-center justify-center rounded-md text-text-muted hover:text-neon-green hover:bg-void-lighter transition-all"
            aria-label="Open sidebar"
          >
            <span className="text-lg">☰</span>
          </button>
          <span className="text-sm font-display font-semibold text-neon-green">dizkord</span>
          {inVoice && (
            <span className="ml-auto flex items-center gap-1 text-neon-green text-[10px] font-mono">
              <span className="w-1.5 h-1.5 bg-neon-green rounded-full animate-pulse" />
              voice
            </span>
          )}
        </div>

        {/* persistent voice bar (desktop only — mobile shows in top bar) */}
        {inVoice && !showVoice && (
          <div className="hidden md:flex border-b border-neon-green/20 bg-neon-green/5 px-4 py-2 items-center justify-between shrink-0">
            <div className="flex items-center gap-2 text-neon-green text-xs font-mono">
              <span className="w-2 h-2 bg-neon-green rounded-full animate-pulse" />
              connected to voice
            </div>
            <button
              onClick={handleDisconnect}
              className="px-3 py-1 bg-neon-pink/20 text-neon-pink rounded text-xs font-mono border border-neon-pink/30 hover:bg-neon-pink/30 transition-all"
            >
              disconnect
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden">
          <Outlet />
        </div>
      </main>

      <AudioPlayback />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showOnboarding && <OnboardingTutorial onComplete={() => setOnboardingDismissed(true)} />}
    </div>
  )
}
