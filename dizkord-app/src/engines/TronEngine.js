/**
 * TronEngine — pure game logic for Tron light cycles.
 * No React, no Firestore, no DOM. Just state manipulation + canvas rendering.
 */

// --- constants ---
export const GRID_W = 60
export const GRID_H = 40
export const TICK_MS = 140
export const DC_LABEL = 'tron'
export const DC_ID = 100

export const COLORS = ['#00ff88', '#00d4ff', '#bf5af2', '#ff3b6f', '#ff9f0a', '#ffd60a', '#ff453a']
export const COLOR_NAMES = ['green', 'cyan', 'purple', 'pink', 'orange', 'yellow', 'red']

export const SPAWNS = [
  { x: 5,  y: 20, dir: 'r' },
  { x: 54, y: 20, dir: 'l' },
  { x: 30, y: 3,  dir: 'd' },
  { x: 30, y: 37, dir: 'u' },
  { x: 5,  y: 3,  dir: 'r' },
  { x: 54, y: 37, dir: 'l' },
  { x: 30, y: 20, dir: 'u' },
]

export const DIR = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] }
export const OPP = { u: 'd', d: 'u', l: 'r', r: 'l' }
export const DEATH_ANIM_TICKS = 12

export const KEY_MAP = {
  ArrowUp: 'u', ArrowDown: 'd', ArrowLeft: 'l', ArrowRight: 'r',
  w: 'u', s: 'd', a: 'l', d: 'r', W: 'u', S: 'd', A: 'l', D: 'r',
}

// --- audio ---
let _actx = null
function getACtx() {
  if (!_actx || _actx.state === 'closed') _actx = new AudioContext()
  return _actx
}

export function playDeathSound() {
  const ctx = getACtx(), t = ctx.currentTime
  const osc = ctx.createOscillator(), gain = ctx.createGain()
  osc.connect(gain).connect(ctx.destination)
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(220, t); osc.frequency.exponentialRampToValueAtTime(40, t + 0.15)
  gain.gain.setValueAtTime(0.15, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
  osc.start(t); osc.stop(t + 0.2)
}

export function playWinSound() {
  const ctx = getACtx(), t = ctx.currentTime
  ;[523, 659, 784].forEach((freq, i) => {
    const osc = ctx.createOscillator(), gain = ctx.createGain()
    osc.connect(gain).connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, t + i * 0.12)
    gain.gain.setValueAtTime(0.1, t + i * 0.12); gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.25)
    osc.start(t + i * 0.12); osc.stop(t + i * 0.12 + 0.25)
  })
}

export function closeAudioContext() {
  if (_actx && _actx.state !== 'closed') _actx.close().catch(() => {})
}

// --- game state ---

export function initGame(playerList) {
  const players = {}
  playerList.forEach((p, i) => {
    const sp = SPAWNS[i % SPAWNS.length]
    players[p.uid] = {
      x: sp.x, y: sp.y, dir: sp.dir, alive: true, trail: [],
      colorIdx: p.colorIdx, name: p.displayName, nextDir: null,
    }
  })
  return { tick: 0, players, over: false, winner: null }
}

export function tick(state) {
  state.tick++
  for (const p of Object.values(state.players)) {
    if (!p.alive) continue
    if (p.nextDir !== null) { p.dir = p.nextDir; p.nextDir = null }
  }
  for (const p of Object.values(state.players)) {
    if (!p.alive) continue
    p.trail.push([p.x, p.y])
    const [dx, dy] = DIR[p.dir]
    p.x += dx; p.y += dy
  }
  const occ = new Set()
  for (const p of Object.values(state.players)) {
    for (const [tx, ty] of p.trail) occ.add(tx * 100 + ty)
  }
  const heads = {}
  for (const [uid, p] of Object.entries(state.players)) {
    if (!p.alive) continue
    const k = p.x * 100 + p.y
    if (p.x < 0 || p.x >= GRID_W || p.y < 0 || p.y >= GRID_H || occ.has(k)) {
      p.alive = false; p.deathTick = state.tick; p.deathX = p.x; p.deathY = p.y; continue
    }
    if (heads[k]) {
      const other = state.players[heads[k]]
      p.alive = false; p.deathTick = state.tick; p.deathX = p.x; p.deathY = p.y
      other.alive = false; other.deathTick = state.tick; other.deathX = other.x; other.deathY = other.y
    } else heads[k] = uid
  }
  const alive = Object.entries(state.players).filter(([, p]) => p.alive)
  if (alive.length <= 1) {
    state.over = true
    state.winner = alive.length === 1 ? alive[0][0] : null
  }
}

// --- renderer ---

export function render(ctx, state, cz) {
  const w = GRID_W * cz, h = GRID_H * cz
  ctx.fillStyle = '#08080f'; ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(255,255,255,0.015)'; ctx.lineWidth = 0.5
  for (let x = 0; x <= GRID_W; x++) { ctx.beginPath(); ctx.moveTo(x * cz, 0); ctx.lineTo(x * cz, h); ctx.stroke() }
  for (let y = 0; y <= GRID_H; y++) { ctx.beginPath(); ctx.moveTo(0, y * cz); ctx.lineTo(w, y * cz); ctx.stroke() }
  // trails
  for (const p of Object.values(state.players)) {
    const col = COLORS[p.colorIdx] || '#fff'
    const len = p.trail.length
    for (let i = 0; i < len; i++) {
      const [tx, ty] = p.trail[i]
      ctx.globalAlpha = p.alive ? 0.25 + 0.45 * (i / len) : 0.12
      ctx.fillStyle = col; ctx.fillRect(tx * cz + 0.5, ty * cz + 0.5, cz - 1, cz - 1)
    }
  }
  ctx.globalAlpha = 1
  // heads + labels
  ctx.save()
  for (const p of Object.values(state.players)) {
    if (!p.alive) continue
    const col = COLORS[p.colorIdx] || '#fff'
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = cz * 2
    ctx.fillRect(p.x * cz, p.y * cz, cz, cz)
    ctx.shadowBlur = 0; ctx.font = `bold ${Math.max(8, cz * 0.8)}px monospace`
    ctx.textAlign = 'center'; ctx.fillStyle = col; ctx.globalAlpha = 0.7
    ctx.fillText(p.name, p.x * cz + cz / 2, p.y * cz - cz * 0.3); ctx.globalAlpha = 1
  }
  ctx.restore()
  // death explosions
  for (const p of Object.values(state.players)) {
    if (p.deathTick == null) continue
    const age = state.tick - p.deathTick
    if (age > DEATH_ANIM_TICKS) continue
    const t = age / DEATH_ANIM_TICKS
    const col = COLORS[p.colorIdx] || '#fff'
    const cx = (p.deathX != null ? p.deathX : p.x) * cz + cz / 2
    const cy = (p.deathY != null ? p.deathY : p.y) * cz + cz / 2
    ctx.save()
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, cz * 0.3 * (1 - t)); ctx.globalAlpha = 0.8 * (1 - t)
    ctx.beginPath(); ctx.arc(cx, cy, cz * (1 + t * 5), 0, Math.PI * 2); ctx.stroke()
    ctx.fillStyle = col; ctx.globalAlpha = 0.4 * (1 - t)
    ctx.beginPath(); ctx.arc(cx, cy, cz * (0.5 + t * 2), 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1
  ctx.strokeRect(0, 0, w, h)
}
