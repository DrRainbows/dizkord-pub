import GlitchText from './GlitchText'

const vibes = [
  'initializing the vibe check...',
  'loading the brainrot...',
  'compiling the aura...',
  'connecting to the matrix...',
  'decrypting the group chat...',
  'calibrating mic energy...',
  'establishing the mog protocol...',
  'syncing with the void...',
  'no cap loading rn...',
  'entering the dizkord dimension...',
  'downloading main character energy...',
  'buffering your rizz...',
  'allocating sigma bandwidth...',
  'parsing the group chat lore...',
  'defragging the vibe database...',
  'unlocking peak performance...',
  'warming up the neural yap engine...',
]

const initialVibe = vibes[Math.floor(Math.random() * vibes.length)]

export default function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-void flex flex-col items-center justify-center z-50">
      <div className="animate-float mb-8">
        <GlitchText
          text="DIZKORD"
          className="text-5xl font-bold font-display text-neon-green"
        />
      </div>
      <div className="flex items-center gap-2 text-text-secondary font-mono text-sm">
        <div className="w-2 h-2 bg-neon-green rounded-full animate-pulse" />
        {initialVibe}
      </div>
      <div className="mt-6 w-48 h-0.5 bg-void-lighter rounded overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-neon-green to-neon-purple rounded"
          style={{ animation: 'loading-bar 2s ease-in-out infinite' }}
        />
      </div>
      <style>{`
        @keyframes loading-bar {
          0% { width: 0%; margin-left: 0%; }
          50% { width: 60%; margin-left: 20%; }
          100% { width: 0%; margin-left: 100%; }
        }
      `}</style>
    </div>
  )
}
