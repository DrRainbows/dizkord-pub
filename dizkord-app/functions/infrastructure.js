/**
 * Infrastructure Cloud Functions: TURN credentials, link previews.
 */
import { onCall } from 'firebase-functions/v2/https'
import { HttpsError } from 'firebase-functions/v2/https'
import { parse } from 'node-html-parser'
import { cfTurnTokenId, cfTurnApiToken, isPrivateUrl } from './shared.js'

export const getTurnCredentials = onCall(
  { region: 'us-central1', cors: true },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'must be logged in')
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${cfTurnTokenId.value()}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfTurnApiToken.value()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 86400 }),
      }
    )
    if (!res.ok) {
      const err = await res.text()
      console.error('Cloudflare TURN error:', res.status, err)
      return { iceServers: [] }
    }
    const data = await res.json()
    return { iceServers: data.iceServers || [] }
  }
)

export const getLinkPreview = onCall(
  { region: 'us-central1', cors: true },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'must be logged in')
    const { url } = request.data
    if (!url || typeof url !== 'string') throw new HttpsError('invalid-argument', 'url required')
    let parsed
    try { parsed = new URL(url) } catch { throw new HttpsError('invalid-argument', 'invalid url') }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new HttpsError('invalid-argument', 'http/https only')
    if (isPrivateUrl(url)) throw new HttpsError('permission-denied', 'private URLs blocked')
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DizKordBot/1.0)', 'Accept': 'text/html' },
        signal: controller.signal, redirect: 'follow',
      })
      clearTimeout(timeout)
      if (!res.ok) return { url, title: null, description: null, image: null, siteName: null }
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('text/html')) return { url, title: null, description: null, image: null, siteName: null }
      const reader = res.body.getReader()
      let chunks = [], totalBytes = 0
      const MAX_BYTES = 50000
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value); totalBytes += value.length
        if (totalBytes >= MAX_BYTES) break
      }
      reader.cancel()
      const merged = new Uint8Array(totalBytes)
      let offset = 0
      for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length }
      const html = new TextDecoder().decode(merged).slice(0, MAX_BYTES)
      const root = parse(html)
      const getMeta = (property) => {
        const el = root.querySelector(`meta[property="${property}"]`) || root.querySelector(`meta[name="${property}"]`)
        return el?.getAttribute('content') || null
      }
      let image = getMeta('og:image') || null
      if (image && !image.startsWith('http')) { try { image = new URL(image, url).href } catch { image = null } }
      return {
        url,
        title: getMeta('og:title') || root.querySelector('title')?.text || null,
        description: getMeta('og:description') || getMeta('description') || null,
        image,
        siteName: getMeta('og:site_name') || parsed.hostname.replace('www.', ''),
      }
    } catch (err) {
      console.error('link preview failed:', err.message)
      return { url, title: null, description: null, image: null, siteName: null }
    }
  }
)
