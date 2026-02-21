import { useCallback, useRef } from 'react'
import { useVoiceStore } from '../stores/voiceStore'
import { useChatStore } from '../stores/chatStore'
import VoiceEngine from '../engines/VoiceEngine'
import { playJoinSound, playLeaveSound } from '../services/audio'

export default function useVoice() {
  const inVoice = useVoiceStore(s => s.inVoice)
  const joinVoiceChannel = useVoiceStore(s => s.joinVoiceChannel)
  const leaveVoiceChannel = useVoiceStore(s => s.leaveVoiceChannel)
  const activeGroup = useChatStore(s => s.activeGroup)
  const activeChannel = useChatStore(s => s.activeChannel)
  const engineRef = useRef(null)

  const join = useCallback(async (groupId, channelId) => {
    const gId = groupId || activeGroup?.id
    const cId = channelId || activeChannel?.id
    if (!gId || !cId) return false

    const engine = new VoiceEngine()
    engineRef.current = engine

    await joinVoiceChannel(gId, cId)
    const ok = await engine.start(gId, cId)
    if (ok) {
      playJoinSound()
    } else {
      await leaveVoiceChannel()
      engine.destroy()
      engineRef.current = null
    }
    return ok
  }, [activeGroup?.id, activeChannel?.id, joinVoiceChannel, leaveVoiceChannel])

  const leave = useCallback(async () => {
    if (engineRef.current) {
      engineRef.current.stop()
      engineRef.current = null
    }
    playLeaveSound()
    await leaveVoiceChannel()
  }, [leaveVoiceChannel])

  return {
    inVoice,
    join,
    leave,
  }
}
