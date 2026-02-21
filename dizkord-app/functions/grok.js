/**
 * Grok AI Cloud Functions: chat, imagine, image edit, video, video edit, theme.
 */
import { onCall } from 'firebase-functions/v2/https'
import { HttpsError } from 'firebase-functions/v2/https'
import { adminDb, FieldValue, xaiApiKey, persistToStorage, verifyGroupMember } from './shared.js'

export const grokChat = onCall(
  { region: 'us-central1', cors: true, timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'must be logged in')
    const { prompt, context, groupId, channelId } = request.data
    if (!prompt) throw new HttpsError('invalid-argument', 'prompt required')
    if (!groupId || !channelId) throw new HttpsError('invalid-argument', 'groupId and channelId required')
    await verifyGroupMember(request.auth.uid, groupId)

    const apiKey = xaiApiKey.value()
    if (!apiKey) throw new HttpsError('failed-precondition', 'Grok API key not configured')

    const messages = [{
      role: 'system',
      content: 'You are Grok, an AI assistant in a Discord-like group chat called DizKord. Keep responses concise, conversational, and match the gen Z vibe. You can use web search and X search when needed. You have personality - be funny, be real, don\'t be cringe.',
    }]
    if (context && Array.isArray(context)) {
      for (const msg of context.slice(-10)) {
        messages.push({ role: 'user', content: `${msg.displayName}: ${msg.text}` })
      }
    }
    messages.push({ role: 'user', content: prompt })

    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'grok-4-1-fast-non-reasoning', messages, tools: [{ type: 'web_search' }, { type: 'x_search' }] }),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error('Grok API error:', res.status, err)
      throw new HttpsError('internal', `Grok API ${res.status}: ${err.slice(0, 200)}`)
    }

    const data = await res.json()
    const reply = data.choices?.[0]?.message?.content || 'no response'

    await adminDb.collection('groups').doc(groupId)
      .collection('channels').doc(channelId)
      .collection('messages').add({
        text: reply, uid: 'grok-bot', displayName: 'grok', photoURL: null,
        createdAt: FieldValue.serverTimestamp(),
      })
    return { text: reply }
  }
)

export const grokImagine = onCall(
  { region: 'us-central1', cors: true, timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'must be logged in')
    const { prompt, groupId, channelId } = request.data
    if (!prompt) throw new HttpsError('invalid-argument', 'prompt required')
    if (!groupId || !channelId) throw new HttpsError('invalid-argument', 'groupId and channelId required')
    await verifyGroupMember(request.auth.uid, groupId)

    const apiKey = xaiApiKey.value()
    if (!apiKey) throw new HttpsError('failed-precondition', 'Grok API key not configured')

    const thinkingRef = await adminDb.collection('groups').doc(groupId)
      .collection('channels').doc(channelId)
      .collection('messages').add({
        text: `🎨 generating: "${prompt}"...`, uid: 'grok-bot', displayName: 'grok', photoURL: null,
        createdAt: FieldValue.serverTimestamp(),
      })

    const res = await fetch('https://api.x.ai/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'grok-imagine-image', prompt, n: 1 }),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error('Grok Imagine error:', err)
      await thinkingRef.update({ text: `⚠️ image generation failed` })
      throw new HttpsError('internal', 'image generation failed')
    }

    const data = await res.json()
    let imageUrl = data.data?.[0]?.url || null
    if (imageUrl) {
      const storagePath = `groups/${groupId}/grok-images/${Date.now()}.jpg`
      imageUrl = await persistToStorage(imageUrl, storagePath, 'image/jpeg')
      await thinkingRef.update({ text: `🎨 "${prompt}"`, imageURL: imageUrl })
    } else {
      await thinkingRef.update({ text: `⚠️ no image returned` })
    }
    return { imageUrl }
  }
)

export const grokImageEdit = onCall(
  { region: 'us-central1', cors: true, timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'must be logged in')
    const { prompt, sourceImageURL, groupId, channelId } = request.data
    if (!prompt) throw new HttpsError('invalid-argument', 'prompt required')
    if (!sourceImageURL) throw new HttpsError('invalid-argument', 'sourceImageURL required')
    if (!groupId || !channelId) throw new HttpsError('invalid-argument', 'groupId and channelId required')
    await verifyGroupMember(request.auth.uid, groupId)

    const apiKey = xaiApiKey.value()
    if (!apiKey) throw new HttpsError('failed-precondition', 'Grok API key not configured')

    const statusRef = await adminDb.collection('groups').doc(groupId)
      .collection('channels').doc(channelId)
      .collection('messages').add({
        text: `🎨 editing image: "${prompt}"...`, uid: 'grok-bot', displayName: 'grok', photoURL: null,
        createdAt: FieldValue.serverTimestamp(),
      })

    const res = await fetch('https://api.x.ai/v1/images/edits', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'grok-imagine-image', prompt, image_url: sourceImageURL }),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error('Grok Image Edit error:', err)
      await statusRef.update({ text: `⚠️ image editing failed` })
      throw new HttpsError('internal', 'image editing failed')
    }

    const data = await res.json()
    let imageUrl = data.data?.[0]?.url || null
    if (imageUrl) {
      const storagePath = `groups/${groupId}/grok-images/${Date.now()}-edit.jpg`
      imageUrl = await persistToStorage(imageUrl, storagePath, 'image/jpeg')
      await statusRef.update({ text: `🎨 "${prompt}"`, imageURL: imageUrl })
    } else {
      await statusRef.update({ text: `⚠️ no edited image returned` })
    }
    return { imageUrl }
  }
)

/**
 * Poll a video generation request until done, with comprehensive fallback URL extraction.
 * Shared by grokVideo and grokVideoEdit.
 */
async function pollVideoGeneration(requestId, apiKey, label) {
  let videoUrl = null
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000))
    let pollRes
    try {
      pollRes = await fetch(`https://api.x.ai/v1/videos/${requestId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      })
    } catch (fetchErr) {
      console.log(`${label}: poll ${i} fetch error:`, fetchErr.message)
      continue
    }
    if (!pollRes.ok) {
      const errBody = await pollRes.text().catch(() => '')
      console.log(`${label}: poll ${i} HTTP ${pollRes.status}`, errBody.slice(0, 200))
      continue
    }
    let pollData
    try { pollData = await pollRes.json() } catch {
      console.log(`${label}: poll ${i} JSON parse failed`)
      continue
    }
    const st = pollData.status
    if (st !== 'pending' && st !== 'done') {
      console.log(`${label}: poll ${i} full response:`, JSON.stringify(pollData).slice(0, 800))
    } else {
      console.log(`${label}: poll ${i} status:`, st)
    }
    if (st === 'done' && pollData.video?.url) {
      videoUrl = pollData.video.url
      console.log(`${label}: done, url length: ${videoUrl.length}`)
      break
    }
    if (!st && pollData.video?.url) {
      videoUrl = pollData.video.url
      console.log(`${label}: found video URL without status field, url length: ${videoUrl.length}`)
      break
    }
    if (pollData.result?.video?.url) {
      videoUrl = pollData.result.video.url
      console.log(`${label}: found video in result wrapper, url length: ${videoUrl.length}`)
      break
    }
    if (st === 'expired' || st === 'failed') {
      console.log(`${label}: generation ended: ${st}`)
      break
    }
  }
  return videoUrl
}

export const grokVideo = onCall(
  { region: 'us-central1', cors: true, timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'must be logged in')
    const { prompt, groupId, channelId } = request.data
    if (!prompt) throw new HttpsError('invalid-argument', 'prompt required')
    if (!groupId || !channelId) throw new HttpsError('invalid-argument', 'groupId and channelId required')
    await verifyGroupMember(request.auth.uid, groupId)

    const apiKey = xaiApiKey.value()
    if (!apiKey) throw new HttpsError('failed-precondition', 'Grok API key not configured')

    const statusRef = await adminDb.collection('groups').doc(groupId)
      .collection('channels').doc(channelId)
      .collection('messages').add({
        text: `🎬 generating video: "${prompt}"...`, uid: 'grok-bot', displayName: 'grok', photoURL: null,
        createdAt: FieldValue.serverTimestamp(),
      })

    console.log('grokVideo: starting generation, prompt:', prompt.slice(0, 80))
    const startRes = await fetch('https://api.x.ai/v1/videos/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'grok-imagine-video', prompt, duration: 10, resolution: '720p' }),
    })
    if (!startRes.ok) {
      const errBody = await startRes.text()
      console.error('grokVideo: start failed', startRes.status, errBody)
      await statusRef.update({ text: `⚠️ video generation failed to start` })
      throw new HttpsError('internal', 'video generation failed: ' + startRes.status)
    }

    const startData = await startRes.json()
    const requestId = startData.request_id
    console.log('grokVideo: request_id =', requestId)
    if (!requestId) {
      console.error('grokVideo: no request_id in response:', JSON.stringify(startData))
      await statusRef.update({ text: '⚠️ video generation failed (no request ID)' })
      throw new HttpsError('internal', 'no request ID returned')
    }

    let videoUrl = await pollVideoGeneration(requestId, apiKey, 'grokVideo')

    if (videoUrl) {
      const storagePath = `groups/${groupId}/grok-videos/${Date.now()}.mp4`
      console.log('grokVideo: persisting to storage...')
      videoUrl = await persistToStorage(videoUrl, storagePath, 'video/mp4')
      await statusRef.update({ text: `🎬 "${prompt}"`, videoURL: videoUrl })
      console.log('grokVideo: complete, message updated with video')
    } else {
      await statusRef.update({ text: `⚠️ video generation timed out or failed` })
      console.log('grokVideo: timed out or failed after polling')
    }
    return { videoUrl }
  }
)

export const grokVideoEdit = onCall(
  { region: 'us-central1', cors: true, timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'must be logged in')
    const { prompt, sourceImageURL, groupId, channelId } = request.data
    if (!prompt) throw new HttpsError('invalid-argument', 'prompt required')
    if (!sourceImageURL) throw new HttpsError('invalid-argument', 'sourceImageURL required')
    if (!groupId || !channelId) throw new HttpsError('invalid-argument', 'groupId and channelId required')
    await verifyGroupMember(request.auth.uid, groupId)

    const apiKey = xaiApiKey.value()
    if (!apiKey) throw new HttpsError('failed-precondition', 'Grok API key not configured')

    const statusRef = await adminDb.collection('groups').doc(groupId)
      .collection('channels').doc(channelId)
      .collection('messages').add({
        text: `🎬 generating video from image: "${prompt}"...`, uid: 'grok-bot', displayName: 'grok', photoURL: null,
        createdAt: FieldValue.serverTimestamp(),
      })

    console.log('grokVideoEdit: starting generation, prompt:', prompt.slice(0, 80))
    const startRes = await fetch('https://api.x.ai/v1/videos/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'grok-imagine-video', prompt, image: { url: sourceImageURL }, duration: 10, resolution: '720p' }),
    })
    if (!startRes.ok) {
      const err = await startRes.text()
      console.error('grokVideoEdit: start failed', startRes.status, err)
      await statusRef.update({ text: `⚠️ video generation from image failed to start` })
      throw new HttpsError('internal', 'video edit generation failed')
    }

    const startData = await startRes.json()
    const requestId = startData.request_id
    console.log('grokVideoEdit: request_id =', requestId)
    if (!requestId) {
      console.error('grokVideoEdit: no request_id in response:', JSON.stringify(startData))
      await statusRef.update({ text: '⚠️ video edit failed (no request ID)' })
      throw new HttpsError('internal', 'no request ID returned')
    }

    let videoUrl = await pollVideoGeneration(requestId, apiKey, 'grokVideoEdit')

    if (videoUrl) {
      const storagePath = `groups/${groupId}/grok-videos/${Date.now()}-edit.mp4`
      console.log('grokVideoEdit: persisting to storage...')
      videoUrl = await persistToStorage(videoUrl, storagePath, 'video/mp4')
      await statusRef.update({ text: `🎬 "${prompt}"`, videoURL: videoUrl })
      console.log('grokVideoEdit: complete, message updated with video')
    } else {
      await statusRef.update({ text: `⚠️ video generation from image timed out or failed` })
      console.log('grokVideoEdit: timed out or failed after polling')
    }
    return { videoUrl }
  }
)

export const grokTheme = onCall(
  { region: 'us-central1', cors: true, timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'must be logged in')
    const { description, groupId } = request.data
    if (!description) throw new HttpsError('invalid-argument', 'description required')
    if (!groupId) throw new HttpsError('invalid-argument', 'groupId required')
    await verifyGroupMember(request.auth.uid, groupId)

    const apiKey = xaiApiKey.value()
    if (!apiKey) throw new HttpsError('failed-precondition', 'Grok API key not configured')

    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'grok-4-1-fast-non-reasoning',
        messages: [
          {
            role: 'system',
            content: `You generate color themes for a Discord-like chat app. Given a description, output ONLY a JSON object with these exact keys and hex color values:
{"bg":"#hex","bgLight":"#hex","bgLighter":"#hex","border":"#hex","accent":"#hex","accentAlt":"#hex","text":"#hex","textMuted":"#hex"}
bg = darkest background, bgLight = sidebar, bgLighter = hover, border = borders, accent = primary accent (like buttons), accentAlt = secondary accent, text = primary text, textMuted = muted text.
Output ONLY the JSON, no markdown, no explanation.`,
          },
          { role: 'user', content: description },
        ],
      }),
    })
    if (!res.ok) throw new HttpsError('internal', 'theme generation failed')

    const data = await res.json()
    const raw = data.choices?.[0]?.message?.content || ''
    let theme
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      theme = jsonMatch ? JSON.parse(jsonMatch[0]) : null
    } catch { theme = null }
    if (!theme) throw new HttpsError('internal', 'failed to parse theme')

    const validKeys = ['bg', 'bgLight', 'bgLighter', 'border', 'accent', 'accentAlt', 'text', 'textMuted']
    const hexRegex = /^#[0-9a-fA-F]{3,8}$/
    const validated = {}
    for (const key of validKeys) {
      if (theme[key] && hexRegex.test(theme[key])) validated[key] = theme[key]
    }
    if (Object.keys(validated).length === 0) throw new HttpsError('internal', 'no valid colors in theme')

    await adminDb.collection('groups').doc(groupId).update({ theme: validated })
    return { theme }
  }
)
