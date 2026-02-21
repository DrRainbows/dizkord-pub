import { useState, useEffect } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'

const URL_REGEX = /(https?:\/\/[^\s<]+)/g
const TOKEN_REGEX = /(@\w+|https?:\/\/[^\s<]+)/g

function getYouTubeId(url) {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/)
  return m ? m[1] : null
}

function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', '') } catch { return url }
}

const MAX_PREVIEW_CACHE = 200
const previewCache = {}
const previewCacheKeys = []

function cachePreview(url, data) {
  if (!previewCache[url]) {
    previewCacheKeys.push(url)
    if (previewCacheKeys.length > MAX_PREVIEW_CACHE) {
      const evict = previewCacheKeys.shift()
      delete previewCache[evict]
    }
  }
  previewCache[url] = data
}

function YouTubeEmbed({ videoId, url }) {
  const [showPlayer, setShowPlayer] = useState(false)
  return (
    <div className="mt-2 max-w-md rounded-lg overflow-hidden border border-void-border bg-void-light">
      {showPlayer ? (
        <iframe src={`https://www.youtube.com/embed/${videoId}?autoplay=1`} className="w-full aspect-video" allow="autoplay; encrypted-media" allowFullScreen title="YouTube video" />
      ) : (
        <div className="relative cursor-pointer group" onClick={() => setShowPlayer(true)}>
          <img src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`} alt="video thumbnail" className="w-full aspect-video object-cover" loading="lazy" />
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/10 transition-all">
            <div className="w-14 h-14 rounded-full bg-neon-pink/90 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
              <span className="text-white text-xl ml-1">▶</span>
            </div>
          </div>
        </div>
      )}
      <div className="px-3 py-2">
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-neon-cyan hover:underline font-mono truncate block">youtube.com</a>
      </div>
    </div>
  )
}

function RichLinkPreview({ url }) {
  const [preview, setPreview] = useState(previewCache[url] || null)
  const [loading, setLoading] = useState(!previewCache[url])
  const domain = getDomain(url)

  useEffect(() => {
    if (previewCache[url]) return
    let cancelled = false
    async function fetchPreview() {
      try {
        const functions = getFunctions()
        const fn = httpsCallable(functions, 'getLinkPreview')
        const result = await fn({ url })
        if (!cancelled) { cachePreview(url, result.data); setPreview(result.data) }
      } catch {
        if (!cancelled) {
          const fb = { url, title: null, description: null, image: null, siteName: domain }
          cachePreview(url, fb); setPreview(fb)
        }
      }
      if (!cancelled) setLoading(false)
    }
    fetchPreview()
    return () => { cancelled = true }
  }, [url, domain])

  if (loading) {
    return (
      <div className="mt-1 inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-void-lighter border border-void-border text-xs">
        <span className="w-3 h-3 border border-text-muted border-t-neon-green rounded-full animate-spin" />
        <span className="text-text-muted font-mono">{domain}</span>
      </div>
    )
  }

  if (!preview || (!preview.title && !preview.description && !preview.image)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer"
        className="mt-1 inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-void-lighter border border-void-border hover:border-neon-cyan/30 transition-all text-xs max-w-md">
        <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`} alt="" className="w-4 h-4 rounded" />
        <span className="text-neon-cyan truncate">{domain}</span>
        <span className="text-text-muted">↗</span>
      </a>
    )
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="mt-2 block max-w-md rounded-lg overflow-hidden border border-void-border bg-void-light hover:border-neon-cyan/30 transition-all">
      {preview.image && <img src={preview.image} alt="" className="w-full max-h-48 object-cover" loading="lazy" />}
      <div className="px-3 py-2">
        <p className="text-xs text-text-muted font-mono mb-0.5">{preview.siteName || domain}</p>
        {preview.title && <p className="text-sm text-neon-cyan font-medium leading-snug line-clamp-2">{preview.title}</p>}
        {preview.description && <p className="text-xs text-text-secondary mt-1 line-clamp-2">{preview.description}</p>}
      </div>
    </a>
  )
}

/**
 * Render inline text with @mention highlights and clickable URLs.
 */
function renderInlineText(text) {
  const tokens = []
  let lastIndex = 0
  let match
  const regex = new RegExp(TOKEN_REGEX)

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>)
    }
    const token = match[0]
    if (token.startsWith('@')) {
      tokens.push(
        <span key={`m${match.index}`} className="text-neon-yellow font-semibold bg-neon-yellow/10 px-0.5 rounded">
          {token}
        </span>
      )
    } else {
      tokens.push(
        <a key={`u${match.index}`} href={token} target="_blank" rel="noopener noreferrer" className="text-neon-cyan hover:underline break-all">
          {token}
        </a>
      )
    }
    lastIndex = match.index + token.length
  }
  if (lastIndex < text.length) {
    tokens.push(<span key="end">{text.slice(lastIndex)}</span>)
  }
  return tokens.length > 0 ? tokens : [<span key="plain">{text}</span>]
}

const COLLAPSE_THRESHOLD = 400

export default function MessageContent({ text }) {
  const [expanded, setExpanded] = useState(false)
  if (!text) return null

  const isLong = text.length > COLLAPSE_THRESHOLD
  const displayText = isLong && !expanded ? text.slice(0, COLLAPSE_THRESHOLD) : text

  // extract URLs from full text for embeds
  const allUrls = []
  let urlMatch
  const urlRegex = new RegExp(URL_REGEX)
  while ((urlMatch = urlRegex.exec(text)) !== null) {
    allUrls.push(urlMatch[1])
  }

  const embeds = (expanded || !isLong) ? allUrls.map((url) => {
    const ytId = getYouTubeId(url)
    if (ytId) return <YouTubeEmbed key={url} videoId={ytId} url={url} />
    return <RichLinkPreview key={url} url={url} />
  }) : []

  return (
    <div>
      <span>{renderInlineText(displayText)}</span>
      {isLong && !expanded && <span className="text-text-muted">...</span>}
      {isLong && (
        <button onClick={() => setExpanded(!expanded)} className="block text-neon-cyan text-xs font-mono mt-1 hover:underline">
          {expanded ? 'show less' : 'show more'}
        </button>
      )}
      {embeds.length > 0 && <div className="space-y-1">{embeds}</div>}
    </div>
  )
}
