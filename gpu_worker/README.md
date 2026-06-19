# MoodlePRO GPU Worker

Pops transcription jobs off the server's Redis queue, transcribes the audio, and reports
results back to the server. Designed to run on a machine with no public inbound access
(e.g. a home PC with an RTX 4090 behind NAT) — it only makes outbound connections to
Redis and to the server's HTTP API.

## Status: stub mode by default

`FAKE_TRANSCRIBE=true` (the default) makes the worker emit a few canned Hebrew segments
instead of loading a real model, so the full queue → stream → complete pipeline can be
built and tested without CUDA or `faster-whisper` installed. Flip it off on the real GPU
box once `faster-whisper` + the `ivrit-ai/whisper-large-v3-turbo-ct2` model are installed.

## Run

```bash
python -m venv .venv && .venv/Scripts/activate  # or source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # point at your server + shared INTERNAL_API_TOKEN
python worker.py
```

For real transcription, uncomment `faster-whisper` in `requirements.txt`, install CUDA
drivers, and set `FAKE_TRANSCRIBE=false`.

## Test

```bash
pip install -r requirements-dev.txt -r ../server/requirements-dev.txt
pytest
```

`tests/test_integration.py` runs the real FastAPI server in-process (ASGI transport, no
network) alongside this worker's `run_once` loop and fakeredis, to verify the queue/HTTP
contract between the two services end-to-end.
