# Grok Image & Video Generation API — Technical Reference

Full API documentation for implementing Grok Imagine (image + video) as Firebase Cloud Functions.

**Sources:**
- [Image Generation](https://docs.x.ai/developers/model-capabilities/images/generation)
- [Video Generation](https://docs.x.ai/developers/model-capabilities/video/generation)
- [API Reference](https://docs.x.ai/developers/api-reference)
- [Models & Pricing](https://docs.x.ai/developers/models)
- [Rate Limits](https://docs.x.ai/developers/rate-limits)

---

## Authentication

**Method:** Bearer token in HTTP header

```
Authorization: Bearer <XAI_API_KEY>
```

- Create API keys at: https://console.x.ai/team/default/api-keys  
- Store `XAI_API_KEY` in Firebase Functions config, never in source

---

## Base URL

```
https://api.x.ai
```

Optional regional endpoints (see [Regional Endpoints](https://docs.x.ai/developers/regions)).

---

# 1. Image Generation API

## Endpoints

| Operation          | Method | Endpoint                   | Description                  |
|-------------------|--------|----------------------------|------------------------------|
| Generate images   | POST   | `/v1/images/generations`    | Text → image(s)             |
| Edit image        | POST   | `/v1/images/edits`         | Edit existing image         |

## Model

| Model               | Description      |
|---------------------|------------------|
| `grok-imagine-image`| Image generation & editing |

---

## Image Generation — Request

**Endpoint:** `POST https://api.x.ai/v1/images/generations`  
**Content-Type:** `application/json`

### Request body

```json
{
  "model": "grok-imagine-image",
  "prompt": "A collage of London landmarks in a stenciled street‑art style",
  "n": 1,
  "aspect_ratio": "auto",
  "image_format": "url"
}
```

| Field          | Type   | Required | Description |
|----------------|--------|----------|-------------|
| `model`        | string | yes      | `"grok-imagine-image"` |
| `prompt`       | string | yes      | Text prompt for image |
| `n`            | int    | no       | Number of images (1–10). Default: 1 |
| `aspect_ratio` | string | no       | See table below |
| `image_format` | string | no       | `"url"` (default) or `"base64"` |

### Aspect ratios

| Value       | Use case                         |
|-------------|----------------------------------|
| `1:1`       | Social media, thumbnails         |
| `16:9`/`9:16` | Widescreen, mobile, stories    |
| `4:3`/`3:4` | Presentations, portraits       |
| `3:2`/`2:3` | Photography                     |
| `2:1`/`1:2` | Banners, headers               |
| `19.5:9`/`9:19.5` | Modern smartphone displays |
| `20:9`/`9:20` | Ultra-wide displays         |
| `auto`      | Model chooses best ratio         |

---

## Image Edit — Request

**Endpoint:** `POST https://api.x.ai/v1/images/edits`  
**Content-Type:** `application/json`

**Note:** Use JSON only, no `multipart/form-data`.

### Request body

```json
{
  "model": "grok-imagine-image",
  "prompt": "Change the landmarks to be New York City landmarks",
  "image_url": "https://example.com/landmarks.jpg"
}
```

Or with base64:

```json
{
  "model": "grok-imagine-image",
  "prompt": "Render this as an oil painting",
  "image_url": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
}
```

| Field       | Type   | Required | Description |
|------------|--------|----------|-------------|
| `model`    | string | yes      | `"grok-imagine-image"` |
| `prompt`   | string | yes      | Edit instructions |
| `image_url`| string | yes      | Public URL or `data:image/jpeg;base64,...` |

---

## Image Response Format

**Single image:**

```json
{
  "url": "https://...",
  "model": "grok-imagine-image",
  "respect_moderation": true
}
```

**Batch (`n` > 1):** Array of objects like above.

**Base64 (`image_format: "base64"`):**

```json
{
  "image": "<base64 string>",
  "model": "grok-imagine-image",
  "respect_moderation": true
}
```

| Field               | Description |
|---------------------|-------------|
| `url`               | Temporary URL (download promptly) |
| `image`              | Base64 when `image_format` is `"base64"` |
| `model`              | Model used (may resolve aliases) |
| `respect_moderation` | `true` if passed content moderation |

---

## Image Limitations

- Max images per request: **10**
- URLs are temporary; store locally if needed
- Content moderation applies

---

## Image Pricing

- Per-image pricing; prompt length does not change cost
- Image edit: input + output images each billed
- Details: https://docs.x.ai/developers/models/grok-imagine-image

---

## Image cURL examples

**Generate:**
```bash
curl -X POST https://api.x.ai/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{
    "model": "grok-imagine-image",
    "prompt": "A serene Japanese garden at dusk"
  }'
```

**Edit:**
```bash
curl -X POST https://api.x.ai/v1/images/edits \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{
    "model": "grok-imagine-image",
    "prompt": "Make it look like autumn",
    "image_url": "https://example.com/garden.jpg"
  }'
```

---

# 2. Video Generation API

## Endpoints

| Operation           | Method | Endpoint                     | Description                 |
|--------------------|--------|------------------------------|-----------------------------|
| Start generation   | POST   | `/v1/videos/generations`      | Text, image, or video → video |
| Start video edit   | POST   | `/v1/videos/edits`           | Edit existing video        |
| Get result         | GET    | `/v1/videos/{request_id}`    | Poll for completion        |

## Model

| Model               | Description          |
|---------------------|----------------------|
| `grok-imagine-video`| Video generation & edit |

---

## Flow

1. **Start** — POST request, receive `request_id`
2. **Poll** — GET `https://api.x.ai/v1/videos/{request_id}` every few seconds until `status: "done"`

---

## Video Generation — Request (Step 1)

**Endpoint:** `POST https://api.x.ai/v1/videos/generations`  
**Content-Type:** `application/json`

### Text-to-video

```json
{
  "model": "grok-imagine-video",
  "prompt": "A glowing crystal-powered rocket launching from the red dunes of Mars",
  "duration": 10,
  "aspect_ratio": "16:9",
  "resolution": "720p"
}
```

### Image-to-video

```json
{
  "model": "grok-imagine-video",
  "prompt": "Animate the clouds drifting across the sky",
  "image_url": "https://example.com/landscape.jpg",
  "duration": 10
}
```

Or base64: `"image_url": "data:image/jpeg;base64,..."`

### Parameters

| Field         | Type   | Required | Description |
|---------------|--------|----------|-------------|
| `model`       | string | yes      | `"grok-imagine-video"` |
| `prompt`      | string | yes      | Generation instructions |
| `image_url`   | string | no       | Public URL or base64 data URI (for image-to-video) |
| `duration`    | int    | no       | 1–15 seconds. Default varies |
| `aspect_ratio`| string | no       | `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3`. Default: `16:9` |
| `resolution`  | string | no       | `"720p"` or `"480p"` (default) |

---

## Video Edit — Request (Step 1)

**Endpoint:** `POST https://api.x.ai/v1/videos/edits`  
**Content-Type:** `application/json`

```json
{
  "model": "grok-imagine-video",
  "prompt": "Give the woman a silver necklace",
  "video_url": "https://example.com/portrait-wave.mp4"
}
```

### Parameters

| Field       | Type   | Required | Description |
|------------|--------|----------|-------------|
| `model`    | string | yes      | `"grok-imagine-video"` |
| `prompt`   | string | yes      | Edit instructions |
| `video_url`| string | yes      | Public URL to input video |

**Edit-specific constraints:**
- Input video max length: **8.7 seconds**
- `duration`, `aspect_ratio`, `resolution` not supported for edits
- Output keeps input duration and aspect ratio
- Output resolution matches input, capped at 720p

---

## Video Start Response (Step 1)

```json
{
  "request_id": "d97415a1-5796-b7ec-379f-4e6819e08fdf"
}
```

---

## Video Poll Request (Step 2)

**Endpoint:** `GET https://api.x.ai/v1/videos/{request_id}`  

**Headers:** `Authorization: Bearer $XAI_API_KEY` only

---

## Video Poll Response

### While processing (`status: "pending"`)

```json
{
  "status": "pending"
}
```

### On completion (`status: "done"`)

```json
{
  "status": "done",
  "video": {
    "url": "https://vidgen.x.ai/.../video.mp4",
    "duration": 8,
    "respect_moderation": true
  },
  "model": "grok-imagine-video"
}
```

### On expiry (`status: "expired"`)

```json
{
  "status": "expired"
}
```

| Status    | Description         |
|-----------|---------------------|
| `pending`| Still generating     |
| `done`   | Video ready          |
| `expired`| Request expired      |

---

## Video Limitations

- Max duration: **15s** for generation, **8.7s** for edit input
- Resolutions: **480p** or **720p**
- URLs temporary; download for long-term use
- Content moderation applies

---

## Video Pricing

- Per-second pricing (duration and resolution matter)
- Details: https://docs.x.ai/developers/models

---

## Video cURL examples

**Start generation:**
```bash
curl -X POST https://api.x.ai/v1/videos/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{
    "model": "grok-imagine-video",
    "prompt": "A glowing crystal-powered rocket launching from Mars"
  }'
```

**Poll for result:**
```bash
curl -X GET "https://api.x.ai/v1/videos/{request_id}" \
  -H "Authorization: Bearer $XAI_API_KEY"
```

---

# Firebase Cloud Functions — Example Sketches

## Image generation (Node.js)

```javascript
const functions = require('firebase-functions');
const fetch = require('node-fetch'); // or undici in Node 18+

exports.generateImage = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new Error('Unauthenticated');
  const { prompt, aspectRatio = 'auto', n = 1 } = data;
  const apiKey = functions.config().xai?.api_key;
  if (!apiKey) throw new Error('XAI_API_KEY not configured');

  const res = await fetch('https://api.x.ai/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'grok-imagine-image',
      prompt,
      n,
      aspect_ratio: aspectRatio,
      image_format: 'url',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new functions.https.HttpsError('internal', `xAI: ${err}`);
  }

  const json = await res.json();
  return Array.isArray(json) ? json : [json];
});
```

## Video generation (Node.js, with polling)

```javascript
const functions = require('firebase-functions');
const fetch = require('node-fetch');

const XAI_BASE = 'https://api.x.ai';

async function pollVideoResult(requestId, apiKey, maxAttempts = 60, intervalMs = 5000) {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${XAI_BASE}/v1/videos/${requestId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json();
    if (data.status === 'done') return data;
    if (data.status === 'expired') throw new Error('Video request expired');
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Video generation timeout');
}

exports.generateVideo = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new Error('Unauthenticated');
    const { prompt, duration = 10, aspectRatio = '16:9', resolution = '720p', imageUrl } = data;
    const apiKey = functions.config().xai?.api_key;
    if (!apiKey) throw new Error('XAI_API_KEY not configured');

    const body = {
      model: 'grok-imagine-video',
      prompt,
      duration,
      aspect_ratio: aspectRatio,
      resolution,
    };
    if (imageUrl) body.image_url = imageUrl;

    const startRes = await fetch(`${XAI_BASE}/v1/videos/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!startRes.ok) throw new functions.https.HttpsError('internal', await startRes.text());

    const { request_id } = await startRes.json();
    const result = await pollVideoResult(request_id, apiKey);
    return result;
  });
```

---

# Rate Limits

- Rate limits depend on account tier
- Exceeding limits returns HTTP **429**
- Check your limits: https://console.x.ai/team/default/models  
- Increase limits: contact support@x.ai

---

# Regional Endpoints

Regional base URLs available: https://docs.x.ai/developers/regions

---

# Error Handling

- Use `application/json` for all requests (no `multipart/form-data`)
- Images: max **10 per request**
- Video: poll every few seconds; expect several minutes for completion
- Store API key securely (e.g. Firebase config or Secret Manager)
