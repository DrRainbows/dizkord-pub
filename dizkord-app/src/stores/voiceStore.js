import { create } from 'zustand'
import {
  doc, setDoc, deleteDoc, onSnapshot, collection,
  serverTimestamp, getDocs
} from 'firebase/firestore'
import { db, auth } from '../config/firebase'

const STORAGE_KEY = 'dizkord_voice'

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function save(patch) {
  try {
    const prev = loadSaved()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prev, ...patch }))
  } catch { /* quota or private mode */ }
}

const saved = loadSaved()

export const useVoiceStore = create((set, get) => ({
  inVoice: false,
  voiceChannelId: null,
  voiceGroupId: null,
  voiceUsers: [],
  localStream: null,
  peerConnections: {},
  remoteStreams: {},        // audio streams per peer (for AudioPlayback)
  remoteVideoStreams: {},   // video streams per peer (for StreamViewer)
  userVolumes: saved.userVolumes || {},
  isMuted: false,
  isDeafened: false,
  audioDevices: { inputs: [], outputs: [] },
  selectedInput: saved.selectedInput || null,
  selectedOutput: saved.selectedOutput || null,
  speakingUsers: {},
  unsubVoice: null,
  error: null,
  vadThreshold: saved.vadThreshold ?? 20,
  _wasMutedBeforeDeafen: false,
  isScreenSharing: false,
  screenStream: null,
  _muteCallback: null,

  // webrtc.js registers this so mute uses gain node instead of track.enabled
  // (keeps processedStream track enabled for Eve's audio broadcast)
  registerMuteCallback: (cb) => set({ _muteCallback: cb }),

  setUserVolume: (uid, volume) => {
    const next = { ...get().userVolumes, [uid]: volume }
    set({ userVolumes: next })
    save({ userVolumes: next })
  },

  setSpeaking: (uid, speaking) => {
    const { speakingUsers } = get()
    if (speaking) {
      if (speakingUsers[uid]) return // already speaking, skip re-render
      set({ speakingUsers: { ...speakingUsers, [uid]: true } })
    } else {
      if (!speakingUsers[uid]) return // already not speaking, skip re-render
      const { [uid]: _, ...rest } = speakingUsers
      set({ speakingUsers: rest })
    }
  },

  toggleMute: () => {
    const { isMuted, isDeafened, localStream, _muteCallback } = get()
    if (isDeafened) {
      // undeafen: unmute mic
      if (_muteCallback) _muteCallback(false)
      else if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = true })
      const uid = auth.currentUser?.uid
      if (uid) get().setSpeaking(uid, false)
      set({ isMuted: false, isDeafened: false, _wasMutedBeforeDeafen: false })
      return
    }
    const newMuted = !isMuted
    if (_muteCallback) _muteCallback(newMuted)
    else if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = !newMuted })
    if (newMuted) {
      const uid = auth.currentUser?.uid
      if (uid) get().setSpeaking(uid, false)
    }
    set({ isMuted: newMuted })
  },

  toggleDeafen: () => {
    const { isDeafened, isMuted, _wasMutedBeforeDeafen, localStream, _muteCallback } = get()
    if (isDeafened) {
      const shouldStayMuted = _wasMutedBeforeDeafen
      if (_muteCallback) _muteCallback(shouldStayMuted)
      else if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = !shouldStayMuted })
      set({ isDeafened: false, isMuted: shouldStayMuted, _wasMutedBeforeDeafen: false })
    } else {
      if (_muteCallback) _muteCallback(true)
      else if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = false })
      const uid = auth.currentUser?.uid
      if (uid) get().setSpeaking(uid, false)
      set({ isDeafened: true, isMuted: true, _wasMutedBeforeDeafen: isMuted })
    }
  },

  setVadThreshold: (val) => {
    set({ vadThreshold: val })
    save({ vadThreshold: val })
  },

  enumerateDevices: async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      set({
        audioDevices: {
          inputs: devices.filter(d => d.kind === 'audioinput'),
          outputs: devices.filter(d => d.kind === 'audiooutput'),
        },
      })
    } catch {
      // device enumeration can fail in some contexts
    }
  },

  setSelectedInput: (deviceId) => {
    set({ selectedInput: deviceId })
    save({ selectedInput: deviceId })
  },

  setSelectedOutput: (deviceId) => {
    set({ selectedOutput: deviceId })
    save({ selectedOutput: deviceId })
  },

  joinVoiceChannel: async (groupId, channelId) => {
    const uid = auth.currentUser?.uid
    const displayName = auth.currentUser?.displayName || 'anon'
    if (!uid) return

    const presenceRef = doc(db, 'groups', groupId, 'channels', channelId, 'voicePresence', uid)
    await setDoc(presenceRef, {
      uid,
      displayName,
      photoURL: auth.currentUser?.photoURL || null,
      joinedAt: serverTimestamp(),
    })

    const MAX_PRESENCE_AGE_MS = 8 * 60 * 60 * 1000 // 8 hours — lazy cleanup of zombie entries
    const unsub = onSnapshot(
      collection(db, 'groups', groupId, 'channels', channelId, 'voicePresence'),
      (snap) => {
        const now = Date.now()
        const users = []
        const presentUids = new Set()
        let eveDoc = null

        for (const d of snap.docs) {
          const data = { id: d.id, ...d.data() }
          const joined = data.joinedAt?.toMillis?.()
          // auto-delete entries older than 8 hours (crashed tab, etc)
          if (joined && now - joined > MAX_PRESENCE_AGE_MS) {
            deleteDoc(d.ref).catch(() => {})
            continue
          }
          if (data.uid === 'eve' || data.isBot) {
            eveDoc = { ref: d.ref, data }
          }
          presentUids.add(data.uid)
          users.push(data)
        }

        // Auto-cleanup: if Eve is present but her summoner left, remove Eve
        if (eveDoc && eveDoc.data.summonedBy && !presentUids.has(eveDoc.data.summonedBy)) {
          deleteDoc(eveDoc.ref).catch(() => {})
          // Also clean up _meta/eve
          deleteDoc(doc(db, 'groups', groupId, '_meta', 'eve')).catch(() => {})
          // Remove Eve from the users list for this render
          const filtered = users.filter(u => u.uid !== 'eve')
          set({ voiceUsers: filtered })
          return
        }

        set({ voiceUsers: users })
      }
    )

    const cleanup = () => {
      const uid2 = auth.currentUser?.uid
      if (uid2) {
        deleteDoc(doc(db, 'groups', groupId, 'channels', channelId, 'voicePresence', uid2)).catch(() => {})
      }
    }
    window.addEventListener('beforeunload', cleanup)
    window.addEventListener('pagehide', cleanup)

    set({
      inVoice: true,
      voiceChannelId: channelId,
      voiceGroupId: groupId,
      unsubVoice: () => {
        unsub()
        window.removeEventListener('beforeunload', cleanup)
        window.removeEventListener('pagehide', cleanup)
      },
      error: null,
      isMuted: false,
      isDeafened: false,
    })
  },

  leaveVoiceChannel: async () => {
    const { voiceGroupId, voiceChannelId, unsubVoice, localStream, peerConnections } = get()
    const uid = auth.currentUser?.uid

    if (uid && voiceGroupId && voiceChannelId) {
      try {
        await deleteDoc(
          doc(db, 'groups', voiceGroupId, 'channels', voiceChannelId, 'voicePresence', uid)
        )
      } catch { /* may already be deleted */ }
      try {
        const sigRef = collection(
          db, 'groups', voiceGroupId, 'channels', voiceChannelId, 'signaling'
        )
        const snap = await getDocs(sigRef)
        for (const d of snap.docs) {
          const data = d.data()
          if (data.from === uid || data.to === uid) {
            await deleteDoc(d.ref)
          }
        }
      } catch { /* non-critical */ }
    }

    if (unsubVoice) unsubVoice()
    if (localStream) localStream.getTracks().forEach(t => t.stop())
    const pcs = { ...peerConnections }
    Object.values(pcs).forEach(pc => pc.close())

    set({
      inVoice: false,
      voiceChannelId: null,
      voiceGroupId: null,
      voiceUsers: [],
      localStream: null,
      peerConnections: {},
      remoteStreams: {},
      remoteVideoStreams: {},
      unsubVoice: null,
      speakingUsers: {},
      error: null,
      isMuted: false,
      isDeafened: false,
      _wasMutedBeforeDeafen: false,
      isScreenSharing: false,
      screenStream: null,
    })
  },
}))
