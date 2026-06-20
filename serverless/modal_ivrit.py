"""MoodlePRO ivrit.ai transcription endpoint on Modal (serverless GPU).

This runs the Hebrew-finetuned `ivrit-ai/whisper-large-v3-turbo-ct2` model on a
rented GPU that scales to zero when idle — a drop-in alternative to Groq when the
BGU cluster is unavailable. The server's IvritServerlessTranscriber POSTs audio here.

Deploy:
    pip install modal
    modal token new                                  # one-time auth
    modal secret create moodlepro-ivrit IVRIT_API_TOKEN=<a-long-random-token>
    modal deploy serverless/modal_ivrit.py
    # -> prints the web URL; put it in the server's IVRIT_ENDPOINT_URL,
    #    and the same token in IVRIT_API_TOKEN.

Contract (matches app/services/transcribe_ivrit.py):
    POST multipart {file, language}  with  Authorization: Bearer <IVRIT_API_TOKEN>
    -> {"text": str, "segments": [{"text","start","end"}], "language": str}

NOTE: Modal's API evolves. This targets a recent version; if `modal deploy` errors on a
decorator, check your installed Modal docs — older versions used `@modal.web_endpoint`
instead of `@modal.fastapi_endpoint`, and `container_idle_timeout` instead of
`scaledown_window`.
"""
from __future__ import annotations

import modal
from fastapi import File, Form, Header, HTTPException, UploadFile

MODEL_ID = "ivrit-ai/whisper-large-v3-turbo-ct2"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("faster-whisper==1.0.3", "fastapi[standard]")
)

app = modal.App("moodlepro-ivrit", image=image)


@app.cls(
    gpu="a10g",
    scaledown_window=300,       # keep a warm GPU for 5 min after the last request
    secrets=[modal.Secret.from_name("moodlepro-ivrit")],
)
class Transcriber:
    @modal.enter()
    def load(self) -> None:
        from faster_whisper import WhisperModel

        # Downloads the ct2 model from Hugging Face on first cold start, then cached.
        self.model = WhisperModel(MODEL_ID, device="cuda", compute_type="float16")

    @modal.fastapi_endpoint(method="POST")
    async def transcribe(
        self,
        file: UploadFile = File(...),
        language: str = Form("he"),
        authorization: str = Header(default=""),
    ):
        import os
        import tempfile

        # --- auth: require the shared bearer token ---
        expected = os.environ.get("IVRIT_API_TOKEN", "")
        if expected and authorization != f"Bearer {expected}":
            raise HTTPException(status_code=401, detail="invalid or missing token")

        # Persist the upload to a temp file faster-whisper can read.
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(await file.read())
            audio_path = tmp.name

        try:
            segments_iter, info = self.model.transcribe(audio_path, language=language)
            segments = [
                {"text": seg.text.strip(), "start": float(seg.start), "end": float(seg.end)}
                for seg in segments_iter
            ]
        finally:
            os.unlink(audio_path)

        text = " ".join(s["text"] for s in segments)
        return {"text": text, "segments": segments, "language": info.language or language}
