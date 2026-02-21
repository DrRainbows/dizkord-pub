import { create } from 'zustand'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged,
} from 'firebase/auth'
import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../config/firebase'

export const useAuthStore = create((set, get) => ({
  user: null,
  userProfile: null,
  loading: true,
  error: null,

  init: () => {
    return onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const profile = await get().fetchProfile(user.uid)
          set({ user, userProfile: profile, loading: false })
          get().startPresence(user.uid)
        } catch (err) {
          console.error('profile fetch failed:', err.message)
          // still unblock the app with null profile
          set({ user, userProfile: null, loading: false })
          get().startPresence(user.uid)
        }
      } else {
        set({ user: null, userProfile: null, loading: false })
      }
    })
  },

  // --- PRESENCE (join/leave only, no heartbeat) ---
  startPresence: (uid) => {
    // set online on login
    updateDoc(doc(db, 'users', uid), {
      status: 'online',
      lastSeen: serverTimestamp(),
    }).catch(e => console.warn('[auth] online status write failed:', e.message))

    // set offline on tab close
    const handleUnload = () => {
      updateDoc(doc(db, 'users', uid), { status: 'offline', lastSeen: serverTimestamp() })
        .catch(e => console.warn('[auth] unload offline write failed:', e.message))
    }
    window.addEventListener('beforeunload', handleUnload)

    set({
      _presenceCleanup: () => {
        window.removeEventListener('beforeunload', handleUnload)
        updateDoc(doc(db, 'users', uid), { status: 'offline', lastSeen: serverTimestamp() })
          .catch(e => console.warn('[auth] logout offline write failed:', e.message))
      }
    })
  },

  fetchProfile: async (uid) => {
    const snap = await getDoc(doc(db, 'users', uid))
    return snap.exists() ? { id: snap.id, ...snap.data() } : null
  },

  login: async (email, password) => {
    set({ error: null })
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (e) {
      set({ error: e.message })
      throw e
    }
  },

  register: async (email, password, displayName) => {
    set({ error: null })
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      await updateProfile(cred.user, { displayName })
      await setDoc(doc(db, 'users', cred.user.uid), {
        displayName,
        email,
        photoURL: null,
        status: 'online',
        createdAt: serverTimestamp(),
        settings: {
          theme: 'void',
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
          notificationSounds: true,
        },
      })
    } catch (e) {
      set({ error: e.message })
      throw e
    }
  },

  logout: async () => {
    // cleanup is best-effort; signOut MUST run regardless of cleanup failures
    try {
      const voiceMod = await import('./voiceStore')
      const voiceState = voiceMod.useVoiceStore.getState()
      if (voiceState.inVoice) {
        const webrtcMod = await import('../services/webrtc')
        webrtcMod.stopVoice()
        await voiceState.leaveVoiceChannel().catch(() => {})
      }
    } catch (err) { console.error('voice cleanup on logout failed:', err) }

    try {
      const chatMod = await import('./chatStore')
      const chatState = chatMod.useChatStore.getState()
      if (chatState.unsubGroups) chatState.unsubGroups()
      if (chatState.unsubDMs) chatState.unsubDMs()
      if (chatState.unsubChannels) chatState.unsubChannels()
      if (chatState.unsubMessages) chatState.unsubMessages()
      if (chatState.unsubDMMessages) chatState.unsubDMMessages()
      chatMod.useChatStore.setState({
        unsubGroups: null, unsubDMs: null,
        unsubChannels: null, unsubMessages: null, unsubDMMessages: null,
        activeGroup: null, activeChannel: null, activeDM: null,
        groups: [], channels: [], messages: [], dms: [], dmMessages: [],
      })
    } catch (err) { console.error('chat cleanup on logout failed:', err) }

    try {
      const audioMod = await import('../services/audio')
      audioMod.closeNotifContext()
    } catch { /* non-critical */ }

    const cleanup = get()._presenceCleanup
    if (cleanup) try { cleanup() } catch { /* non-critical */ }

    // signOut always runs even if cleanup failed
    await signOut(auth)
    set({ user: null, userProfile: null, _presenceCleanup: null })
  },

  clearError: () => set({ error: null }),
}))
