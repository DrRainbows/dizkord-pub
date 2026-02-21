import { create } from 'zustand'

let nextId = 1

export const useToastStore = create((set, get) => ({
  toasts: [],

  addToast: (message, type = 'info', durationMs = 4000) => {
    const id = nextId++
    set(prev => ({ toasts: [...prev.toasts, { id, message, type }] }))
    if (durationMs > 0) {
      setTimeout(() => get().removeToast(id), durationMs)
    }
    return id
  },

  removeToast: (id) => {
    set(prev => ({ toasts: prev.toasts.filter(t => t.id !== id) }))
  },
}))

export const toast = {
  info: (msg, ms) => useToastStore.getState().addToast(msg, 'info', ms),
  success: (msg, ms) => useToastStore.getState().addToast(msg, 'success', ms),
  error: (msg, ms) => useToastStore.getState().addToast(msg, 'error', ms ?? 6000),
  warn: (msg, ms) => useToastStore.getState().addToast(msg, 'warn', ms),
}
