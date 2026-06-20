# ivrit.ai on serverless GPU (Modal) — the cluster-free Hebrew path

This is a **standby** transcription backend: the Hebrew-finetuned
`ivrit-ai/whisper-large-v3-turbo-ct2` running on a **rented, scale-to-zero GPU**
(Modal). It needs neither the BGU cluster nor your own hardware — Modal supplies the
GPU on demand and bills per second.

Use it when: the cluster is down/unstable **and** Groq isn't an option (free-tier cap
hit, dev-tier upgrade unavailable). It gives ivrit.ai-quality Hebrew with pay-as-you-go
billing that works today.

The server selects it via `FALLBACK_PROVIDER=ivrit` — no code change, just env vars.

## Why Modal (vs RunPod)
Pure-Python deploy (`modal deploy file.py`), clean scale-to-zero, no Dockerfile. RunPod
Serverless is a cheaper-per-second alternative but needs a custom worker image — swap to
it later if cost matters. The server side is identical either way (it just POSTs audio).

## Cost (rough)
~$0.06–0.22 per audio-hour depending on GPU + cold starts (30–120s when scaling from
zero). A 2-hour lecture ≈ a few cents. Keep `scaledown_window` low to avoid paying for
idle time; raise it (or use `min_containers=1`) if you want to avoid cold starts during
a launch.

## Deploy

```bash
pip install modal
modal token new                                            # one-time browser auth

# A shared secret the server will send as a bearer token:
modal secret create moodlepro-ivrit IVRIT_API_TOKEN=$(openssl rand -hex 32)

modal deploy serverless/modal_ivrit.py
# -> prints a web URL like https://<you>--moodlepro-ivrit-transcriber-transcribe.modal.run
```

## Wire it into the server (on the Oracle VM)

In `deploy/.env`:

```
FALLBACK_PROVIDER=ivrit
IVRIT_ENDPOINT_URL=https://<the-modal-web-url-from-deploy>
IVRIT_API_TOKEN=<the same value you put in the modal secret>
```

Then `docker compose up -d server`. Cache-miss jobs now go to ivrit.ai instead of Groq.
To switch back: set `FALLBACK_PROVIDER=groq` (or unset) and restart — instant rollback.

## Verify

```bash
curl -X POST "$IVRIT_ENDPOINT_URL" \
  -H "Authorization: Bearer $IVRIT_API_TOKEN" \
  -F "language=he" -F "file=@some-clip.wav"
# -> {"text": "...", "segments": [...], "language": "he"}
```

## Caveats / notes
- **Untested against a live Modal account from here.** Uses `@modal.asgi_app()` with all
  fastapi imports inside the container (Modal runs this file locally to build the app
  graph, and fastapi isn't installed there — a top-level `from fastapi import ...` would
  fail with `ModuleNotFoundError`). If `modal deploy` still errors on a kwarg, your Modal
  may be older: `scaledown_window` was once `container_idle_timeout`. `modal serve
  serverless/modal_ivrit.py` gives a live dev URL to iterate before `deploy`.
- First request after idle pays a **cold start** (model download on the very first run,
  then it's cached in the image layer / volume).
- The server already **chunks** audio over `IVRIT_MAX_UPLOAD_MB` (default 90) and stitches
  the result, so 2-hour lectures work without huge single uploads.
- This is a drop-in via the `TranscriptionProvider` ABC — see
  `server/app/services/transcribe_ivrit.py`.
