import { useEffect, useRef, useCallback } from 'react'
import { useVoiceStore } from '../stores/voiceStore'

/**
 * Hook for managing negotiated WebRTC data channels over existing voice connections.
 * @param {string} label - Channel label
 * @param {number} id - Negotiated channel ID (must be unique per game)
 * @param {function} onMessage - Callback: (peerId, parsedMessage) => void
 * @returns {{ broadcast: (msg: object) => void, channels: React.MutableRefObject }}
 */
export default function useDataChannel(label, id, onMessage) {
  const inVoice = useVoiceStore(s => s.inVoice)
  const peerConnections = useVoiceStore(s => s.peerConnections)
  const dcsRef = useRef({})
  const onMessageRef = useRef(onMessage)
  useEffect(() => { onMessageRef.current = onMessage })

  useEffect(() => {
    if (!inVoice) return
    for (const [peerId, pc] of Object.entries(peerConnections)) {
      if (pc.connectionState === 'closed' || dcsRef.current[peerId]) continue
      try {
        const dc = pc.createDataChannel(label, { negotiated: true, id, ordered: true })
        dc.onopen = () => console.log(`[${label}] data channel OPEN to`, peerId.slice(0, 8))
        dc.onclose = () => console.log(`[${label}] data channel closed from`, peerId.slice(0, 8))
        dc.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data)
            onMessageRef.current?.(peerId, msg)
          } catch { /* ignore malformed */ }
        }
        dc.onerror = (e) => console.warn(`[${label}] DC error:`, peerId.slice(0, 8), e)
        dcsRef.current[peerId] = dc
        console.log(`[${label}] created negotiated DC to`, peerId.slice(0, 8), 'pc state:', pc.connectionState)
      } catch (err) {
        console.warn(`[${label}] DC create failed for`, peerId.slice(0, 8), err.message)
      }
    }
    // prune channels for peers that left
    for (const peerId of Object.keys(dcsRef.current)) {
      if (!peerConnections[peerId]) {
        try { dcsRef.current[peerId].close() } catch { /* ok */ }
        delete dcsRef.current[peerId]
      }
    }
  }, [inVoice, peerConnections, label, id])

  // cleanup on unmount
  useEffect(() => {
    return () => {
      for (const dc of Object.values(dcsRef.current)) {
        try { dc.close() } catch { /* ok */ }
      }
      dcsRef.current = {}
    }
  }, [])

  const broadcast = useCallback((msg) => {
    const data = JSON.stringify(msg)
    for (const dc of Object.values(dcsRef.current)) {
      if (dc.readyState === 'open') try { dc.send(data) } catch { /* ok */ }
    }
  }, [])

  return { broadcast, channels: dcsRef }
}
