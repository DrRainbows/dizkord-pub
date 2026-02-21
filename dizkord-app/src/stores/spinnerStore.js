import { create } from 'zustand'
import {
  doc, onSnapshot, setDoc, updateDoc, deleteField,
  runTransaction, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../config/firebase'
import { toast } from './toastStore'

export const SEGMENT_COLORS = [
  '#00ff88', // neon-green
  '#bf5af2', // neon-purple
  '#0a84ff', // neon-blue
  '#ff375f', // neon-pink
  '#64d2ff', // neon-cyan
  '#ffd60a', // neon-yellow
]

const MAX_OPTIONS = 20

export const useSpinnerStore = create((set, get) => ({
  session: null,
  unsubSession: null,

  // --- LISTENER ---

  listenSession: (groupId, channelId) => {
    const prev = get().unsubSession
    if (prev) prev()
    const ref = doc(db, 'groups', groupId, 'channels', channelId, 'session', 'active')
    const unsub = onSnapshot(ref, (snap) => {
      set({ session: snap.exists() ? snap.data() : null })
    })
    set({ unsubSession: unsub })
  },

  stopListening: () => {
    const prev = get().unsubSession
    if (prev) prev()
    set({ session: null, unsubSession: null })
  },

  // --- SESSION LIFECYCLE ---

  createSession: async (groupId, channelId, user) => {
    const ref = doc(db, 'groups', groupId, 'channels', channelId, 'session', 'active')
    await setDoc(ref, {
      options: [],
      spectators: {
        [user.uid]: {
          displayName: user.displayName || 'anon',
          photoURL: user.photoURL || null,
        },
      },
      votes: {},
      status: 'building',
      result: null,
      resultAngle: null,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    })
  },

  resetSession: async (groupId, channelId) => {
    const ref = doc(db, 'groups', groupId, 'channels', channelId, 'session', 'active')
    await updateDoc(ref, {
      options: [],
      votes: {},
      status: 'building',
      result: null,
      resultAngle: null,
    })
  },

  // --- SPECTATORS ---

  addSpectator: async (groupId, channelId, user) => {
    const ref = doc(db, 'groups', groupId, 'channels', channelId, 'session', 'active')
    await updateDoc(ref, {
      [`spectators.${user.uid}`]: {
        displayName: user.displayName || 'anon',
        photoURL: user.photoURL || null,
      },
    }).catch(() => toast.error('Failed to join spinner'))
  },

  removeSpectator: async (groupId, channelId, uid) => {
    const ref = doc(db, 'groups', groupId, 'channels', channelId, 'session', 'active')
    await updateDoc(ref, {
      [`spectators.${uid}`]: deleteField(),
      [`votes.${uid}`]: deleteField(),
    }).catch(() => toast.warn('Failed to leave spinner cleanly'))
  },

  // --- OPTIONS ---

  addOption: async (groupId, channelId, option) => {
    const { session } = get()
    if (!session || session.options.length >= MAX_OPTIONS) return
    const ref = doc(db, 'groups', groupId, 'channels', channelId, 'session', 'active')
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) return
      const data = snap.data()
      if (data.options.length >= MAX_OPTIONS) return
      tx.update(ref, {
        options: [...data.options, option],
        votes: {},
        status: 'building',
      })
    })
  },

  removeOption: async (groupId, channelId, index) => {
    const ref = doc(db, 'groups', groupId, 'channels', channelId, 'session', 'active')
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) return
      const data = snap.data()
      const newOptions = data.options.filter((_, i) => i !== index)
      tx.update(ref, {
        options: newOptions,
        votes: {},
        status: 'building',
      })
    })
  },

  // --- VOTING ---

  voteToSpin: async (groupId, channelId, uid) => {
    const ref = doc(db, 'groups', groupId, 'channels', channelId, 'session', 'active')
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) return
      const data = snap.data()
      if (data.status === 'spinning' || data.status === 'result') return
      if (data.options.length < 2) return

      const newVotes = { ...data.votes, [uid]: true }
      const voteCount = Object.keys(newVotes).length
      const spectatorCount = Object.keys(data.spectators || {}).length

      if (voteCount >= spectatorCount && spectatorCount >= 1) {
        // all spectators voted — pick result and spin
        const resultIdx = Math.floor(Math.random() * data.options.length)
        const segAngle = 360 / data.options.length
        const spins = 360 * (5 + Math.floor(Math.random() * 3))
        const offset = 360 - (resultIdx * segAngle + segAngle / 2)
        tx.update(ref, {
          votes: newVotes,
          status: 'spinning',
          result: data.options[resultIdx],
          resultAngle: spins + offset,
        })
      } else {
        tx.update(ref, { votes: newVotes })
      }
    })
  },

  unvote: async (groupId, channelId, uid) => {
    const ref = doc(db, 'groups', groupId, 'channels', channelId, 'session', 'active')
    await updateDoc(ref, { [`votes.${uid}`]: deleteField() })
  },

  // --- SPIN COMPLETION ---

  markComplete: async (groupId, channelId) => {
    const { session } = get()
    if (session?.status !== 'spinning') return
    const ref = doc(db, 'groups', groupId, 'channels', channelId, 'session', 'active')
    await updateDoc(ref, { status: 'result' }).catch(() => toast.error('Failed to update spinner'))
  },
}))
