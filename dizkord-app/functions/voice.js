/**
 * Voice & Eve Cloud Functions: token generation, presence, transcripts, collection sync.
 */
import { onCall } from 'firebase-functions/v2/https'
import { HttpsError } from 'firebase-functions/v2/https'
import { adminDb, FieldValue, xaiApiKey, xaiManagementKey, verifyGroupMember } from './shared.js'

export const getGrokVoiceToken = onCall(
  { region: 'us-central1', cors: true },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'must be logged in')
    const apiKey = xaiApiKey.value()
    if (!apiKey) throw new HttpsError('failed-precondition', 'Grok API key not configured')

    const res = await fetch('https://api.x.ai/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expires_after: { seconds: 300 } }),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error('getGrokVoiceToken error:', res.status, err)
      throw new HttpsError('internal', 'failed to get voice token: ' + res.status)
    }

    const data = await res.json()
    console.log('getGrokVoiceToken: response keys:', Object.keys(data))
    const tokenValue = data.client_secret?.value || data.value
    const expiresAt = data.client_secret?.expires_at || data.expires_at
    if (!tokenValue) {
      console.error('getGrokVoiceToken: unexpected response:', JSON.stringify(data).slice(0, 500))
      throw new HttpsError('internal', 'xAI did not return a valid token')
    }
    console.log('getGrokVoiceToken: token issued, expires_at:', expiresAt)
    return { client_secret: { value: tokenValue, expires_at: expiresAt } }
  }
)

export const manageEvePresence = onCall(
  { region: 'us-central1', cors: true },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'must be logged in')
    const { groupId, channelId, action } = request.data
    if (!groupId || !action) throw new HttpsError('invalid-argument', 'groupId and action required')
    await verifyGroupMember(request.auth.uid, groupId)

    const metaRef = adminDb.doc(`groups/${groupId}/_meta/eve`)

    if (action === 'join') {
      if (!channelId) throw new HttpsError('invalid-argument', 'channelId required for join')
      const metaSnap = await metaRef.get()
      if (metaSnap.exists && metaSnap.data().active) {
        const existing = metaSnap.data()
        if (existing.channelId !== channelId) {
          throw new HttpsError('already-exists', 'Eve is already in another voice channel. Dismiss her first.')
        }
      }
      const presenceRef = adminDb.doc(`groups/${groupId}/channels/${channelId}/voicePresence/eve`)
      await presenceRef.set({
        uid: 'eve', displayName: 'Eve', photoURL: null, isBot: true,
        joinedAt: FieldValue.serverTimestamp(), summonedBy: request.auth.uid,
      })
      await metaRef.set({
        active: true, channelId, summonedBy: request.auth.uid,
        summonedAt: FieldValue.serverTimestamp(),
      })
      console.log('manageEvePresence: Eve joined', groupId.slice(0, 8), '/', channelId.slice(0, 8))
      return { ok: true }

    } else if (action === 'leave') {
      const metaSnap = await metaRef.get()
      if (metaSnap.exists) {
        const eveChannelId = metaSnap.data().channelId
        if (eveChannelId) {
          await adminDb.doc(`groups/${groupId}/channels/${eveChannelId}/voicePresence/eve`).delete().catch(() => {})
        }
      }
      await metaRef.delete().catch(() => {})
      console.log('manageEvePresence: Eve left', groupId.slice(0, 8))
      return { ok: true }

    } else {
      throw new HttpsError('invalid-argument', 'action must be "join" or "leave"')
    }
  }
)

export const saveEveTranscript = onCall(
  { region: 'us-central1', cors: true },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'must be logged in')
    const { groupId, text, entryCount } = request.data
    if (!groupId || !text) throw new HttpsError('invalid-argument', 'groupId and text required')
    await verifyGroupMember(request.auth.uid, groupId)

    await adminDb.collection(`groups/${groupId}/eveTranscripts`).add({
      text, summonedBy: request.auth.uid,
      createdAt: FieldValue.serverTimestamp(), synced: false, entryCount: entryCount || 0,
    })
    console.log('saveEveTranscript: saved for group', groupId.slice(0, 8), 'entries:', entryCount)
    return { ok: true }
  }
)

export const syncGroupToCollection = onCall(
  { region: 'us-central1', cors: true, timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'must be logged in')
    const { groupId } = request.data
    if (!groupId) throw new HttpsError('invalid-argument', 'groupId required')

    const apiKey = xaiApiKey.value()
    const mgmtKey = xaiManagementKey.value()
    if (!apiKey || !mgmtKey) throw new HttpsError('failed-precondition', 'API keys not configured')
    await verifyGroupMember(request.auth.uid, groupId)

    const groupDoc = await adminDb.doc(`groups/${groupId}`).get()
    if (!groupDoc.exists) throw new HttpsError('not-found', 'group not found')
    const groupData = groupDoc.data()
    const groupName = groupData.name || groupId.slice(0, 8)

    const syncRef = adminDb.doc(`groups/${groupId}/_meta/grokSync`)
    const syncSnap = await syncRef.get()
    let syncState = syncSnap.exists ? syncSnap.data() : {}

    let collectionId = syncState.collectionId
    if (!collectionId) {
      console.log('syncGroupToCollection: creating collection for group', groupId.slice(0, 8))
      const createRes = await fetch('https://management-api.x.ai/v1/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${mgmtKey}` },
        body: JSON.stringify({ collection_name: `DizKord: ${groupName}` }),
      })
      if (!createRes.ok) {
        const err = await createRes.text()
        console.error('syncGroupToCollection: collection create failed:', createRes.status, err)
        throw new HttpsError('internal', 'failed to create xAI collection')
      }
      const collData = await createRes.json()
      collectionId = collData.collection_id || collData.id
      if (!collectionId) {
        console.error('syncGroupToCollection: no collection_id in response:', JSON.stringify(collData).slice(0, 300))
        throw new HttpsError('internal', 'xAI did not return a collection ID')
      }
      syncState.collectionId = collectionId
      await syncRef.set({ collectionId, channels: {}, totalDocsSynced: 0 })
      console.log('syncGroupToCollection: created collection', collectionId)
    }

    const channelsSnap = await adminDb.collection(`groups/${groupId}/channels`).get()
    const textChannels = channelsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(ch => ch.type === 'text' || !ch.type)

    const channelCursors = syncState.channels || {}
    let totalNewDocs = 0
    const MAX_MESSAGES_PER_BATCH = 300

    for (const channel of textChannels) {
      let batchCursor = channelCursors[channel.id]?.lastSyncedAt || null
      let channelMsgTotal = 0
      while (true) {
        let query = adminDb
          .collection(`groups/${groupId}/channels/${channel.id}/messages`)
          .orderBy('createdAt', 'asc')
          .limit(MAX_MESSAGES_PER_BATCH)
        if (batchCursor) query = query.where('createdAt', '>', batchCursor)

        const messagesSnap = await query.get()
        if (messagesSnap.empty) break

        const messages = messagesSnap.docs.map(d => d.data())
        const firstTs = messages[0].createdAt?.toDate?.() || new Date()
        const lastTs = messages[messages.length - 1].createdAt?.toDate?.() || new Date()

        let text = `# DizKord Chat Log\n`
        text += `# Group: ${groupName} | Channel: #${channel.name || channel.id}\n`
        text += `# Date Range: ${firstTs.toISOString().slice(0, 10)} to ${lastTs.toISOString().slice(0, 10)}\n`
        text += `# Messages: ${messages.length}\n\n`
        for (const msg of messages) {
          const ts = msg.createdAt?.toDate?.()
          const timeStr = ts ? ts.toISOString().replace('T', ' ').slice(0, 19) : '?'
          const author = msg.displayName || msg.uid?.slice(0, 8) || 'unknown'
          let content = msg.text || ''
          if (msg.imageUrl) content += (content ? ' ' : '') + '[image]'
          if (msg.videoUrl) content += (content ? ' ' : '') + '[video]'
          if (msg.replyTo) content = `(reply) ${content}`
          if (!content) content = '[empty]'
          text += `[${timeStr}] ${author}: ${content}\n`
        }

        const batchLabel = channelMsgTotal > 0 ? `_part${Math.floor(channelMsgTotal / MAX_MESSAGES_PER_BATCH) + 1}` : ''
        const fileName = `${groupName}_${channel.name || channel.id}${batchLabel}_${firstTs.toISOString().slice(0, 10)}_to_${lastTs.toISOString().slice(0, 10)}.txt`
        const fileBlob = new Blob([text], { type: 'text/plain' })
        const formData = new FormData()
        formData.append('purpose', 'assistants')
        formData.append('file', fileBlob, fileName)

        const uploadRes = await fetch('https://api.x.ai/v1/files', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}` },
          body: formData,
        })
        if (!uploadRes.ok) {
          console.error('syncGroupToCollection: file upload failed for', channel.name, ':', uploadRes.status, await uploadRes.text())
          break
        }

        const uploadData = await uploadRes.json()
        const fileId = uploadData.id
        console.log('syncGroupToCollection: uploaded', fileName, '→', fileId)

        const addRes = await fetch(
          `https://management-api.x.ai/v1/collections/${collectionId}/documents/${fileId}`,
          { method: 'POST', headers: { 'Authorization': `Bearer ${mgmtKey}` } }
        )
        if (!addRes.ok) {
          console.error('syncGroupToCollection: add to collection failed:', addRes.status, await addRes.text())
          break
        }

        totalNewDocs++
        channelMsgTotal += messages.length
        batchCursor = messages[messages.length - 1].createdAt
        channelCursors[channel.id] = { lastSyncedAt: batchCursor }
        console.log('syncGroupToCollection: added', messages.length, 'msgs from #' + (channel.name || channel.id), channelMsgTotal > messages.length ? `(batch, ${channelMsgTotal} total)` : '')
        if (messages.length < MAX_MESSAGES_PER_BATCH) break
      }
    }

    const transcriptsSnap = await adminDb
      .collection(`groups/${groupId}/eveTranscripts`)
      .where('synced', '==', false)
      .limit(50)
      .get()

    const transcriptsFound = transcriptsSnap.size
    let transcriptsSynced = 0
    console.log('syncGroupToCollection: found', transcriptsFound, 'unsynced Eve transcripts')

    for (const tDoc of transcriptsSnap.docs) {
      const tData = tDoc.data()
      const tText = tData.text || ''
      if (!tText) { await tDoc.ref.update({ synced: true }); continue }

      const tBlob = new Blob([tText], { type: 'text/plain' })
      const tForm = new FormData()
      const tDate = tData.createdAt?.toDate?.()?.toISOString?.()?.slice(0, 10) || 'unknown'
      tForm.append('purpose', 'assistants')
      tForm.append('file', tBlob, `eve_transcript_${tDate}_${tDoc.id.slice(0, 8)}.txt`)

      const tUpload = await fetch('https://api.x.ai/v1/files', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: tForm,
      })
      if (!tUpload.ok) {
        console.error('syncGroupToCollection: transcript upload failed for', tDoc.id.slice(0, 8), ':', tUpload.status, await tUpload.text().catch(() => ''))
        continue
      }

      const { id: tFileId } = await tUpload.json()
      const tAdd = await fetch(
        `https://management-api.x.ai/v1/collections/${collectionId}/documents/${tFileId}`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${mgmtKey}` } }
      )
      if (tAdd.ok) {
        await tDoc.ref.update({ synced: true })
        totalNewDocs++
        transcriptsSynced++
        console.log('syncGroupToCollection: synced Eve transcript', tDoc.id.slice(0, 8))
      } else {
        console.error('syncGroupToCollection: add transcript to collection failed:', tAdd.status, await tAdd.text().catch(() => ''))
      }
    }

    if (transcriptsFound > 0) {
      console.log('syncGroupToCollection: transcripts', transcriptsSynced, '/', transcriptsFound, 'synced to collection')
    }

    await syncRef.set({
      collectionId, channels: channelCursors,
      totalDocsSynced: (syncState.totalDocsSynced || 0) + totalNewDocs,
      lastSyncAt: FieldValue.serverTimestamp(),
    }, { merge: true })

    console.log('syncGroupToCollection: done. group', groupId.slice(0, 8), 'synced', totalNewDocs, 'new docs (channels + transcripts)')
    return { collectionId, newDocsSynced: totalNewDocs, transcriptsSynced }
  }
)
