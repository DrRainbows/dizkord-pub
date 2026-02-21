import { useState, useEffect, useRef } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db, auth } from '../../config/firebase'

/**
 * Spotlight onboarding tutorial.
 * Darkens screen, cuts out a highlight around the target element, shows tooltip with arrow.
 */

const STEPS = [
  {
    target: '[data-tour="groups"]',
    text: 'your groups live here. create one with + or join with an invite link.',
    position: 'right',
  },
  {
    target: '[data-tour="channels"]',
    text: 'text channels for messaging, voice channels to talk. click a voice channel to join instantly.',
    position: 'right',
  },
  {
    target: '[data-tour="chat-input"]',
    text: 'type @ to mention people or summon grok ai. paste images, react on hover, pin messages.',
    position: 'top',
  },
  {
    target: '[data-tour="settings"]',
    text: 'profile pic, display name, voice settings. make it yours.',
    position: 'top',
  },
  {
    target: '[data-tour="invite"]',
    text: 'share this link to invite friends to your group.',
    position: 'bottom',
  },
]

function getTargetRect(selector) {
  const el = document.querySelector(selector)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

function getTooltipStyle(rect, position) {
  if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  const pad = 16
  switch (position) {
    case 'right': return { top: rect.top + rect.height / 2, left: rect.left + rect.width + pad, transform: 'translateY(-50%)' }
    case 'left': return { top: rect.top + rect.height / 2, left: rect.left - pad, transform: 'translate(-100%, -50%)' }
    case 'bottom': return { top: rect.top + rect.height + pad, left: rect.left + rect.width / 2, transform: 'translateX(-50%)' }
    case 'top': return { top: rect.top - pad, left: rect.left + rect.width / 2, transform: 'translate(-50%, -100%)' }
    default: return { top: rect.top + rect.height + pad, left: rect.left, transform: 'none' }
  }
}

export default function OnboardingTutorial({ onComplete }) {
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState(null)
  const overlayRef = useRef(null)

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  // find and track target element
  useEffect(() => {
    function update() {
      if (!current) return
      setRect(getTargetRect(current.target))
    }
    update()
    const interval = setInterval(update, 500) // re-check in case layout shifts
    window.addEventListener('resize', update)
    return () => { clearInterval(interval); window.removeEventListener('resize', update) }
  }, [current])

  const handleComplete = async () => {
    try {
      const uid = auth.currentUser?.uid
      if (uid) await updateDoc(doc(db, 'users', uid), { onboardingComplete: true })
    } catch { /* non-critical */ }
    onComplete()
  }

  const handleNext = () => {
    if (isLast) handleComplete()
    else setStep(s => s + 1)
  }

  // spotlight cutout dimensions
  const pad = 8
  const cutout = rect ? {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  } : null

  const tooltipStyle = getTooltipStyle(rect, current?.position)

  return (
    <div ref={overlayRef} className="fixed inset-0 z-[100]">
      {/* dark overlay with cutout */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
        <defs>
          <mask id="spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {cutout && (
              <rect
                x={cutout.left} y={cutout.top}
                width={cutout.width} height={cutout.height}
                rx="8" fill="black"
              />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.75)" mask="url(#spotlight-mask)" />
      </svg>

      {/* highlight border around target */}
      {cutout && (
        <div
          className="absolute rounded-lg border-2 border-neon-green/60 pointer-events-none"
          style={{ top: cutout.top, left: cutout.left, width: cutout.width, height: cutout.height }}
        />
      )}

      {/* tooltip */}
      <div
        className="absolute glass rounded-xl border border-void-border p-4 max-w-xs animate-fade-in"
        style={{ ...tooltipStyle, zIndex: 101 }}
      >
        {/* step indicator */}
        <div className="flex items-center gap-1 mb-2">
          {STEPS.map((_, i) => (
            <div key={i} className={`h-1 rounded-full transition-all ${i === step ? 'w-5 bg-neon-green' : i < step ? 'w-2 bg-neon-green/40' : 'w-2 bg-void-border'}`} />
          ))}
          <span className="text-text-muted text-[10px] font-mono ml-auto">{step + 1}/{STEPS.length}</span>
        </div>

        {/* text */}
        <p className="text-text-primary text-sm leading-relaxed">{current?.text}</p>

        {/* controls */}
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={handleComplete}
            className="text-text-muted text-xs font-mono hover:text-text-secondary transition-colors"
          >
            skip
          </button>
          <button
            onClick={handleNext}
            className="px-4 py-1.5 bg-neon-green text-void rounded-lg font-semibold text-xs
                       hover:bg-neon-green/90 transition-all"
          >
            {isLast ? 'done' : 'next →'}
          </button>
        </div>

        {/* completion note */}
        {isLast && (
          <p className="text-text-muted text-[10px] font-mono mt-3">// this won&apos;t show again</p>
        )}
      </div>
    </div>
  )
}
