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
             real GPU + the ivrit-ai model are wired up. Primary GPU target is the
             BGU SLURM cluster (persistent 7-day job); Groq is the cloud fallback.
shared/      Reference Pydantic schemas documenting the wire contracts between
             server/ and gpu_worker/ (each has its own copy; this is not imported).
```

### Data flow

1. Content script detects the BGU video.js MP4 player, grabs the direct video URL + numeric Moodle video id.
2. `POST /jobs` → server downloads the video, extracts 16kHz mono audio with ffmpeg, hashes it (SHA-256).
3. Hash hit in Postgres → return the cached transcript immediately. Miss → queue the job in Redis, respond with a `job_id`. A live GPU worker advertises itself via a Redis heartbeat key: if one is present the server waits up to `GROQ_FALLBACK_GRACE_SECONDS` for it to finish, otherwise (no heartbeat) it falls back to Groq (`whisper-large-v3`) immediately. The Groq result is persisted through the same cache (the whole fallback is a no-op when `GROQ_API_KEY` is unset).
4. Client opens `WS /ws/jobs/{job_id}`.
5. GPU worker pops the job, pulls the audio over HTTP (`GET /internal/audio/{id}`, bearer token), transcribes, and publishes each segment to Redis pub/sub as it's produced — the server relays these straight to the websocket.
6. Worker posts the finished transcript (`POST /internal/jobs/{id}/complete`) — server persists it (keyed by audio hash, reused forever) and pushes a final `completed` event.
7. "Download Transcript" hits `GET /jobs/{id}/txt` and `/srt`.

The worker only makes outbound connections (to Redis and to the server's HTTP API), so it
can run on a home GPU machine behind NAT with no port-forwarding.

## Quick look (no Docker/Postgres/Redis/ffmpeg needed)

```bash
cd server && pip install -r requirements-dev.txt
cd ../gpu_worker && pip install -r requirements-dev.txt
cd .. && python demo.py 18   # 18 = simulated video length in seconds
```

Runs the real FastAPI app + real worker code in-process (SQLite + fakeredis instead of
the real services, same trick the test suites use — see `demo.py`), with the video
download/ffmpeg steps stubbed. Prints the job lifecycle and the stub SRT, which loops
its 3 canned Hebrew lines and clips the last segment to match the audio length exactly.

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

## Deploy (production)

`deploy/` holds the always-on stack for the Oracle Cloud Always-Free VM — Postgres + Redis
+ server behind a Caddy HTTPS proxy (`docker compose up -d --build`). It's the host the
cluster GPU worker and the extension connect to. See `deploy/README.md` for VM
provisioning, DNS, firewall, and how the cluster worker connects back.

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
