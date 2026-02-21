import { useToastStore } from '../../stores/toastStore'

const typeStyles = {
  info: 'border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan',
  success: 'border-neon-green/40 bg-neon-green/10 text-neon-green',
  error: 'border-neon-pink/40 bg-neon-pink/10 text-neon-pink',
  warn: 'border-neon-yellow/40 bg-neon-yellow/10 text-neon-yellow',
}

export default function Toast() {
  const toasts = useToastStore(s => s.toasts)
  const removeToast = useToastStore(s => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`px-4 py-2.5 rounded-lg border backdrop-blur-md text-sm font-mono animate-fade-in cursor-pointer ${typeStyles[t.type] || typeStyles.info}`}
          onClick={() => removeToast(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
