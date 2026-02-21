/**
 * Shared utilities and initialization for all Cloud Functions.
 */
import { HttpsError } from 'firebase-functions/v2/https'
import { defineString } from 'firebase-functions/params'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

initializeApp()
export const adminDb = getFirestore()
export const bucket = getStorage().bucket()
export { FieldValue }

export const xaiApiKey = defineString('XAI_API_KEY')
export const xaiManagementKey = defineString('XAI_MANAGEMENT_API_KEY')
export const cfTurnTokenId = defineString('CF_TURN_TOKEN_ID')
export const cfTurnApiToken = defineString('CF_TURN_API_TOKEN')

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export async function persistToStorage(url, path, contentType) {
  try {
    const response = await fetch(url)
    if (!response.ok) return url
    const arrayBuf = await response.arrayBuffer()
    const buffer = new Uint8Array(arrayBuf)
    const file = bucket.file(path)
    await file.save(buffer, { metadata: { contentType } })
    await file.makePublic()
    return `https://storage.googleapis.com/${bucket.name}/${path}`
  } catch (err) {
    console.error('persistToStorage failed:', err.message)
    return url
  }
}

export async function verifyGroupMember(uid, groupId) {
  try {
    const groupSnap = await adminDb.collection('groups').doc(groupId).get()
    if (!groupSnap.exists) {
      console.error('verifyGroupMember: group not found:', groupId, 'for uid:', uid)
      throw new HttpsError('not-found', 'group not found')
    }
    const data = groupSnap.data()
    const members = data.members || []
    console.log('verifyGroupMember: uid', uid, 'groupId', groupId, 'members:', JSON.stringify(members))
    if (!members.includes(uid)) {
      console.error('verifyGroupMember FAILED: uid', uid, 'not in members:', JSON.stringify(members), 'types:', members.map(m => typeof m))
      throw new HttpsError('permission-denied', 'not a member of this group')
    }
  } catch (err) {
    if (err instanceof HttpsError) throw err
    console.error('verifyGroupMember crashed:', err.message, err.stack)
    throw new HttpsError('internal', `membership check failed: ${err.message}`)
  }
}

export function isPrivateUrl(url) {
  try {
    const hostname = new URL(url).hostname
    if (/^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.|::1|fc|fd|fe80)/i.test(hostname)) return true
    if (hostname === 'metadata.google.internal' || hostname === '169.254.169.254') return true
    return false
  } catch { return true }
}
