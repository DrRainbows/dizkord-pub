import { useState } from 'react'

/**
 * Shared Avatar component.
 * Shows profile picture if available, otherwise gradient circle with initial.
 * Optional presence dot (online/idle/offline).
 */
export default function Avatar({ src, name, size = 'md', speaking = false, status, className = '' }) {
  const [imgError, setImgError] = useState(false)
  const sizes = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-16 h-16 text-2xl',
    xl: 'w-20 h-20 text-3xl',
  }

  const dotSizes = {
    xs: 'w-2 h-2 -bottom-0 -right-0',
    sm: 'w-2.5 h-2.5 -bottom-0 -right-0',
    md: 'w-3 h-3 -bottom-0.5 -right-0.5',
    lg: 'w-3.5 h-3.5 -bottom-0.5 -right-0.5',
    xl: 'w-4 h-4 -bottom-0.5 -right-0.5',
  }

  const statusColors = {
    online: 'bg-neon-green',
    idle: 'bg-neon-yellow',
    offline: 'bg-text-muted',
  }

  const initial = name?.[0]?.toUpperCase() || '?'
  const sizeClass = sizes[size] || sizes.md
  const ringClass = speaking ? 'speaking-ring' : ''

  return (
    <div className={`relative inline-flex shrink-0 ${className}`}>
      {src && !imgError ? (
        <img
          src={src}
          alt={name || 'avatar'}
          className={`${sizeClass} rounded-full object-cover ${ringClass}`}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
        />
      ) : (
        <div
          className={`${sizeClass} rounded-full bg-gradient-to-br from-neon-green to-neon-purple
            flex items-center justify-center text-void font-bold font-display ${ringClass}`}
        >
          {initial}
        </div>
      )}
      {/* presence dot */}
      {status && (
        <span
          className={`absolute ${dotSizes[size] || dotSizes.md} ${statusColors[status] || statusColors.offline}
            rounded-full border-2 border-void`}
        />
      )}
    </div>
  )
}
