# DizKord - AI Agent Handoff Document

## What This Is
DizKord is a Discord replacement for a friend group (~7 people). Voice chat + text messaging web app. "Gen Z coded" aesthetic. No KYC, no ID required. Freedommaxxing.

## Current Version: v1.3.4 (production hardening)

## Tech Stack
- **Frontend**: React 19 + Vite 7 + Tailwind CSS v4
- **Backend**: Firebase (Auth, Firestore, Storage, Cloud Functions) - Blaze plan
- **Voice**: WebRTC mesh topology with Firestore-based signaling + Cloudflare TURN
- **Noise Suppression**: RNNoise WASM via `@timephy/rnnoise-wasm` AudioWorklet
- **AI**: Grok 4.1 Fast (text, image gen, video gen, theme gen) via Cloud Functions
- **State**: Zustand stores (voice settings persisted to localStorage)
- **Hosting**: Firebase Hosting + PWA

## Cloudflare TURN Server
- **Credentials**: In `functions/.env` as `CF_TURN_TOKEN_ID` and `CF_TURN_API_TOKEN` (moved from hardcoded in v1.3.3)
- **Cloud Function**: `getTurnCredentials` generates 24hr ICE server configs
- **Client flow**: `fetchTurnCredentials()` called before `startVoice()`, populates `ICE_SERVERS` dynamically

## Grok API
- **API Key**: In `functions/.env` as `XAI_API_KEY`
- **Chat model**: `grok-4-1-fast-non-reasoning`
- **Image gen**: `grok-imagine-image` via `POST /v1/images/generations`
- **Image edit**: `grok-imagine-image` via `POST /v1/images/edits` (needs `image_url`)
- **Video gen**: `grok-imagine-video` via `POST /v1/videos/generations` (async polling, 720p, up to 10s)
- **Video edit (img→vid)**: `grok-imagine-video` via `POST /v1/videos/generations` with `image: {url}` param
- **Theme gen**: `grok-4-1-fast-non-reasoning` (returns JSON color palette)
- **Voice Agent**: `wss://api.x.ai/v1/realtime` (not yet implemented)

## COMPREHENSIVE CODEBASE AUDIT (v1.3.3)

Two deep audits completed: stores/services (20 issues) + components (28 issues).
**48 total issues. ~25 fixed across v1.3.0–v1.3.3. Remaining items listed below.**

### TIER 1: Must fix (blocks real usage)

1. **Integrate Cloudflare TURN server** (FIXED v1.3.2)
   - New Cloud Function `getTurnCredentials` that calls Cloudflare API with the token
   - Client calls this before `startVoice()`, receives dynamic ICE servers
   - Replace hardcoded STUN-only `ICE_SERVERS` in webrtc.js with dynamic config
   - This fixes: asymmetric audio, stream inconsistency, peer connection failures

2. **Fix Grok video generation** (FIXED v1.3.2)
   - Model name was `grok-2-video`, correct name is `grok-imagine-video`
   - Polling endpoint was `/v1/videos/{id}`, correct is `/v1/videos/generations/{id}`
   - Video edit endpoint was `/v1/videos/edits`, correct is `/v1/videos/generations` with `image` param

3. **Cross-group notification sound bleed** (FIXED v1.3.3)
   - Firestore snapshot listeners cleaned up on logout (chatStore unsubs in authStore.logout)
   - All listener state reset on logout (groups, channels, messages, DMs cleared)

4. **webrtc.js: setTimeout race in screen share renegotiation** (FIXED v1.3.2)
   - Line 363: `setTimeout(() => sendRenegotiationOffer(...), 500)` has no `voiceActive` guard
   - If user leaves voice during the 500ms window, writes to closed connection
   - Fix: Check `voiceActive` inside the timeout callback

5. **chatStore.js: Silent Grok command failures** (FIXED v1.3.2)
   - `_handleGrokCommand()` errors swallowed with `.catch(() => {})` — users get no feedback
   - Fix: Surface error to user via a toast or message in chat

6. **audio.js: AudioWorklet load failure sets workletLoaded = true** (FIXED v1.3.2)
   - If `addModule()` fails, subsequent pipelines skip loading and use null node
   - Fix: Only set `workletLoaded = true` after successful load

### TIER 2: Should fix (degrades experience)

7. **Memory leak audit** (PARTIALLY FIXED v1.3.3)
   - FIXED: Reconnect timers tracked and cleared in `stopVoice()` (prevents zombie peer connections)
   - FIXED: `switchInputDevice` now stops old processed stream tracks before replacing
   - FIXED: Speaking detector `stop()` disconnects analyser node (v1.3.2)
   - OPEN: `notifCtx` AudioContext never closed, accumulates over session
   - OPEN: ICE candidates write individually to Firestore (no batching)

8. **ChatView.jsx: Stale closure in paste handler** (NOT A BUG)
   - Verified: `imageUploadRef` pattern updates on every render, so `handleImageUpload` always has latest channel context

9. **authStore.js: Silent error suppression in presence** (FIXED v1.3.2)
   - `.catch(() => {})` on online/offline status writes — user may appear online after disconnect
   - Fix: Log errors at minimum

10. **SettingsModal.jsx: Auth/Firestore sync issues** (FIXED v1.3.4)
    - Reordered: Firestore write now happens before `updateProfile` — if Firestore fails, Auth stays consistent

11. **Firestore write failures from typing indicators** (OPEN)
    - `startTyping`/`stopTyping` still fire on stale channel refs after navigation edge cases

12. **webrtc.js: Presence listener unsubscribe chaining fragile** (FIXED v1.3.2)
    - Lines 256-259: `prevUnsub` may be undefined; cleanup chain breaks if multiple sessions overlap
    - Fix: Guard with `typeof prevUnsub === 'function'`

### TIER 3: Polish & performance

13. **Sidebar.jsx: Voice presence listeners not scoped to channels** (OPEN)
    - If `channels` array changes without group changing, old listeners persist
    - Fix: Already has `[activeGroup, channels]` deps — verify edge cases

14. **Sidebar.jsx: 1 listener per text channel for unread** (OPEN)
    - 20 channels = 20 `onSnapshot` listeners; consider aggregate approach for scale

15. **MessageContent.jsx: Index-based keys for embeds** (FIXED v1.3.4)
    - Changed embed keys from index-based (`yt${i}`) to URL-based (`key={url}`) — stable across re-renders

16. **StreamViewer.jsx: Inline ref callbacks recreated every render** (FIXED v1.3.4)
    - Extracted `getVideoRef(id)` via `useCallback` — avoids React 19 ref churn

17. **voiceStore.js: `speakingUsers` is a Set** (FIXED v1.3.4)
    - Converted from Set to plain object `{ [uid]: true }` — serializable, skip no-op re-renders

18. **webrtc.js: Reconnect delay has no max cap** (FIXED v1.3.2)
    - `RECONNECT_DELAY_MS * attempts` grows linearly; add `Math.min(..., 30000)`

19. **Storage rules security** (WONTFIX - Storage rules can't read Firestore)
    - Any authenticated user can upload to any group's storage
    - Firebase Storage rules cannot cross-query Firestore for membership
    - Risk is low for 7-person friend group; would need Cloud Function proxy for real fix

### TIER 4: Verification needed (may already work)

20. **Permission-denied errors** — Firestore rules rewritten in v1.3.0, verify deployed rules work
21. **Notification sound on initial load** — Fixed in v1.3.0, verify with 3+ users
22. **Screen share audio** — remoteVideoStreams separation done in v1.3.0, verify end-to-end
23. **Unread badges** — markChannelRead on leave done in v1.3.0, verify no false positives
24. **Onboarding tutorial** — verify spotlight positioning on different screen sizes
25. **Group profile picture** — verify upload works for non-owner members
26. **Invite link OG preview** — verify serveInvitePage returns proper OG tags

## OUTSTANDING FEATURE REQUESTS (not for hardening session)

These are features that were requested but not yet implemented or only partially done:

1. **Grok Voice Agent** - Grok joins voice as a peer, hears everyone, responds with speech
2. **Floating generated images in pixel rain** - compressed thumbnails of @grok imagine results drift in background
3. **Channel categories** - schema exists but sidebar doesn't render grouped sections
4. **Mic test in settings** - speak and hear playback through RNNoise pipeline
5. **PWA download prompt in onboarding** - show users how to install from browser
6. **Connection quality indicator** - show when TURN is being used vs direct
7. **TypeScript for Cloud Functions** - prevent SDK API mismatches
8. **Push notifications** - Firebase Cloud Messaging for @mentions when app is backgrounded
9. **Message search** - currently client-side only, needs Firestore full-text if messages exceed 100
10. **Drag users between voice channels**
11. **Custom emojis**
12. **Tauri desktop app** - system tray, high-priority audio thread

## Process
Analysis → Research → Implementation → Verification.
No new features during hardening. Fix what exists first.
Every fix must be tested with 3+ users before marking complete.
Every onSnapshot/addEventListener must have verified cleanup.
Every Firestore write must be tested against deployed rules.

## Changelog

### v1.3.4 - Final Polish (9 fixes)
- Fixed: SettingsModal Auth/Firestore sync — Firestore write now happens before `updateProfile` (both name + photo)
- Fixed: Sidebar DM name resolution — replaced boolean marker with proper `Set` for fetch tracking, failures now retry
- Fixed: Invite join lag — polls for group to appear in store after `joinGroup()`, auto-sets active
- Added: React ErrorBoundary wrapping entire app — component crashes show reload UI instead of white screen
- Fixed: Notification AudioContext leak — added `closeNotifContext()` export, called on logout
- Fixed: MessageContent embed keys — changed from index-based to URL-based keys for stable re-renders
- Fixed: StreamViewer ref callbacks — extracted stable `getVideoRef(id)` via `useCallback` (no React 19 ref churn)
- Fixed: voiceStore `speakingUsers` — converted from Set to plain object `{ [uid]: true }` (serializable, skip no-op re-renders)
- Updated: Grok image model name `grok-2-image` → `grok-imagine-image`

### v1.3.3 - Production Hardening (11 fixes)
- SECURITY: OG preview XSS fixed — HTML-escape all Firestore data in serveInvitePage
- SECURITY: Cloudflare TURN credentials moved from hardcoded to `functions/.env` via `defineString`
- Fixed: Listener cleanup on logout — chatStore unsubs (channels, messages, DMs) torn down before signOut
- Fixed: Post-teardown reconnect timers — timeout IDs tracked and cleared in `stopVoice()` (no zombie PCs)
- Fixed: `switchInputDevice` old processed stream tracks now stopped (prevents orphaned audio nodes)
- Fixed: StreamViewer `srcObject` assignment wrapped in try-catch (one bad stream can't crash viewer)
- Fixed: StreamViewer theatre mode `muted` bug — was hardcoded `true`, now `muted={focusedStream.isLocal}` (screen share audio plays)
- Fixed: AudioPlayback deafen effect checks `el.srcObject` before muting (prevents null stream errors)
- Fixed: VoiceChannel join/leave sounds use UID Set comparison instead of array identity (no false positives)
- Fixed: Grok `verifyGroupMember` now logs full members array + types for debugging permission failures
- Fixed: File input resets after upload — users can re-upload the same image file

### v1.3.1 - Codebase Audit & Hardening (6 fixes)
- Fixed: webrtc.js double `startVoice()` guard (prevents concurrent calls corrupting global state)
- Fixed: webrtc.js `localStream` null check in `createPeerConnection` (prevents crash on race)
- Fixed: Sidebar `hasUnread` cached via ref (was parsing localStorage JSON every render per channel)
- Fixed: Sidebar voice join double-click race condition (synchronous ref guard instead of async state)
- Fixed: MessageContent `previewCache` capped at 200 entries (was unbounded memory leak)
- Fixed: Sidebar `setLatestMessages` skips update if timestamp unchanged (prevents re-render cascade)
- Audited: 113 issues catalogued across all files (53 from stores/services, 60 from components)

### v1.3.0 - Care & Love Phase (7 fixes)
- Fixed: Firestore rules for reactions, typing, pinning (any member can react/pin/type)
- Fixed: Notification sound doubling on channel switch (initialLoadRef timing)
- Fixed: Grok exists() → exists (Admin SDK property)
- Fixed: Screen share audio transmission (separate remoteVideoStreams state)
- Fixed: Unread badges false positives (mark previous channel read on switch)
- Fixed: Screen share audio sender cleanup on stop
- Changed: Grok model to grok-4-1-fast-non-reasoning
- Changed: Grok errors now propagate actual API response to client
- Added: TURN server config support (needs credentials)
- Added: Cloudflare TURN credentials (in cloudfare_turn_server_credentials.txt)

### v1.2.0 - Audio persistence, permissions, grok, onboarding
### v1.1.0 - Audit fixes, group photos, OG previews, onboarding
### v1.0.0 - Streaming theatre, invite links, reply system, grok edit
### v0.9.x - Screen share, grok video/theme, search/pins/members
### v0.8.0 - 27-item audit, @grok commands
### v0.7.0 - @mentions, link previews, categories
### v0.6.0 - Chat controls, persistence
### v0.5.0 - Reliability pass
### v0.4.0 - Complete experience layer (RNNoise, reactions, images, typing, profiles)
### v0.1.0 - Initial release

## Public Repo Sync

The public open-source repo lives at `https://github.com/DrRainbows/dizkord-pub.git` and is cloned locally at `../dizkord-pub`. It has clean history (no secrets) and templatized config.

To publish changes from this private repo to the public one:

```bash
./publish.sh "description of what changed"
```

This runs `rsync` excluding `.env`, `functions/.env`, admin SDK keys, `.cursor`, `node_modules`, `dist`, `.firebase`, and `publish.sh` itself. It overwrites `dizkord-app/.firebaserc` with a placeholder project ID. Then commits and pushes to the public remote.

The public repo has `src/config/firebase.js` reading from `VITE_*` env vars (not hardcoded). The private repo also uses env vars now, with real values in `dizkord-app/.env` (gitignored).
