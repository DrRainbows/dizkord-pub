import { useEffect, useRef } from 'react'

/**
 * Pixel Rain - retro falling pixel blocks with color variety.
 * Uses OffscreenCanvas + Worker so the main thread stays free
 * during heavy operations (WASM loading, etc).
 * Falls back to main-thread rendering if OffscreenCanvas isn't supported.
 */
export default function MatrixRain() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const supportsOffscreen = typeof canvas.transferControlToOffscreen === 'function'

    if (supportsOffscreen) {
      return setupOffscreen(canvas)
    }
    return setupMainThread(canvas)
  }, [])

  return <canvas ref={canvasRef} className="pixel-canvas" />
}

// --- draw logic shared between worker and main thread ---
const PIXEL_SIZE = 8
const GAP = 1
const COLORS = [
  'rgba(0, 255, 136, 0.4)',
  'rgba(191, 90, 242, 0.3)',
  'rgba(10, 132, 255, 0.25)',
  'rgba(100, 210, 255, 0.2)',
  'rgba(255, 55, 95, 0.15)',
  'rgba(0, 255, 136, 0.15)',
]

function initState(width, height) {
  const columns = Math.floor(width / PIXEL_SIZE)
  return {
    columns,
    drops: Array(columns).fill(0).map(() => Math.random() * -50),
    speeds: Array(columns).fill(0).map(() => 0.2 + Math.random() * 0.5),
    colColors: Array(columns).fill(0).map(() => COLORS[Math.floor(Math.random() * COLORS.length)]),
    width,
    height,
  }
}

function drawFrame(ctx, state) {
  ctx.fillStyle = 'rgba(10, 10, 15, 0.06)'
  ctx.fillRect(0, 0, state.width, state.height)

  for (let i = 0; i < state.columns; i++) {
    const x = i * PIXEL_SIZE
    const y = Math.floor(state.drops[i]) * PIXEL_SIZE

    ctx.fillStyle = state.colColors[i]
    ctx.fillRect(x, y, PIXEL_SIZE - GAP, PIXEL_SIZE - GAP)

    ctx.fillStyle = 'rgba(0, 255, 136, 0.08)'
    ctx.fillRect(x, y - PIXEL_SIZE, PIXEL_SIZE - GAP, PIXEL_SIZE - GAP)

    if (Math.random() > 0.995) {
      ctx.fillStyle = 'rgba(0, 255, 136, 0.7)'
      ctx.fillRect(x, y, PIXEL_SIZE - GAP, PIXEL_SIZE - GAP)
      state.colColors[i] = COLORS[Math.floor(Math.random() * COLORS.length)]
    }

    state.drops[i] += state.speeds[i]
    if (state.drops[i] * PIXEL_SIZE > state.height && Math.random() > 0.99) {
      state.drops[i] = 0
      state.speeds[i] = 0.2 + Math.random() * 0.5
    }
  }
}

// --- OffscreenCanvas path (runs in a worker) ---
function setupOffscreen(canvas) {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight

  const offscreen = canvas.transferControlToOffscreen()

  // inline worker via blob URL
  const workerCode = `
    const PIXEL_SIZE = 8
    const GAP = 1
    const COLORS = [
      'rgba(0, 255, 136, 0.4)',
      'rgba(191, 90, 242, 0.3)',
      'rgba(10, 132, 255, 0.25)',
      'rgba(100, 210, 255, 0.2)',
      'rgba(255, 55, 95, 0.15)',
      'rgba(0, 255, 136, 0.15)',
    ]

    let canvas, ctx, state, animId
    let frameInterval = 0
    let lastFrame = 0

    function initState(w, h) {
      const columns = Math.floor(w / PIXEL_SIZE)
      return {
        columns,
        drops: Array(columns).fill(0).map(() => Math.random() * -50),
        speeds: Array(columns).fill(0).map(() => 0.2 + Math.random() * 0.5),
        colColors: Array(columns).fill(0).map(() => COLORS[Math.floor(Math.random() * COLORS.length)]),
        width: w,
        height: h,
      }
    }

    function draw(timestamp) {
      if (frameInterval && timestamp - lastFrame < frameInterval) {
        animId = requestAnimationFrame(draw)
        return
      }
      lastFrame = timestamp
      ctx.fillStyle = 'rgba(10, 10, 15, 0.06)'
      ctx.fillRect(0, 0, state.width, state.height)
      for (let i = 0; i < state.columns; i++) {
        const x = i * PIXEL_SIZE
        const y = Math.floor(state.drops[i]) * PIXEL_SIZE
        ctx.fillStyle = state.colColors[i]
        ctx.fillRect(x, y, PIXEL_SIZE - GAP, PIXEL_SIZE - GAP)
        ctx.fillStyle = 'rgba(0, 255, 136, 0.08)'
        ctx.fillRect(x, y - PIXEL_SIZE, PIXEL_SIZE - GAP, PIXEL_SIZE - GAP)
        if (Math.random() > 0.995) {
          ctx.fillStyle = 'rgba(0, 255, 136, 0.7)'
          ctx.fillRect(x, y, PIXEL_SIZE - GAP, PIXEL_SIZE - GAP)
          state.colColors[i] = COLORS[Math.floor(Math.random() * COLORS.length)]
        }
        state.drops[i] += state.speeds[i]
        if (state.drops[i] * PIXEL_SIZE > state.height && Math.random() > 0.99) {
          state.drops[i] = 0
          state.speeds[i] = 0.2 + Math.random() * 0.5
        }
      }
      animId = requestAnimationFrame(draw)
    }

    self.onmessage = (e) => {
      if (e.data.type === 'init') {
        canvas = e.data.canvas
        ctx = canvas.getContext('2d')
        frameInterval = e.data.mobile ? 66 : 0
        state = initState(canvas.width, canvas.height)
        animId = requestAnimationFrame(draw)
      } else if (e.data.type === 'resize') {
        if (canvas) { canvas.width = e.data.width; canvas.height = e.data.height }
        state = initState(e.data.width, e.data.height)
      } else if (e.data.type === 'stop') {
        if (animId != null) cancelAnimationFrame(animId)
      }
    }
  `

  const blob = new Blob([workerCode], { type: 'application/javascript' })
  const workerUrl = URL.createObjectURL(blob)
  const worker = new Worker(workerUrl)

  const isMobile = window.matchMedia('(pointer: coarse)').matches
  worker.postMessage({ type: 'init', canvas: offscreen, mobile: isMobile }, [offscreen])

  const handleResize = () => {
    worker.postMessage({ type: 'resize', width: window.innerWidth, height: window.innerHeight })
  }
  window.addEventListener('resize', handleResize)

  return () => {
    worker.postMessage({ type: 'stop' })
    worker.terminate()
    window.removeEventListener('resize', handleResize)
    URL.revokeObjectURL(workerUrl)
  }
}

// --- Main-thread fallback (Safari < 17, older browsers) ---
// Throttled to ~15fps on mobile to reduce CPU/battery drain
function setupMainThread(canvas) {
  const ctx = canvas.getContext('2d')
  let animId
  const isMobile = window.matchMedia('(pointer: coarse)').matches
  const FRAME_INTERVAL = isMobile ? 66 : 0 // ~15fps on mobile, full speed on desktop
  let lastFrame = 0

  function resize() {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
  }
  resize()
  window.addEventListener('resize', resize)

  let state = initState(canvas.width, canvas.height)

  function draw(timestamp) {
    if (FRAME_INTERVAL && timestamp - lastFrame < FRAME_INTERVAL) {
      animId = requestAnimationFrame(draw)
      return
    }
    lastFrame = timestamp
    drawFrame(ctx, state)
    animId = requestAnimationFrame(draw)
  }

  animId = requestAnimationFrame(draw)
  return () => {
    cancelAnimationFrame(animId)
    window.removeEventListener('resize', resize)
  }
}
