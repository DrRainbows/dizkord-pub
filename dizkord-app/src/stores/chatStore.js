import { create } from 'zustand'
import {
  collection, doc, addDoc, getDoc, getDocs, setDoc, deleteDoc,
  onSnapshot, query, orderBy, limit, where,
  serverTimestamp, updateDoc, arrayUnion, arrayRemove
} from 'firebase/firestore'
import { db, auth } from '../config/firebase'
import { getFunctions, httpsCallable } from 'firebase/functions'

export const useChatStore = create((set, get) => ({
  groups: [],
  activeGroup: null,
  activeChannel: null,
  messages: [],
  dms: [],
  activeDM: null,
  dmMessages: [],
  channels: [],
  unsubChannels: null,
  unsubMessages: null,
  unsubDMMessages: null,
  unsubGroups: null,
  unsubDMs: null,

  // --- GROUPS ---
  listenGroups: () => {
    const uid = auth.currentUser?.uid
    if (!uid) return
    // clean up previous listener if any
    const prev = get().unsubGroups
    if (prev) prev()
    const q = query(collection(db, 'groups'), where('members', 'array-contains', uid))
    const unsub = onSnapshot(q, (snap) => {
      const groups = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      // sync activeGroup if it was updated (keeps theme, icon, etc. reactive)
      const activeId = get().activeGroup?.id
      const updates = { groups }
      if (activeId) {
        const fresh = groups.find(g => g.id === activeId)
        if (fresh) updates.activeGroup = fresh
      }
      set(updates)
    })
    set({ unsubGroups: unsub })
    return unsub
  },

  createGroup: async (name) => {
    const uid = auth.currentUser?.uid
    const ref = await addDoc(collection(db, 'groups'), {
      name,
      owner: uid,
      members: [uid],
      createdAt: serverTimestamp(),
      icon: null,
    })
    // create default channels
    await addDoc(collection(db, 'groups', ref.id, 'channels'), {
      name: 'general',
      type: 'text',
      createdAt: serverTimestamp(),
    })
    await addDoc(collection(db, 'groups', ref.id, 'channels'), {
      name: 'voice-chat',
      type: 'voice',
      createdAt: serverTimestamp(),
    })
    return ref.id
  },

  joinGroup: async (groupId) => {
    const uid = auth.currentUser?.uid
    await updateDoc(doc(db, 'groups', groupId), {
      members: arrayUnion(uid),
    })
  },

  setActiveGroup: (group) => {
    const { unsubChannels } = get()
    if (unsubChannels) unsubChannels()
    set({ activeGroup: group, activeChannel: null, channels: [] })
    if (!group) return
    // listen to channels for this group (reactive for sidebar)
    const unsub = onSnapshot(
      query(collection(db, 'groups', group.id, 'channels'), orderBy('createdAt')),
      (snap) => {
        const channels = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        // sync activeChannel if it was updated (keeps topic reactive)
        const activeId = get().activeChannel?.id
        const updates = { channels }
        if (activeId) {
          const fresh = channels.find(c => c.id === activeId)
          if (fresh) updates.activeChannel = fresh
        }
        set(updates)
      }
    )
    set({ unsubChannels: unsub })
  },

  // --- CHANNELS ---
  createChannel: async (name, type = 'text', category = null, meta = {}) => {
    const groupId = get().activeGroup?.id
    if (!groupId) return
    await addDoc(collection(db, 'groups', groupId, 'channels'), {
      name,
      type,
      category,
      topic: null,
      createdAt: serverTimestamp(),
      ...meta,
    })
  },

  setChannelTopic: async (channelId, topic) => {
    const groupId = get().activeGroup?.id
    if (!groupId) return
    await updateDoc(doc(db, 'groups', groupId, 'channels', channelId), { topic })
  },

  // --- PINNED MESSAGES ---
  togglePinMessage: async (messageId) => {
    const { activeGroup, activeChannel } = get()
    if (!activeGroup || !activeChannel) return
    const msg = get().messages.find(m => m.id === messageId)
    if (!msg) return
    const msgRef = doc(db, 'groups', activeGroup.id, 'channels', activeChannel.id, 'messages', messageId)
    await updateDoc(msgRef, { pinned: !msg.pinned })
  },

  // mark a channel as read (localStorage, no Firestore cost)
  // uses last message's server timestamp when available to avoid client clock skew
  markChannelRead: (channelId) => {
    if (!channelId) return
    const msgs = get().messages
    const lastMsg = msgs[msgs.length - 1]
    const ts = lastMsg?.createdAt?.toMillis?.() || lastMsg?.createdAt?.seconds * 1000 || Date.now()
    const reads = JSON.parse(localStorage.getItem('dizkord_reads') || '{}')
    reads[channelId] = ts
    localStorage.setItem('dizkord_reads', JSON.stringify(reads))
  },

  setActiveChannel: (channel) => {
    const { unsubMessages, activeChannel: prevChannel } = get()
    // clean up typing indicator for the channel we're leaving
    get().stopTyping()
    set({ _lastTypingWrite: 0 })
    if (unsubMessages) unsubMessages()
    if (prevChannel?.id) get().markChannelRead(prevChannel.id)
    set({ activeChannel: channel, messages: [] })
    if (channel?.id) get().markChannelRead(channel.id)
    if (!channel || channel.type !== 'text') return

    const groupId = get().activeGroup?.id
    if (!groupId) return

    const q = query(
      collection(db, 'groups', groupId, 'channels', channel.id, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(100)
    )
    const unsub = onSnapshot(q, (snap) => {
      const messages = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      set({ messages })
    })
    set({ unsubMessages: unsub })
  },

  // fetch member profiles for a group (for @mention autocomplete)
  groupMembers: [],
  loadGroupMembers: async (groupId) => {
    if (!groupId) return
    const groupSnap = await getDoc(doc(db, 'groups', groupId))
    if (!groupSnap.exists()) return
    const memberUids = groupSnap.data().members || []
    const results = await Promise.allSettled(
      memberUids.map(uid => getDoc(doc(db, 'users', uid)).then(snap => snap.exists() ? { uid, ...snap.data() } : null))
    )
    const profiles = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value)
    set({ groupMembers: profiles })
  },

  sendMessage: async (text, replyTo = null) => {
    const { activeGroup, activeChannel, groupMembers } = get()
    if (!activeGroup || !activeChannel) return
    const user = auth.currentUser

    // extract @mentions from text
    const mentions = []
    const mentionRegex = /@(\w+)/g
    let m
    while ((m = mentionRegex.exec(text)) !== null) {
      const name = m[1].toLowerCase()
      const member = groupMembers.find(p => p.displayName?.toLowerCase() === name)
      if (member && !mentions.includes(member.uid)) {
        mentions.push(member.uid)
      }
    }

    const msgData = {
      text,
      uid: user.uid,
      displayName: user.displayName || 'anon',
      photoURL: user.photoURL || null,
      mentions: mentions.length > 0 ? mentions : null,
      createdAt: serverTimestamp(),
    }

    // include reply reference if replying to a message
    if (replyTo) {
      msgData.replyTo = {
        id: replyTo.id,
        text: replyTo.text,
        displayName: replyTo.displayName,
        imageURL: replyTo.imageURL || null,
      }
    }

    await addDoc(
      collection(db, 'groups', activeGroup.id, 'channels', activeChannel.id, 'messages'),
      msgData
    )
    get().stopTyping()

    // handle @grok commands asynchronously
    if (text.toLowerCase().startsWith('@grok')) {
      get()._handleGrokCommand(text, replyTo)
    }
  },

  // @grok commands - Cloud Functions write bot messages server-side via Admin SDK
  _handleGrokCommand: async (text, replyTo = null) => {
    const { activeGroup, activeChannel } = get()
    if (!activeGroup || !activeChannel) return

    const lowerText = text.toLowerCase()

    try {
      const functions = getFunctions()

      if (lowerText.startsWith('@grok imagine ')) {
        const prompt = text.slice('@grok imagine '.length).trim()
        if (!prompt) return
        // if replying to a message with an image, use image edit endpoint
        if (replyTo?.imageURL) {
          const grokImageEdit = httpsCallable(functions, 'grokImageEdit', { timeout: 60000 })
          await grokImageEdit({ prompt, sourceImageURL: replyTo.imageURL, groupId: activeGroup.id, channelId: activeChannel.id })
        } else {
          const grokImagine = httpsCallable(functions, 'grokImagine', { timeout: 60000 })
          await grokImagine({ prompt, groupId: activeGroup.id, channelId: activeChannel.id })
        }
      } else if (lowerText.startsWith('@grok video ')) {
        const prompt = text.slice('@grok video '.length).trim()
        if (!prompt) return
        // if replying to a message with an image, use video edit endpoint
        if (replyTo?.imageURL) {
          const grokVideoEdit = httpsCallable(functions, 'grokVideoEdit', { timeout: 300000 })
          await grokVideoEdit({ prompt, sourceImageURL: replyTo.imageURL, groupId: activeGroup.id, channelId: activeChannel.id })
        } else {
          const grokVideo = httpsCallable(functions, 'grokVideo', { timeout: 300000 })
          await grokVideo({ prompt, groupId: activeGroup.id, channelId: activeChannel.id })
        }
      } else {
        const prompt = text.slice('@grok'.length).trim()
        if (!prompt) return
        const grokChat = httpsCallable(functions, 'grokChat', { timeout: 30000 })
        await grokChat({ prompt, groupId: activeGroup.id, channelId: activeChannel.id })
      }
    } catch (err) {
      console.error('@grok command failed:', err.message)
      // surface error to user by writing a local-only error message
      const errMsg = err?.message || 'unknown error'
      set(prev => ({
        messages: [...prev.messages, {
          id: `grok-error-${Date.now()}`,
          text: `@grok command failed: ${errMsg}`,
          uid: 'system',
          displayName: 'grok',
          photoURL: null,
          createdAt: { toDate: () => new Date() },
          _local: true,
        }]
      }))
    }
  },

  // send image message (URL from Firebase Storage)
  sendImageMessage: async (imageURL) => {
    const { activeGroup, activeChannel } = get()
    if (!activeGroup || !activeChannel) return
    const user = auth.currentUser
    await addDoc(
      collection(db, 'groups', activeGroup.id, 'channels', activeChannel.id, 'messages'),
      {
        text: '',
        imageURL,
        uid: user.uid,
        displayName: user.displayName || 'anon',
        photoURL: user.photoURL || null,
        createdAt: serverTimestamp(),
      }
    )
  },

  editMessage: async (messageId, newText) => {
    const { activeGroup, activeChannel } = get()
    if (!activeGroup || !activeChannel) return
    const uid = auth.currentUser?.uid
    if (!uid) return
    const msgRef = doc(db, 'groups', activeGroup.id, 'channels', activeChannel.id, 'messages', messageId)
    await updateDoc(msgRef, { text: newText, editedAt: serverTimestamp() })
  },

  deleteMessage: async (messageId) => {
    const { activeGroup, activeChannel } = get()
    if (!activeGroup || !activeChannel) return
    const uid = auth.currentUser?.uid
    if (!uid) return
    const msgRef = doc(db, 'groups', activeGroup.id, 'channels', activeChannel.id, 'messages', messageId)
    await deleteDoc(msgRef)
  },

  // --- REACTIONS ---
  toggleReaction: async (messageId, emoji) => {
    const { activeGroup, activeChannel } = get()
    if (!activeGroup || !activeChannel) return
    const uid = auth.currentUser?.uid
    if (!uid) return
    const msgRef = doc(db, 'groups', activeGroup.id, 'channels', activeChannel.id, 'messages', messageId)
    // check if user already reacted with this emoji
    const msg = get().messages.find(m => m.id === messageId)
    const existing = msg?.reactions?.[emoji] || []
    if (existing.includes(uid)) {
      // remove reaction
      await updateDoc(msgRef, { [`reactions.${emoji}`]: arrayRemove(uid) })
    } else {
      // add reaction
      await updateDoc(msgRef, { [`reactions.${emoji}`]: arrayUnion(uid) })
    }
  },

  // --- TYPING INDICATORS ---
  _lastTypingWrite: 0,
  _typingGroupId: null,
  _typingChannelId: null,
  startTyping: () => {
    const now = Date.now()
    // debounce: skip if we wrote less than 2 seconds ago (audit fix 2A)
    if (now - get()._lastTypingWrite < 2000) return
    const { activeGroup, activeChannel } = get()
    if (!activeGroup || !activeChannel || activeChannel.type !== 'text') return
    const user = auth.currentUser
    if (!user) return
    // track which channel we wrote to so stopTyping cleans up the right one
    set({ _lastTypingWrite: now, _typingGroupId: activeGroup.id, _typingChannelId: activeChannel.id })
    const typingRef = doc(db, 'groups', activeGroup.id, 'channels', activeChannel.id, 'typing', user.uid)
    setDoc(typingRef, {
      displayName: user.displayName || 'anon',
      timestamp: serverTimestamp(),
    }).catch(e => console.warn('[chat] typing start failed:', e.message))
  },

  stopTyping: () => {
    const { _typingGroupId, _typingChannelId } = get()
    if (!_typingGroupId || !_typingChannelId) return
    const user = auth.currentUser
    if (!user) return
    const typingRef = doc(db, 'groups', _typingGroupId, 'channels', _typingChannelId, 'typing', user.uid)
    deleteDoc(typingRef).catch(e => console.warn('[chat] typing stop failed:', e.message))
    set({ _typingGroupId: null, _typingChannelId: null })
  },

  // --- DMs ---
  listenDMs: () => {
    const uid = auth.currentUser?.uid
    if (!uid) return
    // clean up previous listener if any
    const prev = get().unsubDMs
    if (prev) prev()
    const q = query(collection(db, 'dms'), where('participants', 'array-contains', uid))
    const unsub = onSnapshot(q, (snap) => {
      const dms = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      set({ dms })
    })
    set({ unsubDMs: unsub })
    return unsub
  },

  startDM: async (otherUid) => {
    const uid = auth.currentUser?.uid
    const myName = auth.currentUser?.displayName || 'anon'
    // check if dm already exists
    const q = query(collection(db, 'dms'), where('participants', 'array-contains', uid))
    const snap = await getDocs(q)
    const existing = snap.docs.find(d => d.data().participants.includes(otherUid))
    if (existing) {
      set({ activeDM: { id: existing.id, ...existing.data() } })
      return existing.id
    }
    // fetch other user's name for the DM label
    let otherName = 'anon'
    try {
      const otherDoc = await getDoc(doc(db, 'users', otherUid))
      if (otherDoc.exists()) otherName = otherDoc.data().displayName || 'anon'
    } catch { /* fallback to anon */ }
    const participantNames = { [uid]: myName, [otherUid]: otherName }
    const dmRef = await addDoc(collection(db, 'dms'), {
      participants: [uid, otherUid],
      participantNames,
      createdAt: serverTimestamp(),
    })
    set({ activeDM: { id: dmRef.id, participants: [uid, otherUid], participantNames } })
    return dmRef.id
  },

  setActiveDM: (dm) => {
    const { unsubDMMessages } = get()
    if (unsubDMMessages) unsubDMMessages()
    set({ activeDM: dm, dmMessages: [] })
    if (!dm) return
    const q = query(
      collection(db, 'dms', dm.id, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(100)
    )
    const unsub = onSnapshot(q, (snap) => {
      const dmMessages = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      set({ dmMessages })
    })
    set({ unsubDMMessages: unsub })
  },

  sendDM: async (text) => {
    const { activeDM } = get()
    if (!activeDM) return
    const user = auth.currentUser
    await addDoc(collection(db, 'dms', activeDM.id, 'messages'), {
      text,
      uid: user.uid,
      displayName: user.displayName || 'anon',
      photoURL: user.photoURL || null,
      createdAt: serverTimestamp(),
    })
  },
}))
