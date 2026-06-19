from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Transcript


async def find_transcript(session: AsyncSession, audio_hash: str) -> Transcript | None:
    return await session.get(Transcript, audio_hash)


async def save_transcript(
    session: AsyncSession, audio_hash: str, text: str, srt: str, language: str = "he"
) -> Transcript:
    existing = await find_transcript(session, audio_hash)
    if existing is not None:
        return existing

    transcript = Transcript(audio_hash=audio_hash, text=text, srt=srt, language=language)
    session.add(transcript)
    await session.flush()
    return transcript
