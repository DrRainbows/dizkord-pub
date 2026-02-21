/**
 * Invite page Cloud Function: serves OG meta tags for link previews.
 */
import { onRequest } from 'firebase-functions/v2/https'
import { adminDb, escapeHtml } from './shared.js'

export const serveInvitePage = onRequest(
  { region: 'us-central1', cors: true },
  async (req, res) => {
    const segments = req.path.split('/').filter(Boolean)
    const groupId = segments[segments.length - 1] || ''
    const host = req.headers['x-forwarded-host'] || req.headers.host || req.hostname
    const protocol = req.headers['x-forwarded-proto'] || 'https'
    const origin = `${protocol}://${host}`

    if (!groupId) { res.redirect(origin); return }

    let title = 'join dizkord'
    let description = 'voice + text for the void'
    let image = `${origin}/icon-512.svg`

    try {
      const groupSnap = await adminDb.collection('groups').doc(groupId).get()
      if (groupSnap.exists) {
        const data = groupSnap.data()
        title = `join ${data.name} on dizkord`
        description = `${data.members?.length || 0} members // voice + text chat`
        if (data.icon) image = data.icon
      }
    } catch { /* use defaults */ }

    const appUrl = `${origin}/?invite=${groupId}`
    const safeTitle = escapeHtml(title)
    const safeDesc = escapeHtml(description)
    const safeImage = escapeHtml(image)
    const safeUrl = escapeHtml(appUrl)

    res.set('Content-Type', 'text/html')
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${safeTitle}</title>
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDesc}">
  <meta property="og:image" content="${safeImage}">
  <meta property="og:url" content="${safeUrl}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDesc}">
  <meta name="twitter:image" content="${safeImage}">
  <meta http-equiv="refresh" content="0;url=${safeUrl}">
</head>
<body style="background:#0a0a0f;color:#00ff88;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <p>redirecting to dizkord...</p>
</body>
</html>`)
  }
)
