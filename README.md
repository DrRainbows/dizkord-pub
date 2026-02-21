# DizKord

Voice chat + text messaging for friend groups. No KYC, no ID, no cap. Built for ~7 people who just want to hang out.

> **This is not a public service.** DizKord has no rate limiting, no email verification, no CAPTCHA, and no abuse controls. It is designed for private deployments among people who trust each other. If you deploy this on the open internet without adding those protections first, you will have a bad time.

## What's in the box

- **Voice chat** — WebRTC mesh with RNNoise ML noise suppression, per-user volume, speaking indicators
- **Text chat** — real-time messaging, @mentions, image/video sharing, link previews, reactions, pins, reply threads
- **Screen sharing** — with audio, theatre mode for viewers
- **AI integration** — Grok (xAI) for chat responses, image generation, image editing, video generation, and theme generation via `@grok` commands
- **Eve** — AI voice agent that joins voice calls, hears everyone, speaks back in real-time, remembers past conversations via xAI Collections
- **Arcade** — peer-to-peer Tron and fake stock trading games over WebRTC data channels
- **RNG Spinner** — collaborative decision-making wheel with vote-to-spin mechanics
- **PWA** — installable, works on mobile

## Stack

- **Frontend**: React 19 + Vite 7 + Tailwind CSS v4 + Zustand
- **Backend**: Firebase (Auth, Firestore, Storage, Cloud Functions, Hosting) — Blaze plan required
- **Voice**: WebRTC mesh topology, Firestore-based signaling, Cloudflare TURN
- **Noise suppression**: RNNoise WASM via `@timephy/rnnoise-wasm` AudioWorklet
- **AI**: Grok via xAI API (text, image, video, voice agent)
- **Routing**: React Router v7 with URL-driven navigation

## Setup

### 1. Firebase (required)

This is the only hard requirement. Everything else is optional.

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Upgrade to the **Blaze plan** (Cloud Functions require it — there is a free tier)
3. Enable these services:
   - **Authentication** — enable Email/Password sign-in
   - **Cloud Firestore** — create a database (any region)
   - **Storage** — initialize with default rules
   - **Hosting** — initialize
4. Go to **Project Settings > Your apps > Add web app** and copy the config values
5. Clone this repo, then:

```bash
cd dizkord-app
cp .env.example .env
```

6. Paste your Firebase config values into `.env`:

```
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000
VITE_FIREBASE_APP_ID=1:000000000000:web:abcdef123456
```

7. Install and deploy:

```bash
npm install
cd functions && npm install && cd ..
npx firebase login
npx firebase deploy
```

That's it. You have a working DizKord at the Firebase Hosting URL printed after deploy.

### 2. Cloudflare TURN (recommended)

Without TURN, voice chat only works when peers can connect directly (same network, or friendly NAT). Behind corporate firewalls or strict mobile NAT, it fails silently.

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) > **Calls** > **TURN**
2. Create a TURN token (free tier is fine for small groups)
3. Copy the Token ID and API Token into `functions/.env`:

```bash
cp functions/.env.example functions/.env
```

```
CF_TURN_TOKEN_ID=your-token-id
CF_TURN_API_TOKEN=your-api-token
```

4. Redeploy functions: `npx firebase deploy --only functions`

### 3. Grok AI (optional)

Enables `@grok` commands in chat (ask questions, generate images, generate videos) and the Eve voice agent.

1. Get an API key at [console.x.ai](https://console.x.ai)
2. Add to `functions/.env`:

```
XAI_API_KEY=your-xai-api-key
```

3. **For Eve memory** (optional): Eve can remember past conversations across sessions using xAI Collections. Get a Management API key from the same console and add:

```
XAI_MANAGEMENT_API_KEY=your-management-api-key
```

4. Redeploy functions: `npx firebase deploy --only functions`

### 4. Custom domain (optional)

1. Buy a domain
2. In Firebase Console > **Hosting** > **Add custom domain**
3. Follow the DNS verification steps
4. Firebase handles SSL automatically

## Hand it to an AI agent

This repo is designed to be set up by an AI coding agent. Give Claude Code, Cursor, or similar:

1. This repo
2. Your Firebase client config (from Project Settings)
3. Your API keys (xAI, Cloudflare — if you have them)

And ask it to "fill in the `.env` files and deploy." The `CLAUDE.md` file at the repo root is the full architecture handoff document — it contains everything an agent needs to understand the codebase.

## Architecture

See `CLAUDE.md` for the complete codebase map, including:

- File-by-file breakdown of all stores, services, components, hooks, and engines
- WebRTC voice pipeline (mic > RNNoise > gate > WebRTC)
- Firestore data model and security rules
- Cloud Functions domain split (grok, voice, infrastructure, invite)
- Outstanding issues and feature requests

## License

MIT
