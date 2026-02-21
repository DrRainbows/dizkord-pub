/**
 * StockView — Fake stock trading arcade game.
 * Deterministic price sim from shared seed. Trades are local, positions broadcast via data channels.
 * Wallets persist across days in Firestore. End of day = force-liquidate all positions.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { doc, onSnapshot, setDoc, updateDoc, deleteField } from 'firebase/firestore'
import { db, auth } from '../../config/firebase'
import { useChatStore } from '../../stores/chatStore'
import { useVoiceStore } from '../../stores/voiceStore'
import { useAuthStore } from '../../stores/authStore'
import { toast } from '../../stores/toastStore'
import useDataChannel from '../../hooks/useDataChannel'
import {
  TICK_MS,
  TOTAL_TICKS,
  START_CASH,
  START_PRICE,
  DC_LABEL,
  DC_ID,
  PROFILES,
  generatePrices,
  playBuySound,
  playSellSound,
  playBellSound,
  closeAudioContext,
  executeBuy,
  executeSell,
  liquidate,
  renderChart,
} from '../../engines/StockEngine'

// --- component ---
export default function StockView() {
  const { activeGroup, activeChannel } = useChatStore()
  const { user } = useAuthStore()
  const { inVoice } = useVoiceStore()

  const [phase, setPhase] = useState('lobby') // lobby | countdown | playing | summary
  const [lobby, setLobby] = useState({})
  const [wallet, setWallet] = useState({ cash: START_CASH, shares: 0, avgCost: 0 })
  const [positions, setPositions] = useState({}) // { [uid]: { displayName, cash, shares, avgCost } }
  const [profileName, setProfileName] = useState('')
  const [tickIdx, setTickIdx] = useState(0)
  const [countdown, setCountdown] = useState(3)
  const [dayNum, setDayNum] = useState(0)
  const [summary, setSummary] = useState(null) // { openPrice, closePrice, pnl }

  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const tickRef = useRef(null)
  const rafRef = useRef(null)
  const pricesRef = useRef([])
  const phaseRef = useRef('lobby')
  const walletRef = useRef(wallet)
  const tickIdxRef = useRef(0)

  const handleDC = useCallback((peerId, msg) => {
    if (msg.t === 'pos') {
      setPositions(prev => ({ ...prev, [msg.u]: { displayName: msg.n, cash: msg.c, shares: msg.s, avgCost: msg.a } }))
    }
  }, [])
  const { broadcast } = useDataChannel(DC_LABEL, DC_ID, handleDC)

  const gid = activeGroup?.id
  const cid = activeChannel?.id
  const uid = auth.currentUser?.uid
  const sessionDoc = useMemo(() =>
    gid && cid ? doc(db, 'groups', gid, 'channels', cid, 'session', 'active') : null
  , [gid, cid])

  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { walletRef.current = wallet }, [wallet])
  useEffect(() => { tickIdxRef.current = tickIdx }, [tickIdx])

  useEffect(() => () => closeAudioContext(), [])

  // --- Firestore listener ---
  useEffect(() => {
    if (!sessionDoc) return
    const unsub = onSnapshot(sessionDoc, (snap) => {
      if (!snap.exists()) { setLobby({}); return }
      const data = snap.data()
      setLobby(data.players || {})
      setDayNum(data.dayNum || 0)
      // load own wallet from Firestore if present
      if (data.players?.[uid]) {
        const p = data.players[uid]
        setWallet({ cash: p.cash ?? START_CASH, shares: p.shares ?? 0, avgCost: p.avgCost ?? 0 })
      }
      if (data.status === 'countdown' && phaseRef.current === 'lobby') {
        startCountdown(data.seed, data.profileIdx, data.dayNum || 0)
      }
    })
    return unsub
  }, [sessionDoc, uid]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- lobby actions ---
  const joinLobby = useCallback(async () => {
    if (!sessionDoc || !uid) return
    const existing = lobby[uid]
    await setDoc(sessionDoc, {
      status: 'lobby',
      players: {
        [uid]: {
          displayName: user?.displayName || 'anon',
          cash: existing?.cash ?? START_CASH,
          shares: 0, avgCost: 0,
        },
      },
    }, { merge: true })
  }, [sessionDoc, uid, lobby, user?.displayName])

  const leaveLobby = useCallback(async () => {
    if (!sessionDoc || !uid) return
    await updateDoc(sessionDoc, { [`players.${uid}`]: deleteField() })
  }, [sessionDoc, uid])

  const startDay = useCallback(async () => {
    if (!sessionDoc) return
    const seed = Math.floor(Math.random() * 2147483647)
    const profileIdx = Math.floor(Math.random() * PROFILES.length)
    // reset shares for all players but keep cash
    const players = { ...lobby }
    for (const pid of Object.keys(players)) {
      players[pid] = { ...players[pid], shares: 0, avgCost: 0 }
    }
    await updateDoc(sessionDoc, {
      status: 'countdown',
      seed, profileIdx,
      dayNum: (dayNum || 0) + 1,
      players,
    })
  }, [sessionDoc, lobby, dayNum])

  const resetWallet = useCallback(async () => {
    if (!sessionDoc || !uid) return
    await updateDoc(sessionDoc, {
      [`players.${uid}.cash`]: START_CASH,
      [`players.${uid}.shares`]: 0,
      [`players.${uid}.avgCost`]: 0,
    })
    setWallet({ cash: START_CASH, shares: 0, avgCost: 0 })
  }, [sessionDoc, uid])

  // --- countdown → playing ---
  const startCountdown = useCallback((seed, profileIdx, dn) => {
    const prices = generatePrices(seed, profileIdx)
    pricesRef.current = prices
    setProfileName(PROFILES[profileIdx % PROFILES.length].name)
    setDayNum(dn)
    setPositions({})
    setPhase('countdown')
    setCountdown(3)
    playBellSound()
    let c = 3
    const iv = setInterval(() => {
      c--; setCountdown(c)
      if (c <= 0) { clearInterval(iv); beginPlaying() }
    }, 1000)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const beginPlaying = useCallback(() => {
    setPhase('playing')
    setTickIdx(0)
    tickIdxRef.current = 0

    // tick loop
    tickRef.current = setInterval(() => {
      const next = tickIdxRef.current + 1
      if (next >= TOTAL_TICKS) {
        clearInterval(tickRef.current); tickRef.current = null
        endDay()
        return
      }
      tickIdxRef.current = next
      setTickIdx(next)
    }, TICK_MS)

    // render loop
    const draw = () => {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (canvas && container && pricesRef.current.length > 0) {
        const w = container.clientWidth
        const h = Math.min(container.clientHeight, 300)
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
        const ctx = canvas.getContext('2d')
        renderChart(ctx, w, h, pricesRef.current, tickIdxRef.current, walletRef.current.avgCost, [])
      }
      if (phaseRef.current === 'playing' || phaseRef.current === 'summary') {
        rafRef.current = requestAnimationFrame(draw)
      }
    }
    rafRef.current = requestAnimationFrame(draw)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const endDay = useCallback(() => {
    playBellSound()
    const prices = pricesRef.current
    const closePrice = prices[prices.length - 1]
    const w = walletRef.current
    const finalWallet = liquidate(w, closePrice)
    const pnl = finalWallet.cash - (lobby[uid]?.cash ?? START_CASH)
    setWallet(finalWallet)
    walletRef.current = finalWallet
    setSummary({ openPrice: prices[0], closePrice, pnl: Math.round(pnl * 100) / 100, finalCash: finalWallet.cash })
    setPhase('summary')

    // persist to Firestore
    if (sessionDoc && uid) {
      updateDoc(sessionDoc, {
        status: 'summary',
        [`players.${uid}.cash`]: finalWallet.cash,
        [`players.${uid}.shares`]: 0,
        [`players.${uid}.avgCost`]: 0,
      }).catch(() => toast.error('Failed to save game results'))
    }
    // broadcast final
    broadcast({ t: 'pos', u: uid, n: user?.displayName || 'anon', c: finalWallet.cash, s: 0, a: 0 })
  }, [sessionDoc, uid, lobby, user?.displayName, broadcast])

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    }
  }, [])

  // leave lobby on unmount
  useEffect(() => {
    return () => {
      if (sessionDoc && uid && phaseRef.current === 'lobby') {
        updateDoc(sessionDoc, { [`players.${uid}`]: deleteField() }).catch(() => {})
      }
    }
  }, [sessionDoc, uid])

  // --- trading ---
  const currentPrice = pricesRef.current[tickIdx] ?? START_PRICE

  const buy = useCallback((qty) => {
    const price = pricesRef.current[tickIdxRef.current]
    if (!price) return
    const newWallet = executeBuy(walletRef.current, price, qty)
    if (!newWallet) return
    setWallet(newWallet)
    walletRef.current = newWallet
    playBuySound()
    broadcast({ t: 'pos', u: uid, n: user?.displayName || 'anon', c: newWallet.cash, s: newWallet.shares, a: newWallet.avgCost })
  }, [uid, user?.displayName, broadcast])

  const sell = useCallback((qty) => {
    const price = pricesRef.current[tickIdxRef.current]
    if (!price) return
    const newWallet = executeSell(walletRef.current, price, qty)
    if (!newWallet) return
    setWallet(newWallet)
    walletRef.current = newWallet
    playSellSound()
    broadcast({ t: 'pos', u: uid, n: user?.displayName || 'anon', c: newWallet.cash, s: newWallet.shares, a: newWallet.avgCost })
  }, [uid, user?.displayName, broadcast])

  const sellAll = useCallback(() => sell(walletRef.current.shares), [sell])

  // --- keyboard shortcuts ---
  useEffect(() => {
    if (phase !== 'playing') return
    const onKey = (e) => {
      if (e.key === '1') buy(1)
      else if (e.key === '5') buy(5)
      else if (e.key === '0') buy(10)
      else if (e.key === 'q' || e.key === 'Q') sell(1)
      else if (e.key === 'x' || e.key === 'X') sellAll()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, buy, sell, sellAll])

  const backToLobby = useCallback(async () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    setPhase('lobby')
    setSummary(null)
    if (sessionDoc) updateDoc(sessionDoc, { status: 'lobby' }).catch(() => toast.error('Failed to reset game'))
  }, [sessionDoc])

  const inLobby = !!lobby[uid]
  const playerCount = Object.keys(lobby).length
  const timeLeft = phase === 'playing' ? Math.ceil((TOTAL_TICKS - tickIdx) * TICK_MS / 1000) : 0
  const priceChange = phase === 'playing' && pricesRef.current[0]
    ? ((currentPrice - pricesRef.current[0]) / pricesRef.current[0] * 100)
    : 0
  const unrealizedPnl = wallet.shares > 0 ? (currentPrice - wallet.avgCost) * wallet.shares : 0
  const totalValue = wallet.cash + wallet.shares * currentPrice

  // all player positions (merge local + remote)
  const allPositions = useMemo(() => {
    const all = {}
    for (const [pid, p] of Object.entries(lobby)) {
      all[pid] = { displayName: p.displayName, cash: p.cash ?? START_CASH, shares: p.shares ?? 0, avgCost: p.avgCost ?? 0 }
    }
    // overlay live positions from data channels
    for (const [pid, p] of Object.entries(positions)) {
      if (all[pid]) Object.assign(all[pid], p)
    }
    // overlay own live wallet
    if (uid && all[uid]) {
      all[uid] = { ...all[uid], cash: wallet.cash, shares: wallet.shares, avgCost: wallet.avgCost }
    }
    return all
  }, [lobby, positions, uid, wallet])

  // --- render ---
  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-void">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-void-border bg-void-light/50 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-neon-green font-display font-bold text-sm tracking-wider">STONKS</span>
          <span className="text-text-muted text-[10px] font-mono">// {activeChannel?.name}</span>
          {phase === 'playing' && (
            <>
              <span className="text-text-primary font-mono text-sm font-bold ml-2">${currentPrice.toFixed(2)}</span>
              <span className={`text-[10px] font-mono ${priceChange >= 0 ? 'text-neon-green' : 'text-neon-pink'}`}>
                {priceChange >= 0 ? '▲' : '▼'}{Math.abs(priceChange).toFixed(1)}%
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {profileName && phase !== 'lobby' && (
            <span className="text-[9px] font-mono text-text-muted/60 uppercase">{profileName}</span>
          )}
          {phase === 'playing' && (
            <span className="text-[10px] font-mono text-text-muted tabular-nums">{timeLeft}s</span>
          )}
          {dayNum > 0 && (
            <span className="text-[9px] font-mono text-text-muted">day {dayNum}</span>
          )}
        </div>
      </div>

      {/* lobby */}
      {phase === 'lobby' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 p-6">
          {!inVoice ? (
            <div className="text-center">
              <p className="text-text-muted font-mono text-sm mb-2">join voice to play</p>
              <p className="text-text-muted/50 text-[10px] font-mono">stocks uses peer-to-peer connections from voice chat</p>
            </div>
          ) : (
            <>
              <div className="text-center">
                <p className="text-neon-green font-display text-2xl font-bold tracking-widest mb-1">STONKS</p>
                <p className="text-text-muted text-[10px] font-mono">trade fast, get rich or go broke</p>
              </div>

              {/* player wallets */}
              <div className="w-full max-w-sm space-y-1.5">
                {Object.entries(lobby).map(([pid, p]) => (
                  <div key={pid} className="flex items-center gap-2 px-3 py-2 rounded-lg glass border border-void-border">
                    <span className="text-sm text-text-primary font-mono flex-1 truncate">
                      {p.displayName}{pid === uid ? <span className="text-text-muted ml-1">(you)</span> : ''}
                    </span>
                    <span className="text-[10px] font-mono text-neon-green">${(p.cash ?? START_CASH).toLocaleString()}</span>
                  </div>
                ))}
                {playerCount === 0 && (
                  <p className="text-center text-text-muted/50 text-xs font-mono py-4">no players yet</p>
                )}
              </div>

              <div className="flex gap-2">
                {!inLobby ? (
                  <button onClick={joinLobby}
                    className="px-5 py-2 bg-neon-green text-void rounded-lg font-semibold text-sm font-mono hover:bg-neon-green/90 transition-all hover:shadow-[0_0_20px_rgba(0,255,136,0.3)]">
                    join
                  </button>
                ) : (
                  <>
                    <button onClick={leaveLobby}
                      className="px-4 py-2 rounded-lg text-sm font-mono text-text-muted border border-void-border hover:border-neon-pink/30 hover:text-neon-pink transition-all">
                      leave
                    </button>
                    <button onClick={startDay} disabled={playerCount < 1}
                      className="px-5 py-2 bg-neon-green text-void rounded-lg font-semibold text-sm font-mono hover:bg-neon-green/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:shadow-[0_0_20px_rgba(0,255,136,0.3)]">
                      start day
                    </button>
                    <button onClick={resetWallet} title="Reset wallet to $10,000"
                      className="px-3 py-2 rounded-lg text-[10px] font-mono text-text-muted border border-void-border hover:border-neon-pink/30 hover:text-neon-pink transition-all">
                      reset $
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
        <div className="flex-1 flex flex-col items-center justify-center">
          <span className="text-[10px] font-mono text-text-muted mb-2 uppercase">{profileName}</span>
          <span className="text-neon-green font-display text-8xl font-bold animate-pulse">{countdown}</span>
        </div>
      )}

      {/* playing + summary */}
      {(phase === 'playing' || phase === 'summary') && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
          {/* chart */}
          <div ref={containerRef} className="flex-1 min-h-0 p-2">
            <canvas ref={canvasRef} className="w-full h-full rounded" style={{ imageRendering: 'auto' }} />
          </div>

          {/* wallet bar */}
          <div className="px-4 py-2 border-t border-void-border bg-void-light/30 shrink-0">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
              <div className="flex items-center gap-3 flex-wrap">
                <div>
                  <span className="text-[9px] font-mono text-text-muted block">cash</span>
                  <span className="text-sm font-mono text-neon-green font-bold">${wallet.cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div>
                  <span className="text-[9px] font-mono text-text-muted block">shares</span>
                  <span className="text-sm font-mono text-text-primary font-bold">{wallet.shares}</span>
                </div>
                {wallet.shares > 0 && (
                  <>
                    <div>
                      <span className="text-[9px] font-mono text-text-muted block">avg cost</span>
                      <span className="text-sm font-mono text-yellow-400">${wallet.avgCost.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-mono text-text-muted block">P&L</span>
                      <span className={`text-sm font-mono font-bold ${unrealizedPnl >= 0 ? 'text-neon-green' : 'text-neon-pink'}`}>
                        {unrealizedPnl >= 0 ? '+' : ''}{unrealizedPnl.toFixed(2)}
                      </span>
                    </div>
                  </>
                )}
                <div>
                  <span className="text-[9px] font-mono text-text-muted block">total</span>
                  <span className="text-sm font-mono text-text-primary font-bold">${totalValue.toFixed(2)}</span>
                </div>
              </div>

              {/* trade controls */}
              {phase === 'playing' && (
                <div className="flex gap-1 flex-wrap">
                  <button onClick={() => buy(1)} className="min-w-[36px] px-2 py-1.5 rounded text-[10px] font-mono font-bold bg-neon-cyan/15 text-neon-cyan hover:bg-neon-cyan/25 active:bg-neon-cyan/30 transition-colors" title="Buy 1 (key: 1)">B1</button>
                  <button onClick={() => buy(5)} className="min-w-[36px] px-2 py-1.5 rounded text-[10px] font-mono font-bold bg-neon-cyan/15 text-neon-cyan hover:bg-neon-cyan/25 active:bg-neon-cyan/30 transition-colors" title="Buy 5 (key: 5)">B5</button>
                  <button onClick={() => buy(10)} className="min-w-[36px] px-2 py-1.5 rounded text-[10px] font-mono font-bold bg-neon-cyan/15 text-neon-cyan hover:bg-neon-cyan/25 active:bg-neon-cyan/30 transition-colors" title="Buy 10 (key: 0)">B10</button>
                  <button onClick={() => buy(Math.floor(wallet.cash / currentPrice))} className="min-w-[36px] px-2 py-1.5 rounded text-[10px] font-mono font-bold bg-neon-cyan/20 text-neon-cyan hover:bg-neon-cyan/30 active:bg-neon-cyan/40 transition-colors" title="Buy max">MAX</button>
                  <div className="w-px bg-void-border mx-0.5 hidden sm:block" />
                  <button onClick={() => sell(1)} disabled={wallet.shares < 1} className="min-w-[36px] px-2 py-1.5 rounded text-[10px] font-mono font-bold bg-neon-pink/15 text-neon-pink hover:bg-neon-pink/25 active:bg-neon-pink/30 disabled:opacity-30 transition-colors" title="Sell 1 (key: Q)">S1</button>
                  <button onClick={() => sell(5)} disabled={wallet.shares < 1} className="min-w-[36px] px-2 py-1.5 rounded text-[10px] font-mono font-bold bg-neon-pink/15 text-neon-pink hover:bg-neon-pink/25 active:bg-neon-pink/30 disabled:opacity-30 transition-colors" title="Sell 5">S5</button>
                  <button onClick={sellAll} disabled={wallet.shares < 1} className="min-w-[36px] px-2 py-1.5 rounded text-[10px] font-mono font-bold bg-neon-pink/20 text-neon-pink hover:bg-neon-pink/30 active:bg-neon-pink/40 disabled:opacity-30 transition-colors" title="Sell all (key: X)">ALL</button>
                </div>
              )}
            </div>

            {/* all players positions */}
            <div className="flex gap-3 flex-wrap">
              {Object.entries(allPositions).map(([pid, p]) => (
                <div key={pid} className="text-[9px] font-mono px-2 py-1 rounded glass border border-void-border flex items-center gap-2">
                  <span className={`${pid === uid ? 'text-neon-green' : 'text-text-muted'}`}>{p.displayName}</span>
                  <span className="text-neon-green">${p.cash.toFixed(0)}</span>
                  {p.shares > 0 && (
                    <>
                      <span className="text-text-primary">{p.shares}sh</span>
                      <span className="text-yellow-400">@{p.avgCost.toFixed(2)}</span>
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* keyboard hints */}
            {phase === 'playing' && (
              <div className="text-[8px] font-mono text-text-muted/30 mt-1">
                keys: 1/5/0 = buy 1/5/10 · Q = sell 1 · X = sell all
              </div>
            )}
          </div>

          {/* summary overlay */}
          {phase === 'summary' && summary && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-void/80 z-10">
              <p className="text-text-muted text-xs font-mono mb-2">market closed — day {dayNum}</p>
              <div className="text-center mb-4">
                <p className="text-text-muted text-[10px] font-mono">
                  open ${summary.openPrice.toFixed(2)} → close ${summary.closePrice.toFixed(2)}
                </p>
                <p className={`text-3xl font-display font-bold mt-2 ${summary.pnl >= 0 ? 'text-neon-green' : 'text-neon-pink'}`}>
                  {summary.pnl >= 0 ? '+' : ''}${summary.pnl.toFixed(2)}
                </p>
                <p className="text-text-muted text-[10px] font-mono mt-1">
                  wallet: ${summary.finalCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
              {/* leaderboard */}
              <div className="w-full max-w-xs space-y-1 mb-4">
                {Object.entries(allPositions).sort(([,a],[,b]) => b.cash - a.cash).map(([pid, p], i) => (
                  <div key={pid} className="flex items-center gap-2 px-3 py-1.5 rounded glass border border-void-border">
                    <span className="text-[10px] font-mono text-text-muted w-4">{i + 1}.</span>
                    <span className={`text-xs font-mono flex-1 ${pid === uid ? 'text-neon-green' : 'text-text-primary'}`}>
                      {p.displayName}
                    </span>
                    <span className="text-xs font-mono text-neon-green">${p.cash.toFixed(0)}</span>
                  </div>
                ))}
              </div>
              <button onClick={backToLobby}
                className="px-5 py-2 bg-neon-green text-void rounded-lg font-semibold text-sm font-mono hover:bg-neon-green/90 transition-all hover:shadow-[0_0_20px_rgba(0,255,136,0.3)]">
                next day
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
