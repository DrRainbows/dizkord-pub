import { useState, useCallback, useRef } from 'react'
import EveSession from '../engines/EveSession'

export default function useEve() {
  const [eveActive, setEveActive] = useState(false)
  const [transcript, setTranscript] = useState('')
  const sessionRef = useRef(null)

  const summon = useCallback(async () => {
    if (sessionRef.current?.active) return

    const session = new EveSession()
    sessionRef.current = session

    try {
      await session.start(({ role, text, done }) => {
        if (role === 'assistant' && !done) {
          setTranscript(prev => prev + text)
        } else if (done) {
          setTranscript('')
        }
      })
      setEveActive(true)
    } catch (err) {
      sessionRef.current = null
      throw err
    }
  }, [])

  const dismiss = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.stop()
      sessionRef.current = null
    }
    setEveActive(false)
    setTranscript('')
  }, [])

  return {
    eveActive,
    transcript,
    summon,
    dismiss,
  }
}
