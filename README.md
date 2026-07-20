# localgpt

A ChatGPT-style web UI for a locally hosted Gemma model, talking to any
OpenAI-compatible `/v1/chat/completions` endpoint. Streams responses token by
token, renders markdown, and supports image and text-file attachments.

- Responsive down to phone widths, with iOS safe-area and keyboard handling
- Light/dark theming that follows the system
- Conversations persisted in `localStorage`
- No runtime dependencies beyond React

## Requirements

- Node 18+
- A model server exposing `GET /health` and `POST /v1/chat/completions`
  (streaming, OpenAI-compatible), by default on `http://127.0.0.1:8000`

## Development

```bash
npm install
npm run dev
```

Vite serves on port 5173 and proxies `/api` to the model server. To change the
backend address, edit `BACKEND` in [`vite.config.js`](vite.config.js).

### Opening it on your phone

The dev server binds to all interfaces, so Vite prints two URLs:

```
➜  Local:   http://localhost:5173/
➜  Network: http://192.168.1.42:5173/   ← open this one on the phone
```

Open the **Network** URL on any device on the same Wi-Fi. The model server
itself does not need to be reachable from the phone — requests go to the same
origin as the page, and Vite forwards them.

> Do not point the app directly at `127.0.0.1:8000`. On a phone that resolves
> to the phone itself. All API calls are deliberately same-origin and relative.

## Attachments

The `+` button offers **Photos** and **Files**. Drag-drop and paste also work.

| Type | Handling | Limit |
| --- | --- | --- |
| Images (png, jpeg, webp…) | Sent as `image_url` content parts — the model sees them | 12 MB each |
| Text and code (`.txt`, `.md`, `.csv`, `.json`, `.py`, `.js`…) | Decoded in the browser and inlined into the prompt | 512 KB, truncated at 120k chars |
| Everything else (pdf, docx, zip, audio) | Rejected with a reason | — |

Gemma is a vision + text model, so PDFs and Office documents are refused rather
than attached and silently ignored. Supporting them needs a text-extraction
step, server- or client-side.

Picking a photo on iOS normally hands over a JPEG even when the library stores
HEIC. If a HEIC does come through, the UI accepts it, but whether it decodes
depends on your model server — convert to JPEG if you hit trouble there.

Persisted conversations keep attachment *metadata* but drop image payloads —
base64 images exhaust the ~5 MB `localStorage` quota within a couple of chats.
Reloaded chats show the filename instead of the image. Moving to IndexedDB
would lift this.

## Configuration

Copy [`.env.example`](.env.example) to `.env` to override defaults.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api` | Backend base URL **as seen by the browser** |
| `VITE_MODEL_ID` | `google/gemma-4-E2B-it` | Fallback until `/health` reports the loaded model |

Both are inlined at **build** time, not read at runtime — changing them
requires a rebuild.

The app prefers whatever `model_id` `/health` reports over `VITE_MODEL_ID`, so
the requested model cannot drift from the one actually loaded.

### Keeping development local

Vite loads env files per **mode**, so dev and production can use different
backends with no code change:

| File | Loaded by |
| --- | --- |
| `.env` | both — **avoid for the API URL** |
| `.env.development[.local]` | `npm run dev` |
| `.env.production[.local]` | `npm run build` |

Put a remote or tunnel URL in `.env.production.local`, never in `.env`:

```bash
# .env.production.local  (gitignored)
VITE_API_BASE_URL=https://your-tunnel.trycloudflare.com
```

`npm run dev` then ignores it and falls back to `/api` → the Vite proxy →
`127.0.0.1:8000`, so local development never leaves the machine. Only
`npm run build` bakes in the remote URL.

Anything ending in `.local` is gitignored — which matters for quick tunnels,
whose hostname changes on every `cloudflared` restart.

## Deployment

`npm run build` emits a static bundle to `dist/`. Serve it behind a reverse
proxy that forwards `/api` to the model server, so the page and the API share
an origin:

```
browser ──► nginx/Caddy ──┬─► /       static files from dist/
                          └─► /api/*  model server (prefix stripped)
```

Same-origin is the recommended setup: no CORS, and no backend address baked
into the bundle. Setting `VITE_API_BASE_URL` to a different origin also works,
but that backend must then send CORS headers.

### Two settings that are easy to miss

Both defaults will break this app specifically:

1. **Disable response buffering.** Streaming is server-sent events. A buffering
   proxy holds the whole response and delivers it in one lump — the reply
   appears to hang, then arrives all at once.
2. **Raise the request body limit.** A 12 MB image is ~16 MB once base64-encoded
   and wrapped in JSON. nginx's default `client_max_body_size` is **1 MB**, so
   image uploads fail with `413` until this is raised.

nginx:

```nginx
server {
    listen 80;
    root /srv/localgpt/dist;

    location / {
        try_files $uri /index.html;   # SPA fallback
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000/;  # trailing slash strips /api

        proxy_buffering off;                # (1) stream SSE through
        proxy_cache off;
        proxy_read_timeout 3600s;           # long generations
        client_max_body_size 32m;           # (2) room for base64 images

        proxy_http_version 1.1;
        proxy_set_header Connection '';
    }
}
```

Caddy handles both automatically:

```caddy
example.com {
    root * /srv/localgpt/dist
    request_body { max_size 32MB }

    handle /api/* {
        uri strip_prefix /api
        reverse_proxy 127.0.0.1:8000
    }

    handle {
        try_files {path} /index.html
        file_server
    }
}
```

Serve over HTTPS if the app is reachable beyond your LAN. Clipboard copy
buttons require a secure context and silently no-op on plain HTTP.

## Project layout

```
src/
  App.jsx                 top-level state, streaming, conversations
  api/gemmaStream.js      SSE client and /health
  components/
    Composer.jsx          input, attach menu, drag-drop/paste
    Markdown.jsx          markdown subset, rendered as React elements
    Message.jsx           user bubbles and assistant messages
    Sidebar.jsx           conversation list and drawer
  lib/
    attachments.js        file classification, limits, API content shaping
    storage.js            localStorage persistence
```

Model output is rendered as React elements, never `dangerouslySetInnerHTML`, so
it cannot inject markup.
