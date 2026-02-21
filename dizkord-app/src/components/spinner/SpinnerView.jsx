import { useState, useEffect, useRef, useCallback } from 'react'
import { useSpinnerStore, SEGMENT_COLORS } from '../../stores/spinnerStore'
import { useChatStore } from '../../stores/chatStore'
import { useAuthStore } from '../../stores/authStore'
import Avatar from '../ui/Avatar'

export default function SpinnerView() {
  const { user } = useAuthStore()
  const { activeGroup, activeChannel } = useChatStore()
  const store = useSpinnerStore()
  const { session } = store

  const [newOption, setNewOption] = useState('')
  const [wheelAngle, setWheelAngle] = useState(0)
  const [isAnimating, setIsAnimating] = useState(false)

  const prevStatusRef = useRef(null)
  const joinedRef = useRef(false)
  const spinTimeoutRef = useRef(null)

  const groupId = activeGroup?.id
  const channelId = activeChannel?.id

  const resetWheel = useCallback(() => {
    setWheelAngle(0)
    setIsAnimating(false)
  }, [])

  const snapWheelTo = useCallback((angle) => {
    setWheelAngle(angle || 0)
    setIsAnimating(false)
  }, [])

  const animateWheelTo = useCallback((angle) => {
    setIsAnimating(true)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setWheelAngle(angle || 0)
      })
    })
  }, [])

  const stopSpinAnimation = useCallback(() => {
    setIsAnimating(false)
  }, [])

  // subscribe to session, cleanup on unmount or channel switch
  useEffect(() => {
    if (!groupId || !channelId) return
    joinedRef.current = false
    prevStatusRef.current = null
    store.listenSession(groupId, channelId)

    return () => {
      if (user?.uid) store.removeSpectator(groupId, channelId, user.uid)
      store.stopListening()
      if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current)
    }
  }, [groupId, channelId]) // eslint-disable-line react-hooks/exhaustive-deps

  // auto-join as spectator when session exists
  useEffect(() => {
    if (session && user && !session.spectators?.[user.uid] && !joinedRef.current) {
      joinedRef.current = true
      store.addSpectator(groupId, channelId, user)
    }
  }, [session, user?.uid, groupId, channelId]) // eslint-disable-line react-hooks/exhaustive-deps

  // wheel animation state machine
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!session) {
      prevStatusRef.current = null
      return
    }
    const curr = session.status
    const prev = prevStatusRef.current

    if (curr === 'spinning' && prev !== 'spinning') {
      if (prev === null) {
        // joined mid-spin — snap to result without animation
        snapWheelTo(session.resultAngle)
      } else {
        // normal spin trigger — animate
        animateWheelTo(session.resultAngle)
        // safety timeout if transitionEnd doesn't fire
        spinTimeoutRef.current = setTimeout(() => {
          stopSpinAnimation()
          store.markComplete(groupId, channelId)
        }, 8000)
      }
    } else if (curr === 'result' && prev === null) {
      // joined with result already showing
      snapWheelTo(session.resultAngle)
    } else if (curr === 'building') {
      resetWheel()
    }

    prevStatusRef.current = curr
  }, [session, groupId, channelId, store, snapWheelTo, animateWheelTo, stopSpinAnimation, resetWheel])
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleTransitionEnd = (e) => {
    if (e.propertyName !== 'transform') return
    if (spinTimeoutRef.current) {
      clearTimeout(spinTimeoutRef.current)
      spinTimeoutRef.current = null
    }
    stopSpinAnimation()
    const current = useSpinnerStore.getState().session
    if (current?.status === 'spinning') {
      store.markComplete(groupId, channelId)
    }
  }

  const handleAddOption = (e) => {
    e.preventDefault()
    const trimmed = newOption.trim()
    if (!trimmed || !session) return
    if (session.options.includes(trimmed)) return
    store.addOption(groupId, channelId, trimmed)
    setNewOption('')
  }

  const handleReset = () => {
    if (spinTimeoutRef.current) {
      clearTimeout(spinTimeoutRef.current)
      spinTimeoutRef.current = null
    }
    resetWheel()
    store.resetSession(groupId, channelId)
  }

  if (!activeChannel || activeChannel.type !== 'spinner') return null

  // derived state
  const spectators = session?.spectators ? Object.entries(session.spectators) : []
  const options = session?.options || []
  const votes = session?.votes || {}
  const voteCount = Object.keys(votes).length
  const spectatorCount = spectators.length
  const hasVoted = !!(user?.uid && votes[user.uid])
  const canVote = options.length >= 2 && session?.status !== 'spinning' && session?.status !== 'result'

  // wheel gradient
  const segmentAngle = options.length > 0 ? 360 / options.length : 360
  const gradient = options.length > 0
    ? `conic-gradient(${options.map((_, i) => {
        const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length]
        return `${color} ${i * segmentAngle}deg ${(i + 1) * segmentAngle}deg`
      }).join(', ')})`
    : undefined

  return (
    <div className="flex flex-col h-full bg-void-light/50">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-void-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">🎰</span>
          <h2 className="font-display font-semibold text-text-primary">{activeChannel.name}</h2>
        </div>
        {session && (
          <span className="text-text-muted text-xs font-mono">
            {spectatorCount} watching
          </span>
        )}
      </div>

      {/* content */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center justify-center gap-6 p-4 md:p-6 min-h-full">
          {!session ? (
            <NoSession onStart={() => store.createSession(groupId, channelId, user)} />
          ) : (
            <>
              {/* spectators */}
              <div className="flex items-center gap-2 flex-wrap justify-center">
                {spectators.map(([uid, spec]) => (
                  <div
                    key={uid}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-void/50 border border-void-border"
                  >
                    <Avatar src={spec.photoURL} name={spec.displayName} size="xs" />
                    <span className="text-[11px] font-mono text-text-secondary">
                      {spec.displayName || 'anon'}
                    </span>
                    {votes[uid] && (
                      <span className="w-1.5 h-1.5 bg-neon-green rounded-full" title="voted" />
                    )}
                  </div>
                ))}
              </div>

              {/* wheel */}
              <Wheel
                gradient={gradient}
                options={options}
                segmentAngle={segmentAngle}
                wheelAngle={wheelAngle}
                isAnimating={isAnimating}
                onTransitionEnd={handleTransitionEnd}
              />

              {/* result */}
              {session.status === 'result' && session.result && (
                <div className="text-center animate-fade-in">
                  <p className="text-text-muted text-[10px] font-mono uppercase tracking-wider mb-1">
                    the void has spoken
                  </p>
                  <p className="text-xl md:text-2xl font-display font-bold text-neon-green glow-green px-6 py-2 rounded-lg bg-neon-green/5 border border-neon-green/20">
                    {session.result}
                  </p>
                </div>
              )}

              {/* options legend */}
              <OptionsList
                options={options}
                isBuilding={session.status === 'building'}
                onRemove={(i) => store.removeOption(groupId, channelId, i)}
                newOption={newOption}
                setNewOption={setNewOption}
                onAdd={handleAddOption}
              />

              {/* actions */}
              <div className="flex items-center gap-3 flex-wrap justify-center">
                {canVote && (
                  <button
                    onClick={() =>
                      hasVoted
                        ? store.unvote(groupId, channelId, user.uid)
                        : store.voteToSpin(groupId, channelId, user.uid)
                    }
                    className={`px-5 py-2 rounded-lg font-mono text-sm border transition-all ${
                      hasVoted
                        ? 'bg-neon-green/15 text-neon-green border-neon-green/30 hover:bg-neon-green/25 shadow-[0_0_15px_rgba(0,255,136,0.15)]'
                        : 'bg-void text-text-secondary border-void-border hover:text-neon-green hover:border-neon-green/30 hover:bg-neon-green/5'
                    }`}
                  >
                    {hasVoted ? '✓ voted' : 'vote to spin'} ({voteCount}/{spectatorCount})
                  </button>
                )}
                {options.length === 1 && session.status === 'building' && (
                  <span className="text-text-muted text-xs font-mono">need at least 2 options</span>
                )}
                {session.status === 'spinning' && (
                  <div className="flex items-center gap-2 text-neon-green text-sm font-mono animate-pulse">
                    <span className="w-2 h-2 bg-neon-green rounded-full" />
                    spinning...
                  </div>
                )}
                {session.status === 'result' && (
                  <button
                    onClick={handleReset}
                    className="px-5 py-2 bg-neon-purple/10 text-neon-purple rounded-lg font-mono text-sm border border-neon-purple/30 hover:bg-neon-purple/20 transition-all"
                  >
                    spin again
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// --- sub-components ---

function NoSession({ onStart }) {
  return (
    <div className="text-center animate-fade-in">
      <p className="text-text-muted font-mono text-sm mb-1">the void awaits</p>
      <p className="text-text-muted/60 font-mono text-xs mb-4">start a session to pick your fate</p>
      <button
        onClick={onStart}
        className="px-6 py-2.5 bg-neon-cyan/10 text-neon-cyan rounded-lg font-mono text-sm border border-neon-cyan/30 hover:bg-neon-cyan/20 hover:shadow-[0_0_20px_rgba(100,210,255,0.2)] transition-all"
      >
        start session
      </button>
    </div>
  )
}

function Wheel({ gradient, options, segmentAngle, wheelAngle, isAnimating, onTransitionEnd }) {
  return (
    <div className="relative">
      {/* pointer */}
      <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10">
        <div
          style={{
            width: 0,
            height: 0,
            borderLeft: '10px solid transparent',
            borderRight: '10px solid transparent',
            borderTop: '16px solid #00ff88',
            filter: 'drop-shadow(0 0 8px rgba(0,255,136,0.6))',
          }}
        />
      </div>

      {/* wheel disc */}
      <div
        className="w-56 h-56 md:w-72 md:h-72 rounded-full border-2 border-void-border relative overflow-hidden"
        style={{
          background: gradient || 'var(--color-void-lighter)',
          transform: `rotate(${wheelAngle}deg)`,
          transition: isAnimating
            ? 'transform 4.5s cubic-bezier(0.15, 0.70, 0.10, 1.0)'
            : 'none',
          boxShadow: isAnimating
            ? '0 0 40px rgba(0,255,136,0.3), 0 0 80px rgba(191,90,242,0.15)'
            : '0 0 20px rgba(0,255,136,0.08)',
        }}
        onTransitionEnd={onTransitionEnd}
      >
        {/* segment dividers */}
        {options.length > 1 &&
          options.map((_, i) => (
            <div
              key={i}
              className="absolute top-0 left-1/2 h-1/2 origin-bottom"
              style={{
                transform: `translateX(-50%) rotate(${i * segmentAngle}deg)`,
                width: '2px',
                background: 'rgba(10, 10, 15, 0.5)',
              }}
            />
          ))}
        {/* center hub */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-void border-2 border-void-border" />
        </div>
      </div>
    </div>
  )
}

function OptionsList({ options, isBuilding, onRemove, newOption, setNewOption, onAdd }) {
  return (
    <div className="w-full max-w-xs">
      <h3 className="text-text-muted text-[10px] font-mono uppercase tracking-wider mb-2 px-1">
        options{options.length > 0 && ` (${options.length})`}
      </h3>
      <div className="space-y-1 mb-2 max-h-48 overflow-y-auto">
        {options.map((opt, i) => (
          <div
            key={`${opt}-${i}`}
            className="flex items-center gap-2 px-3 py-1.5 bg-void rounded-md border border-void-border group"
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }}
            />
            <span className="text-sm text-text-primary font-mono flex-1 truncate">{opt}</span>
            {isBuilding && (
              <button
                onClick={() => onRemove(i)}
                className="text-text-muted hover:text-neon-pink text-xs opacity-0 group-hover:opacity-100 transition-all"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {options.length === 0 && (
          <p className="text-text-muted/50 text-xs font-mono px-3 py-2">no options yet</p>
        )}
      </div>
      {isBuilding && (
        <form onSubmit={onAdd} className="flex gap-1">
          <input
            type="text"
            value={newOption}
            onChange={(e) => setNewOption(e.target.value)}
            placeholder="add option..."
            className="flex-1 px-3 py-1.5 rounded-md text-sm font-mono"
            maxLength={50}
          />
          <button
            type="submit"
            disabled={!newOption.trim()}
            className="px-3 py-1.5 bg-neon-cyan/10 text-neon-cyan rounded-md text-sm font-mono border border-neon-cyan/30 hover:bg-neon-cyan/20 transition-all disabled:opacity-30 disabled:cursor-default"
          >
            +
          </button>
        </form>
      )}
    </div>
  )
}
