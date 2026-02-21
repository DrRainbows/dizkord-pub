/**
 * Always-mounted audio playback for remote voice peers.
 * Lives in App.jsx, never unmounts while in voice.
 * Handles: stream attachment, volume, deafen, output device.
 */
import { useEffect, useRef } from 'react'
import { useVoiceStore } from '../../stores/voiceStore'

export default function AudioPlayback() {
  const { inVoice, remoteStreams, userVolumes, isDeafened, selectedOutput } = useVoiceStore()
  const audioRefs = useRef({})

  // attach remote streams to audio elements
  useEffect(() => {
    if (!inVoice) return
    for (const [uid, stream] of Object.entries(remoteStreams)) {
      const el = audioRefs.current[uid]
      if (el && el.srcObject !== stream) {
        console.log('[audio] attaching stream for', uid.slice(0, 8))
        el.srcObject = stream
        el.play().then(() => {
          console.log('[audio] playing for', uid.slice(0, 8))
        }).catch((err) => {
          console.error('[audio] play failed for', uid.slice(0, 8), err.message)
        })
      }
    }
    // cleanup refs for peers that left
    for (const uid of Object.keys(audioRefs.current)) {
      if (!remoteStreams[uid]) {
        const el = audioRefs.current[uid]
        if (el) el.srcObject = null
        delete audioRefs.current[uid]
      }
    }
  }, [inVoice, remoteStreams])

  // update volume
  useEffect(() => {
    for (const [uid, vol] of Object.entries(userVolumes)) {
      const el = audioRefs.current[uid]
      if (el) el.volume = Math.min(Math.max(vol, 0), 1.0)
    }
  }, [userVolumes])

  // deafen: mute all audio elements
  useEffect(() => {
    for (const el of Object.values(audioRefs.current)) {
      if (el && el.srcObject) el.muted = isDeafened
    }
  }, [isDeafened, remoteStreams])

  // output device
  useEffect(() => {
    if (selectedOutput) {
      for (const el of Object.values(audioRefs.current)) {
        if (el?.setSinkId) el.setSinkId(selectedOutput).catch(() => {})
      }
    }
  }, [selectedOutput, remoteStreams])

  if (!inVoice) return null

  return (
    <div style={{ display: 'none' }}>
      {Object.keys(remoteStreams).map(uid => (
        <audio
          key={uid}
          ref={(el) => { if (el) audioRefs.current[uid] = el }}
          autoPlay
          playsInline
        />
      ))}
    </div>
  )
}
