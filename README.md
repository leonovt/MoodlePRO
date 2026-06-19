# MoodlePRO

Live Hebrew/English transcription, captions, and downloads for BGU Moodle lecture videos —
a Chrome extension (client) + a self-hosted processing server + a GPU worker running
`faster-whisper` with the `ivrit-ai/whisper-large-v3-turbo-ct2` model.

## Architecture

```
extension/   Manifest V3 Chrome extension — non-AI client (detection, sidebar,
             caption overlay, REST/WS, downloads)
server/      FastAPI — orchestration: download, ffmpeg extraction, SHA-256 dedup,
             Postgres/Redis, job status API, WebSocket relay. Extension point for
             future lecture/assignment summarization.
gpu_worker/  Python worker — pops jobs from Redis, transcribes, streams segments,
             reports completion. Runs FAKE_TRANSCRIBE=true (canned output) until a
             real GPU + the ivrit-ai model are wired up.
shared/      Reference Pydantic schemas documenting the wire contracts between
             server/ and gpu_worker/ (each has its own copy; this is not imported).
```

### Data flow

1. Content script detects the BGU video.js MP4 player, grabs the direct video URL + numeric Moodle video id.
2. `POST /jobs` → server downloads the video, extracts 16kHz mono audio with ffmpeg, hashes it (SHA-256).
3. Hash hit in Postgres → return the cached transcript immediately. Miss → queue the job in Redis, respond with a `job_id`.
4. Client opens `WS /ws/jobs/{job_id}`.
5. GPU worker pops the job, pulls the audio over HTTP (`GET /internal/audio/{id}`, bearer token), transcribes, and publishes each segment to Redis pub/sub as it's produced — the server relays these straight to the websocket.
6. Worker posts the finished transcript (`POST /internal/jobs/{id}/complete`) — server persists it (keyed by audio hash, reused forever) and pushes a final `completed` event.
7. "Download Transcript" hits `GET /jobs/{id}/txt` and `/srt`.

The worker only makes outbound connections (to Redis and to the server's HTTP API), so it
can run on a home GPU machine behind NAT with no port-forwarding.

## Run locally

```bash
# 1. Postgres + Redis + server
cp server/.env.example server/.env   # set INTERNAL_API_TOKEN to match the worker's
docker compose up --build

# 2. GPU worker (stub mode by default, no GPU/model needed)
cd gpu_worker
python -m venv .venv && .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env                 # same INTERNAL_API_TOKEN as the server
python worker.py

# 3. Extension
cd extension
npm install && npm run build
# chrome://extensions -> Developer mode -> Load unpacked -> extension/
```

## Test

Each service has its own test suite (server tests use SQLite + fakeredis instead of
real Postgres/Redis; gpu_worker's integration test runs the real FastAPI server
in-process to verify the queue/HTTP contract end-to-end):

```bash
cd server && python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt && .venv/Scripts/pytest
cd gpu_worker && python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt -r ../server/requirements-dev.txt && .venv/Scripts/pytest
cd extension && npm install && npm test
```

## Status

Runnable end-to-end happy path: submit → download → extract → dedup → queue →
(stub) transcribe → stream → render → download. Not yet built: auth hardening beyond
the shared-secret internal token, retries/backoff, and the summarization feature
(stubbed in `server/app/services/summarizer.py` as an extension point). The GPU worker
ships in stub mode (`FAKE_TRANSCRIBE=true`) until real hardware is wired up.
