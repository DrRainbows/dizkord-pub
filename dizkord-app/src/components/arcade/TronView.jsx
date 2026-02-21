/**
 * TronView — Tron light cycles arcade game.
 * P2P via WebRTC data channels (negotiated) on existing voice connections.
 * Lobby via Firestore session doc. Gameplay is fully client-side.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { doc, onSnapshot, setDoc, updateDoc, deleteField } from 'firebase/firestore'
import { db, auth } from '../../config/firebase'
import { useChatStore } from '../../stores/chatStore'
import { useVoiceStore } from '../../stores/voiceStore'
import { useAuthStore } from '../../stores/authStore'
import {
  initGame,
  tick,
  render,
  GRID_W,
  GRID_H,
  TICK_MS,
  COLORS,
  COLOR_NAMES,
  OPP,
  KEY_MAP,
  playDeathSound,
  playWinSound,
  closeAudioContext,
  DC_LABEL,
  DC_ID,
} from '../../engines/TronEngine'
import useDataChannel from '../../hooks/useDataChannel'
import { toast } from '../../stores/toastStore'

// --- component ---

export default function TronView() {
  const { activeGroup, activeChannel } = useChatStore()
  const { user } = useAuthStore()
  const inVoice = useVoiceStore(s => s.inVoice)

  const [phase, setPhase] = useState('lobby')
  const [lobby, setLobby] = useState({})
  const [countdown, setCountdown] = useState(3)
  const [gameWinner, setGameWinner] = useState(null)
  const [scores, setScores] = useState({}) // { [uid]: wins }

  const gameRef = useRef(null)
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const tickRef = useRef(null)
  const rafRef = useRef(null)
  const phaseRef = useRef('lobby')

  const gid = activeGroup?.id
  const cid = activeChannel?.id
  const uid = auth.currentUser?.uid
  const sessionDoc = useMemo(() =>
    gid && cid ? doc(db, 'groups', gid, 'channels', cid, 'session', 'active') : null
  , [gid, cid])

  // keep phaseRef in sync
  useEffect(() => { phaseRef.current = phase }, [phase])

  // --- handle incoming data channel message ---
  const handleDC = useCallback((peerId, msg) => {
    if (msg.t === 'dir' && gameRef.current) {
      const p = gameRef.current.players[msg.u]
      if (p && p.alive && msg.d !== OPP[p.dir]) p.nextDir = msg.d
    }
    // msg.t === 'go' — redundant sync signal, no-op
  }, [])

  const { broadcast } = useDataChannel(DC_LABEL, DC_ID, handleDC)

  // cleanup audio context on unmount
  useEffect(() => {
    return () => { closeAudioContext() }
  }, [])

  // --- Firestore lobby listener ---
  useEffect(() => {
    if (!sessionDoc) return
    const unsub = onSnapshot(sessionDoc, (snap) => {
      if (!snap.exists()) { setLobby({}); return }
      const data = snap.data()
      setLobby(data.players || {})
      if (data.scores) setScores(data.scores)
      if (data.status === 'countdown' && phaseRef.current === 'lobby') {
        startCountdown(data.players || {})
      }
    })
    return unsub
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionDoc])

  // --- lobby actions ---
  const joinLobby = useCallback(async () => {
    if (!sessionDoc || !uid) return
    const taken = new Set(Object.values(lobby).map(p => p.colorIdx))
    const colorIdx = COLORS.findIndex((_, i) => !taken.has(i))
    await setDoc(sessionDoc, {
      status: 'lobby',
      players: { [uid]: { displayName: user?.displayName || 'anon', colorIdx: colorIdx === -1 ? 0 : colorIdx } },
    }, { merge: true })
  }, [sessionDoc, uid, lobby, user?.displayName])

  const leaveLobby = useCallback(async () => {
    if (!sessionDoc || !uid) return
    await updateDoc(sessionDoc, { [`players.${uid}`]: deleteField() })
  }, [sessionDoc, uid])

  const startGame = useCallback(async () => {
    if (!sessionDoc) return
    await updateDoc(sessionDoc, { status: 'countdown' })
  }, [sessionDoc])

  // --- countdown → playing ---
  const startCountdown = useCallback((players) => {
    setPhase('countdown')
    setCountdown(3)
    let c = 3
    const iv = setInterval(() => {
      c--
      setCountdown(c)
      if (c <= 0) {
        clearInterval(iv)
        beginGame(players)
      }
    }, 1000)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const beginGame = useCallback((players) => {
    const playerList = Object.entries(players).map(([id, p]) => ({
      uid: id, displayName: p.displayName, colorIdx: p.colorIdx,
    }))
    // sort by uid for deterministic spawn order
    playerList.sort((a, b) => a.uid.localeCompare(b.uid))
    gameRef.current = initGame(playerList)
    setPhase('playing')

    // game tick loop
    const deathsSeen = new Set()
    tickRef.current = setInterval(() => {
      const g = gameRef.current
      if (!g || g.over) return
      tick(g)
      // check for new deaths → play sound
      for (const [pid, p] of Object.entries(g.players)) {
        if (!p.alive && p.deathTick != null && !deathsSeen.has(pid)) {
          deathsSeen.add(pid)
          playDeathSound()
        }
      }
      if (g.over) {
        clearInterval(tickRef.current)
        tickRef.current = null
        setGameWinner(g.winner)
        setPhase('results')
        if (g.winner) setTimeout(playWinSound, 300)
        // write result to Firestore
        if (sessionDoc) {
          const newScores = { ...scores }
          if (g.winner) newScores[g.winner] = (newScores[g.winner] || 0) + 1
          updateDoc(sessionDoc, { status: 'results', winner: g.winner || null, scores: newScores }).catch(() => toast.error('Failed to save game results'))
        }
      }
    }, TICK_MS)

    // render loop
    const drawFrame = () => {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container || !gameRef.current) { rafRef.current = requestAnimationFrame(drawFrame); return }
      const cz = Math.floor(Math.min(container.clientWidth / GRID_W, container.clientHeight / GRID_H))
      if (cz < 1) { rafRef.current = requestAnimationFrame(drawFrame); return }
      canvas.width = GRID_W * cz
      canvas.height = GRID_H * cz
      const ctx = canvas.getContext('2d')
      render(ctx, gameRef.current, cz)
      if (phaseRef.current === 'playing' || phaseRef.current === 'results') {
        rafRef.current = requestAnimationFrame(drawFrame)
      }
    }
    rafRef.current = requestAnimationFrame(drawFrame)
  }, [sessionDoc, scores])

  // cleanup game loop on unmount or phase change
  useEffect(() => {
    return () => {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    }
  }, [])

  // --- touch input (mobile d-pad) ---
  const handleTouch = useCallback((dir) => {
    const g = gameRef.current
    if (!g || g.over) return
    const me = g.players[uid]
    if (!me || !me.alive) return
    if (dir === OPP[me.dir]) return
    me.nextDir = dir
    broadcast({ t: 'dir', u: uid, d: dir })
  }, [uid, broadcast])

  // --- keyboard input ---
  useEffect(() => {
    if (phase !== 'playing') return
    const onKey = (e) => {
      const dir = KEY_MAP[e.key]
      if (!dir) return
      e.preventDefault()
      const g = gameRef.current
      if (!g || g.over) return
      const me = g.players[uid]
      if (!me || !me.alive) return
      if (dir === OPP[me.dir]) return // can't reverse
      me.nextDir = dir
      broadcast({ t: 'dir', u: uid, d: dir })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, uid, broadcast])

  // --- leave lobby on unmount ---
  useEffect(() => {
    return () => {
      if (sessionDoc && uid && phaseRef.current === 'lobby') {
        updateDoc(sessionDoc, { [`players.${uid}`]: deleteField() }).catch(() => {})
      }
    }
  }, [sessionDoc, uid])

  // --- reset ---
  const playAgain = useCallback(async () => {
    if (!sessionDoc) return
    gameRef.current = null
    setGameWinner(null)
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    await setDoc(sessionDoc, { status: 'lobby', players: {}, scores: scores }, { merge: false })
    setPhase('lobby')
  }, [sessionDoc, scores])

  const inLobby = !!lobby[uid]
  const playerCount = Object.keys(lobby).length
  const canStart = playerCount >= 2

  // --- render ---
  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-void">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-void-border bg-void-light/50 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-neon-green font-display font-bold text-sm tracking-wider">TRON</span>
          <span className="text-text-muted text-[10px] font-mono">// {activeChannel?.name}</span>
        </div>
        {phase !== 'lobby' && (
          <span className="text-[10px] font-mono text-text-muted">
            {phase === 'countdown' ? 'starting...' : phase === 'playing' ? 'live' : 'game over'}
          </span>
        )}
      </div>

      {/* lobby */}
      {phase === 'lobby' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
          {!inVoice ? (
            <div className="text-center">
              <p className="text-text-muted font-mono text-sm mb-2">join voice to play</p>
              <p className="text-text-muted/50 text-[10px] font-mono">tron uses peer-to-peer connections from voice chat</p>
            </div>
          ) : (
            <>
              <div className="text-center">
                <p className="text-neon-green font-display text-2xl font-bold tracking-widest mb-1">TRON</p>
                <p className="text-text-muted text-[10px] font-mono">last one alive wins // arrows or wasd</p>
              </div>

              {/* player list */}
              <div className="w-full max-w-xs space-y-1.5">
                {Object.entries(lobby).map(([pid, p]) => (
                  <div
                    key={pid}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg glass border border-void-border"
                  >
                    <div className="w-3 h-3 rounded-sm" style={{ background: COLORS[p.colorIdx] }} />
                    <span className="text-sm text-text-primary font-mono flex-1 truncate">
                      {p.displayName}
                      {pid === uid && <span className="text-text-muted ml-1">(you)</span>}
                    </span>
                    <span className="text-[9px] text-text-muted font-mono">{COLOR_NAMES[p.colorIdx]}</span>
                  </div>
                ))}
                {playerCount === 0 && (
                  <p className="text-center text-text-muted/50 text-xs font-mono py-4">no players yet</p>
                )}
              </div>

              {/* scores */}
              {Object.keys(scores).length > 0 && (
                <div className="w-full max-w-xs">
                  <p className="text-[10px] text-text-muted font-mono mb-1 px-1">scores</p>
                  <div className="flex gap-2 flex-wrap">
                    {Object.entries(scores).sort(([,a],[,b]) => b - a).map(([sid, wins]) => {
                      const p = lobby[sid]
                      return (
                        <span key={sid} className="text-[10px] font-mono px-2 py-0.5 rounded glass border border-void-border" style={{ color: p ? COLORS[p.colorIdx] : '#888' }}>
                          {p?.displayName || sid.slice(0, 6)}: {wins}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* actions */}
              <div className="flex gap-2">
                {!inLobby ? (
                  <button
                    onClick={joinLobby}
                    className="px-5 py-2 bg-neon-green text-void rounded-lg font-semibold text-sm font-mono hover:bg-neon-green/90 transition-all hover:shadow-[0_0_20px_rgba(0,255,136,0.3)]"
                  >
                    join
                  </button>
                ) : (
                  <>
                    <button
                      onClick={leaveLobby}
                      className="px-4 py-2 rounded-lg text-sm font-mono text-text-muted border border-void-border hover:border-neon-pink/30 hover:text-neon-pink transition-all"
                    >
                      leave
                    </button>
                    <button
                      onClick={startGame}
                      disabled={!canStart}
                      className="px-5 py-2 bg-neon-green text-void rounded-lg font-semibold text-sm font-mono hover:bg-neon-green/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:shadow-[0_0_20px_rgba(0,255,136,0.3)]"
                    >
                      start {canStart ? '' : '(need 2+)'}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* countdown */}
      {phase === 'countdown' && (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-neon-green font-display text-8xl font-bold animate-pulse">
            {countdown}
          </span>
        </div>
      )}

      {/* game canvas */}
      {(phase === 'playing' || phase === 'results') && (
        <div ref={containerRef} className="flex-1 flex items-center justify-center min-h-0 p-2 relative">
          <canvas ref={canvasRef} className="rounded-lg" style={{ imageRendering: 'pixelated' }} />

          {/* player labels overlay */}
          <div className="absolute top-3 left-3 flex flex-col gap-0.5">
            {gameRef.current && Object.entries(gameRef.current.players).map(([pid, p]) => (
              <span
                key={pid}
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${p.alive ? '' : 'line-through opacity-40'}`}
                style={{ color: COLORS[p.colorIdx] }}
              >
                {p.name}{pid === uid ? ' (you)' : ''}
              </span>
            ))}
          </div>

          {/* controls: keyboard hint on desktop, d-pad on touch */}
          {phase === 'playing' && (
            <>
              <div className="hidden md:block absolute bottom-3 left-1/2 -translate-x-1/2 text-[9px] font-mono text-text-muted/30">
                ↑ ↓ ← → or wasd
              </div>
              <div className="md:hidden absolute bottom-4 left-1/2 -translate-x-1/2 grid grid-cols-3 gap-1 w-32" style={{ touchAction: 'none' }}>
                <div />
                <button onTouchStart={(e) => { e.preventDefault(); handleTouch('up') }}
                  className="w-10 h-10 rounded-lg bg-void-light/60 border border-void-border text-text-muted flex items-center justify-center text-lg active:bg-neon-green/20 active:text-neon-green">↑</button>
                <div />
                <button onTouchStart={(e) => { e.preventDefault(); handleTouch('left') }}
                  className="w-10 h-10 rounded-lg bg-void-light/60 border border-void-border text-text-muted flex items-center justify-center text-lg active:bg-neon-green/20 active:text-neon-green">←</button>
                <button onTouchStart={(e) => { e.preventDefault(); handleTouch('down') }}
                  className="w-10 h-10 rounded-lg bg-void-light/60 border border-void-border text-text-muted flex items-center justify-center text-lg active:bg-neon-green/20 active:text-neon-green">↓</button>
                <button onTouchStart={(e) => { e.preventDefault(); handleTouch('right') }}
                  className="w-10 h-10 rounded-lg bg-void-light/60 border border-void-border text-text-muted flex items-center justify-center text-lg active:bg-neon-green/20 active:text-neon-green">→</button>
              </div>
            </>
          )}

          {/* results overlay */}
          {phase === 'results' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-void/70 rounded-lg animate-fade-in">
              <p className="text-text-muted text-xs font-mono mb-2">game over</p>
              {gameWinner ? (
                <p className="text-2xl font-display font-bold mb-4" style={{ color: COLORS[gameRef.current?.players[gameWinner]?.colorIdx] || '#fff' }}>
                  {gameRef.current?.players[gameWinner]?.name || 'unknown'} wins
                </p>
              ) : (
                <p className="text-2xl font-display font-bold text-text-muted mb-4">draw</p>
              )}
              <button
                onClick={playAgain}
                className="px-5 py-2 bg-neon-green text-void rounded-lg font-semibold text-sm font-mono hover:bg-neon-green/90 transition-all hover:shadow-[0_0_20px_rgba(0,255,136,0.3)]"
              >
                play again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
