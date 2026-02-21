import { useEffect, useRef } from 'react'

export default function useAutoScroll(messages, userId, { onNewMessage } = {}) {
  const endRef = useRef(null)
  const containerRef = useRef(null)
  const prevCountRef = useRef(0)
  const initialLoadRef = useRef(true)

  useEffect(() => {
    initialLoadRef.current = true
    prevCountRef.current = 0
  }, []) // reset on mount (channel switch causes remount via key or route change)

  useEffect(() => {
    if (initialLoadRef.current) {
      if (messages.length > 0) {
        endRef.current?.scrollIntoView({ behavior: 'instant' })
        initialLoadRef.current = false
        prevCountRef.current = messages.length
      }
      return
    }

    if (messages.length > prevCountRef.current && messages.length > 0) {
      const last = messages[messages.length - 1]
      const container = containerRef.current
      const nearBottom = container
        ? (container.scrollHeight - container.scrollTop - container.clientHeight) < 120
        : true

      if (nearBottom || last.uid === userId) {
        endRef.current?.scrollIntoView({ behavior: 'smooth' })
      }

      if (last.uid !== userId) {
        onNewMessage?.(last)
      }
    }
    prevCountRef.current = messages.length
  }, [messages, userId, onNewMessage])

  return { endRef, containerRef }
}
