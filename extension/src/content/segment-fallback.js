/**
 * Redis pub/sub doesn't replay missed messages: if the transcription job finishes
 * before the client's WebSocket subscribes (common with the instant fake transcriber),
 * every segment event is published and lost before anyone is listening. This polls the
 * job once it might be done and backfills the full transcript as one segment so the
 * sidebar/caption overlay aren't left empty.
 */
export async function fallbackForMissedSegments(api, jobId, sidebar, overlay, attempts = 5, delayMs = 400) {
  for (let i = 0; i < attempts; i++) {
    if (sidebar.segments.length > 0) return;
    const job = await api.getJob(jobId);
    if (job.status === "completed" && job.text) {
      if (sidebar.segments.length === 0) {
        sidebar.addSegment({ text: job.text, start: 0, end: Number.MAX_SAFE_INTEGER });
        overlay.addSegment({ text: job.text, start: 0, end: Number.MAX_SAFE_INTEGER });
      }
      return;
    }
    if (job.status === "failed") return;
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
