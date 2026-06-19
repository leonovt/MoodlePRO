# MoodlePRO Chrome Extension

Manifest V3 extension that detects BGU Moodle lecture videos (the native video.js /
direct MP4 player), injects a live auto-scrolling transcript sidebar and an on-video
caption overlay, and offers a "Download Transcript" button. Talks to the processing
server directly over REST (job submission/status) and WebSocket (live segments).

## Layout

- `src/content/detect-player.js` — finds the `.vjs-tech` MP4 player + the Moodle numeric video id (pure, DOM-in/DOM-out, no Chrome APIs).
- `src/content/segment-sync.js` — binary search for the active transcript segment given the video's current time.
- `src/content/sidebar.js` / `caption-overlay.js` — DOM rendering, driven by `segment-sync.js`.
- `src/content/inject.js` — wires detection + REST job creation + WebSocket streaming + sidebar/overlay together; the content script entry point.
- `src/background/service-worker.js` — only handles `chrome.downloads` (content scripts can't call it directly).
- `src/shared/api-client.js` — REST/WS URL helpers, used by the content script.

## Build

Content scripts can't use ES module `import` directly, so they're bundled with esbuild:

```bash
npm install
npm run build      # -> dist/content.js, dist/background.js (referenced by manifest.json)
```

Load `chrome://extensions` → Developer mode → "Load unpacked" → select this `extension/` folder.

By default it targets `https://moodle.bgu.ac.il/*` and a local server at
`http://localhost:8000`. Update `manifest.json` `host_permissions` and the
`DEFAULT_SERVER_BASE_URL` constant in `src/content/inject.js` to point at your deployed server.

## Test

```bash
npm test
```

Unit/integration tests use Vitest + jsdom and cover: player detection against real BGU
DOM shapes, segment-sync binary search, the REST client, and the full `inject.js` flow
(fake `WebSocket`/`fetch`/`chrome` — job creation, live segment streaming into the
sidebar/overlay, the cached-transcript fast path, and the download button message).
