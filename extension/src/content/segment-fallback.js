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
 * The live WebSocket can fail to deliver segments — Redis pub/sub doesn't replay missed
 * messages (instant fake transcriber finishes before the client subscribes), and on real
 * Moodle the page CSP can block the wss:// connection entirely. So this polls the job over
 * HTTP (which goes through the background fetch proxy) until it's done, then backfills the
 * full transcript so the sidebar/caption overlay aren't left empty and the loading banner
 * can clear. Exits early the moment the WebSocket *does* deliver segments.
 *
 * Real transcription takes seconds-to-minutes, so the window is generous (default ~10 min).
 */
export async function fallbackForMissedSegments(api, jobId, sidebar, overlay, attempts = 600, delayMs = 3000) {
  for (let i = 0; i < attempts; i++) {
    if (sidebar.segments.length > 0) return "segments"; // the WebSocket delivered
    let job;
    try {
      job = await api.getJob(jobId);
    } catch {
      job = null; // transient fetch error — keep polling
    }
    if (job && job.status === "completed" && job.text) {
      if (sidebar.segments.length === 0) {
        await backfillCompletedJob(api, jobId, job.text, sidebar, overlay);
      }
      return "completed";
    }
    if (job && job.status === "failed") return "failed";
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return "timeout"; // window elapsed without completion — leave the loading banner up
}
