import { useState, useRef, useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useVoiceStore } from '../../stores/voiceStore'
import { toast } from '../../stores/toastStore'
import { updateProfile } from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { auth, db, storage } from '../../config/firebase'
import Avatar from '../ui/Avatar'

export default function SettingsModal({ onClose }) {
  const { user, userProfile } = useAuthStore()
  const { vadThreshold, setVadThreshold } = useVoiceStore()
  const [displayName, setDisplayName] = useState(user?.displayName || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [customStatus, setCustomStatus] = useState(userProfile?.customStatus || '')
  const fileInputRef = useRef(null)

  useEffect(() => {
    const handleEscape = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const photoURL = user?.photoURL || userProfile?.photoURL

  const handleSave = async () => {
    if (!displayName.trim()) return
    setSaving(true)
    try {
      const updates = { displayName: displayName.trim() }
      if (customStatus !== (userProfile?.customStatus || '')) {
        updates.customStatus = customStatus.trim()
      }
      // write Firestore first — if it fails, Auth stays consistent with previous state
      await updateDoc(doc(db, 'users', user.uid), updates)
      await updateProfile(auth.currentUser, { displayName: displayName.trim() })
      // update voicePresence if in voice (audit fix #10)
      const voiceState = useVoiceStore.getState()
      if (voiceState.inVoice && voiceState.voiceGroupId && voiceState.voiceChannelId) {
        await updateDoc(
          doc(db, 'groups', voiceState.voiceGroupId, 'channels', voiceState.voiceChannelId, 'voicePresence', user.uid),
          { displayName: displayName.trim() }
        )
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('failed to update profile:', err)
      setSaveError('save failed, try again')
      setTimeout(() => setSaveError(null), 4000)
    }
    setSaving(false)
  }

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image too large (max 5MB)')
      return
    }

    setUploading(true)
    try {
      const storageRef = ref(storage, `avatars/${user.uid}`)
      await uploadBytes(storageRef, file)
      const url = await getDownloadURL(storageRef)
      // write Firestore first — if it fails, Auth stays consistent with previous state
      await updateDoc(doc(db, 'users', user.uid), { photoURL: url })
      await updateProfile(auth.currentUser, { photoURL: url })
      // update voicePresence if in voice (so avatar updates live)
      const voiceState = useVoiceStore.getState()
      if (voiceState.inVoice && voiceState.voiceGroupId && voiceState.voiceChannelId) {
        await updateDoc(
          doc(db, 'groups', voiceState.voiceGroupId, 'channels', voiceState.voiceChannelId, 'voicePresence', user.uid),
          { photoURL: url }
        )
      }
      // force re-render by updating the auth store
      useAuthStore.setState({ user: { ...auth.currentUser } })
    } catch (err) {
      console.error('failed to upload photo:', err)
    }
    setUploading(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative glass rounded-2xl p-6 w-full max-w-lg mx-4 border border-void-border animate-fade-in max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display font-bold text-lg text-text-primary">your vibe settings</h2>
          <button onClick={onClose} className="text-text-muted hover:text-neon-pink text-sm font-mono transition-colors">
            [close]
          </button>
        </div>

        {/* Profile Section */}
        <div className="mb-6">
          <h3 className="text-text-muted text-xs font-mono uppercase tracking-wider mb-3">profile</h3>

          {/* Avatar + Upload */}
          <div className="flex items-center gap-4 mb-4">
            <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              <Avatar src={photoURL} name={displayName} size="xl" />
              <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="text-white text-xs font-mono">{uploading ? '...' : 'change'}</span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoUpload}
              />
            </div>
            <div className="text-text-muted text-xs font-mono">
              <p>click to upload a pfp</p>
              <p className="text-text-muted/50">// jpg, png, gif. max 5mb</p>
            </div>
          </div>

          {/* Display Name */}
          <div className="space-y-2">
            <label className="block text-text-muted text-xs font-mono uppercase tracking-wider">display name</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg text-sm"
                placeholder="your name..."
              />
              <button
                onClick={handleSave}
                disabled={saving || (displayName.trim() === user?.displayName && customStatus === (userProfile?.customStatus || ''))}
                className="px-4 py-2 bg-neon-green text-void rounded-lg font-semibold text-sm
                           hover:bg-neon-green/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                {saving ? '...' : saved ? '✓' : 'save'}
              </button>
            </div>
            {saveError && (
              <p className="text-neon-pink text-xs font-mono mt-1">{saveError}</p>
            )}
          </div>

          {/* Custom Status */}
          <div className="mt-3">
            <label className="block text-text-muted text-xs font-mono uppercase tracking-wider mb-1">status</label>
            <input
              type="text"
              value={customStatus}
              onChange={(e) => setCustomStatus(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              placeholder="grinding ranked..."
              maxLength={50}
            />
            <p className="text-text-muted/50 text-[10px] font-mono mt-1">// what you&apos;re up to rn</p>
          </div>

          {/* Email */}
          <div className="mt-3">
            <label className="block text-text-muted text-xs font-mono uppercase tracking-wider mb-1">email</label>
            <p className="text-text-secondary text-sm font-mono px-3 py-2 bg-void rounded-lg border border-void-border">
              {user?.email}
            </p>
          </div>
        </div>

        {/* Voice Settings */}
        <div className="mb-6">
          <h3 className="text-text-muted text-xs font-mono uppercase tracking-wider mb-3">voice</h3>
          <div>
            <label className="block text-text-muted text-xs font-mono uppercase tracking-wider mb-1.5">
              noise gate sensitivity
            </label>
            <input
              type="range" min="5" max="60" step="1" value={vadThreshold}
              onChange={(e) => setVadThreshold(parseInt(e.target.value))}
              className="w-full h-1 bg-void-lighter rounded-lg appearance-none cursor-pointer accent-neon-green"
            />
            <div className="flex justify-between text-[10px] text-text-muted font-mono mt-1">
              <span>sensitive</span>
              <span>{vadThreshold}</span>
              <span>aggressive</span>
            </div>
            <p className="text-text-muted text-[10px] font-mono mt-2">
              // rnnoise handles the heavy lifting. this gate catches what&apos;s left. changes apply immediately.
            </p>
          </div>
        </div>

        {/* About */}
        <div className="border-t border-void-border pt-4">
          <p className="text-text-muted text-[10px] font-mono text-center">
            dizkord v1.7.0 // freedommaxxing since 2026 // no kyc, no id, no cap
          </p>
        </div>
      </div>
    </div>
  )
}
