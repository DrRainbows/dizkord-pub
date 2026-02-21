import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useChatStore } from '../stores/chatStore'
import { PanelErrorBoundary } from '../components/ui/ErrorBoundary'
import ChatView from '../components/chat/ChatView'
import VoiceChannel from '../components/voice/VoiceChannel'
import SpinnerView from '../components/spinner/SpinnerView'
import TronView from '../components/arcade/TronView'
import StockView from '../components/arcade/StockView'

export default function GroupPage() {
  const { groupId, channelId } = useParams()
  const navigate = useNavigate()
  const groups = useChatStore(s => s.groups)
  const channels = useChatStore(s => s.channels)
  const activeGroup = useChatStore(s => s.activeGroup)
  const activeChannel = useChatStore(s => s.activeChannel)
  const setActiveGroup = useChatStore(s => s.setActiveGroup)
  const setActiveChannel = useChatStore(s => s.setActiveChannel)

  // Sync group from URL — skip if already set. Intentionally omits activeGroup?.id from
  // deps: this effect owns URL→store sync, not the reverse. Having activeGroup?.id as a dep
  // causes a race where setActiveGroup(null) triggers this effect while GroupPage is still
  // mounted, re-setting the group and causing DefaultRoute to bounce the user back.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!groupId || !groups.length) return
    if (activeGroup?.id === groupId) return
    const group = groups.find(g => g.id === groupId)
    if (group) {
      setActiveGroup(group)
    } else {
      navigate('/', { replace: true })
    }
  }, [groupId, groups])

  // Sync channel from URL or auto-select first text channel
  useEffect(() => {
    if (!channels.length || activeGroup?.id !== groupId) return

    if (channelId) {
      if (activeChannel?.id === channelId) return
      const channel = channels.find(c => c.id === channelId)
      if (channel) {
        setActiveChannel(channel)
      } else {
        navigate(`/g/${groupId}`, { replace: true })
      }
    } else {
      const firstText = channels.find(c => c.type === 'text' || !c.type)
      if (firstText) {
        navigate(`/g/${groupId}/c/${firstText.id}`, { replace: true })
      }
    }
  }, [channelId, channels, activeGroup?.id, groupId, activeChannel?.id, setActiveChannel, navigate])

  if (!activeChannel) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted font-mono text-sm">
        loading channels...
      </div>
    )
  }

  switch (activeChannel.type) {
    case 'voice':
      return <PanelErrorBoundary name="voice"><VoiceChannel /></PanelErrorBoundary>
    case 'spinner':
      return <PanelErrorBoundary name="spinner"><SpinnerView key={activeChannel.id} /></PanelErrorBoundary>
    case 'arcade':
      return <PanelErrorBoundary name="arcade">{activeChannel.game === 'stocks' ? <StockView /> : <TronView />}</PanelErrorBoundary>
    default:
      return <PanelErrorBoundary name="chat"><ChatView key={activeChannel.id} type="channel" /></PanelErrorBoundary>
  }
}
