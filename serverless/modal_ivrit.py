"""MoodlePRO ivrit.ai transcription endpoint on Modal (serverless GPU).

This runs the Hebrew-finetuned `ivrit-ai/whisper-large-v3-turbo-ct2` model on a
rented GPU that scales to zero when idle — a drop-in alternative to Groq when the
BGU cluster is unavailable. The server's IvritServerlessTranscriber POSTs audio here.

Deploy:
    pip install modal
    modal token new                                  # one-time auth
    modal secret create moodlepro-ivrit IVRIT_API_TOKEN=<a-long-random-token>
    modal serve serverless/modal_ivrit.py            # live test (temp URL)
    modal deploy serverless/modal_ivrit.py           # prints the permanent web URL

Put that URL in the server's IVRIT_ENDPOINT_URL and the same token in IVRIT_API_TOKEN.

Contract (matches app/services/transcribe_ivrit.py):
    POST multipart {file, language}  to the URL  with  Authorization: Bearer <token>
    -> {"text": str, "segments": [{"text","start","end"}], "language": str}

All web-framework imports live INSIDE web() so they only run in the container — Modal
executes this file locally to build the app graph, and fastapi isn't installed there.
"""
import modal

MODEL_ID = "ivrit-ai/whisper-large-v3-turbo-ct2"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("faster-whisper==1.0.3", "fastapi[standard]")
)

app = modal.App("moodlepro-ivrit", image=image)


@app.function(
    gpu="a10g",
    scaledown_window=300,  # keep a warm GPU 5 min after the last request
    secrets=[modal.Secret.from_name("moodlepro-ivrit")],
)
@modal.asgi_app()
def web():
    # Everything below runs in the container (once per cold start), not on your laptop.
    import os
    import tempfile

    from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
    from faster_whisper import WhisperModel

    # Loads the ct2 model from Hugging Face on first cold start, then it's cached.
    model = WhisperModel(MODEL_ID, device="cuda", compute_type="float16")
    api = FastAPI()

    @api.post("/")
    async def transcribe(
        file: UploadFile = File(...),
        language: str = Form("he"),
        authorization: str = Header(default=""),
    ):
        expected = os.environ.get("IVRIT_API_TOKEN", "")
        if expected and authorization != f"Bearer {expected}":
            raise HTTPException(status_code=401, detail="invalid or missing token")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(await file.read())
            audio_path = tmp.name
        try:
            segments_iter, info = model.transcribe(audio_path, language=language)
            segments = [
                {"text": s.text.strip(), "start": float(s.start), "end": float(s.end)}
                for s in segments_iter
            ]
        finally:
            os.unlink(audio_path)

        text = " ".join(s["text"] for s in segments)
        return {"text": text, "segments": segments, "language": info.language or language}

    return api
