import { parseSrt } from "./srt-parser.js";

/**
 * A single segment spanning the whole video can't be used to sync captions to the
 * timeline, so prefer the real per-line timestamps from the .srt before falling back
 * to one giant block. Caller environments without `api.srtUrl`/`fetch` (older tests,
 * jobs with no srt yet) silently get the single-block fallback instead.
 */
async function fetchTimestampedSegments(api, jobId) {
  if (typeof api.srtUrl !== "function" || typeof fetch !== "function") return null;
  try {
    const res = await fetch(api.srtUrl(jobId));
    if (!res.ok) return null;
    const segments = parseSrt(await res.text());
    return segments.length > 0 ? segments : null;
  } catch {
    return null;
  }
}

export async function backfillCompletedJob(api, jobId, text, sidebar, overlay) {
  const segments = (await fetchTimestampedSegments(api, jobId)) ?? [
    { text, start: 0, end: Number.MAX_SAFE_INTEGER },
  ];
  segments.forEach((segment) => {
    sidebar.addSegment(segment);
    overlay.addSegment(segment);
  });
}

/**
 * Redis pub/sub doesn't replay missed messages: if the transcription job finishes
 * before the client's WebSocket subscribes (common with the instant fake transcriber),
 * every segment event is published and lost before anyone is listening. This polls the
 * job once it might be done and backfills the transcript so the sidebar/caption overlay
 * aren't left empty.
 */
export async function fallbackForMissedSegments(api, jobId, sidebar, overlay, attempts = 5, delayMs = 400) {
  for (let i = 0; i < attempts; i++) {
    if (sidebar.segments.length > 0) return;
    const job = await api.getJob(jobId);
    if (job.status === "completed" && job.text) {
      if (sidebar.segments.length === 0) {
        await backfillCompletedJob(api, jobId, job.text, sidebar, overlay);
      }
      return;
    }
    if (job.status === "failed") return;
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
