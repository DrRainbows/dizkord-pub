/**
 * StockEngine — pure game logic for the fake stock trading game.
 * No React, no Firestore, no DOM. Just simulation + canvas rendering.
 */

// --- constants ---
export const TICK_MS = 200
export const TOTAL_TICKS = 300
export const START_CASH = 10000
export const START_PRICE = 100
export const DC_LABEL = 'stocks'
export const DC_ID = 101

// --- PRNG (mulberry32) ---
export function mulberry32(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

// --- day profiles ---
export const PROFILES = [
  { name: 'BULL RUN',   drift: t => 0.08 + 0.15 * t, noise: 1.2 },
  { name: 'BEAR MKT',   drift: t => -0.08 - 0.12 * t, noise: 1.2 },
  { name: 'VOLATILE',   drift: () => 0, noise: 2.5 },
  { name: 'CRASH',      drift: t => t < 0.65 ? 0.15 : -0.8, noise: 1.0 },
  { name: 'RECOVERY',   drift: t => t < 0.35 ? -0.25 : 0.3, noise: 1.0 },
  { name: 'PUMP&DUMP',  drift: t => t < 0.55 ? 0.3 : -1.2, noise: 0.8 },
  { name: 'FLAT',       drift: () => 0.01, noise: 0.6 },
]

export function generatePrices(seed, profileIdx) {
  const rng = mulberry32(seed)
  const prof = PROFILES[profileIdx % PROFILES.length]
  let price = START_PRICE
  const prices = [price]
  for (let i = 1; i < TOTAL_TICKS; i++) {
    const t = i / TOTAL_TICKS
    const d = prof.drift(t)
    const n = (rng() - 0.5) * 2 * prof.noise
    price = Math.max(0.5, price + d + n)
    prices.push(Math.round(price * 100) / 100)
  }
  return prices
}

// --- audio ---
let _actx = null
function getACtx() {
  if (!_actx || _actx.state === 'closed') _actx = new AudioContext()
  return _actx
}

export function playBuySound() {
  const c = getACtx(), t = c.currentTime, o = c.createOscillator(), g = c.createGain()
  o.connect(g).connect(c.destination); o.type = 'sine'
  o.frequency.setValueAtTime(500, t); o.frequency.exponentialRampToValueAtTime(800, t + 0.05)
  g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08)
  o.start(t); o.stop(t + 0.08)
}

export function playSellSound() {
  const c = getACtx(), t = c.currentTime, o = c.createOscillator(), g = c.createGain()
  o.connect(g).connect(c.destination); o.type = 'sine'
  o.frequency.setValueAtTime(800, t); o.frequency.exponentialRampToValueAtTime(400, t + 0.05)
  g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08)
  o.start(t); o.stop(t + 0.08)
}

export function playBellSound() {
  const c = getACtx(), t = c.currentTime, o = c.createOscillator(), g = c.createGain()
  o.connect(g).connect(c.destination); o.type = 'triangle'
  o.frequency.setValueAtTime(800, t)
  g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
  o.start(t); o.stop(t + 0.4)
}

export function closeAudioContext() {
  if (_actx && _actx.state !== 'closed') _actx.close().catch(() => {})
}

// --- trade execution ---

export function executeBuy(wallet, price, qty) {
  const cost = price * qty
  if (wallet.cash < cost) {
    qty = Math.floor(wallet.cash / price)
    if (qty <= 0) return null
  }
  const totalCost = price * qty
  const newShares = wallet.shares + qty
  const newAvg = (wallet.avgCost * wallet.shares + totalCost) / newShares
  return {
    cash: Math.round((wallet.cash - totalCost) * 100) / 100,
    shares: newShares,
    avgCost: Math.round(newAvg * 100) / 100,
  }
}

export function executeSell(wallet, price, qty) {
  if (wallet.shares <= 0) return null
  qty = Math.min(qty, wallet.shares)
  const proceeds = price * qty
  const newShares = wallet.shares - qty
  return {
    cash: Math.round((wallet.cash + proceeds) * 100) / 100,
    shares: newShares,
    avgCost: newShares > 0 ? wallet.avgCost : 0,
  }
}

export function liquidate(wallet, closePrice) {
  const totalValue = wallet.cash + wallet.shares * closePrice
  return { cash: Math.round(totalValue * 100) / 100, shares: 0, avgCost: 0 }
}

// --- chart renderer ---

export function renderChart(ctx, w, h, prices, tickIdx, avgCost, trades) {
  const vis = prices.slice(0, tickIdx + 1)
  if (vis.length < 2) { ctx.fillStyle = '#08080f'; ctx.fillRect(0, 0, w, h); return }

  const minP = Math.min(...prices) * 0.95
  const maxP = Math.max(...prices) * 1.05
  const range = maxP - minP || 1
  const pad = { t: 10, r: 52, b: 10, l: 8 }
  const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b
  const xOf = (i) => pad.l + (i / (prices.length - 1)) * cw
  const yOf = (p) => pad.t + (1 - (p - minP) / range) * ch

  ctx.fillStyle = '#08080f'; ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 0.5
  for (let i = 0; i <= 5; i++) {
    const py = pad.t + (i / 5) * ch
    ctx.beginPath(); ctx.moveTo(pad.l, py); ctx.lineTo(w - pad.r, py); ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.font = '9px monospace'; ctx.textAlign = 'left'
    ctx.fillText('$' + (maxP - (i / 5) * range).toFixed(0), w - pad.r + 4, py + 3)
  }
  // open line
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 0.5
  ctx.beginPath(); ctx.moveTo(pad.l, yOf(prices[0])); ctx.lineTo(w - pad.r, yOf(prices[0])); ctx.stroke()
  ctx.setLineDash([])
  // avg cost
  if (avgCost > 0) {
    ctx.strokeStyle = 'rgba(255, 200, 0, 0.35)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(pad.l, yOf(avgCost)); ctx.lineTo(w - pad.r, yOf(avgCost)); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(255, 200, 0, 0.5)'; ctx.font = '9px monospace'
    ctx.fillText('avg $' + avgCost.toFixed(2), w - pad.r + 4, yOf(avgCost) + 3)
  }
  // price line
  const cur = vis[vis.length - 1], open = prices[0]
  const col = cur >= open ? '#00ff88' : '#ff3b6f'
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath()
  for (let i = 0; i < vis.length; i++) {
    const px = xOf(i), py = yOf(vis[i])
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
  }
  ctx.stroke()
  ctx.lineTo(xOf(vis.length - 1), yOf(open)); ctx.lineTo(xOf(0), yOf(open)); ctx.closePath()
  ctx.fillStyle = cur >= open ? 'rgba(0,255,136,0.04)' : 'rgba(255,59,111,0.04)'; ctx.fill()
  // current dot
  ctx.save(); ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8
  ctx.beginPath(); ctx.arc(xOf(tickIdx), yOf(cur), 3.5, 0, Math.PI * 2); ctx.fill(); ctx.restore()
  // trade markers
  for (const tr of trades) {
    if (tr.tick > tickIdx) continue
    ctx.fillStyle = tr.type === 'buy' ? '#00d4ff' : '#ff9f0a'
    const tx = xOf(tr.tick), ty = yOf(tr.price)
    ctx.beginPath()
    if (tr.type === 'buy') { ctx.moveTo(tx, ty - 5); ctx.lineTo(tx - 3, ty + 2); ctx.lineTo(tx + 3, ty + 2) }
    else { ctx.moveTo(tx, ty + 5); ctx.lineTo(tx - 3, ty - 2); ctx.lineTo(tx + 3, ty - 2) }
    ctx.fill()
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1; ctx.strokeRect(pad.l, pad.t, cw, ch)
}
