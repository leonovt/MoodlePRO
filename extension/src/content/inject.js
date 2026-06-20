import { createApiClient } from "../shared/api-client.js";
import { MSG } from "../shared/messages.js";
import { attachChapters } from "./chapters.js";
import { createCaptionOverlay } from "./caption-overlay.js";
import { injectCourseItemButtons } from "./course-items.js";
import { findBguVideoPlayer } from "./detect-player.js";
import { injectFeedbackButton } from "./feedback.js";
import { backfillCompletedJob, fallbackForMissedSegments } from "./segment-fallback.js";
import { createSidebar } from "./sidebar.js";
import { createVideoToolbar } from "./video-toolbar.js";

// Injected at build time by build.js (defaults to the production server). Falls back to
// localhost when not defined — i.e. under vitest/dev, where the define isn't applied.
const DEFAULT_SERVER_BASE_URL =
  typeof __SERVER_BASE_URL__ !== "undefined" ? __SERVER_BASE_URL__ : "http://localhost:8000";

function addDownloadButton(doc, toolbar, api, jobId) {
  toolbar.addButton("Download", () => {
    chrome.runtime.sendMessage({
      type: MSG.DOWNLOAD_TRANSCRIPT,
      txtUrl: api.txtUrl(jobId),
      srtUrl: api.srtUrl(jobId),
    });
  });
}

function addSubtitleControls(toolbar, overlay) {
  const toggleBtn = toolbar.addButton("Hide subtitles", () => {
    const visible = overlay.toggle();
    toggleBtn.textContent = visible ? "Hide subtitles" : "Show subtitles";
  });
  toolbar.addButton("A+", () => overlay.changeFontSize(2));
  toolbar.addButton("A−", () => overlay.changeFontSize(-2));
}

function connectJobSocket(api, jobId, onEvent) {
  const socket = new WebSocket(api.wsUrl(jobId));
  socket.addEventListener("message", (event) => onEvent(JSON.parse(event.data)));
  return socket;
}

export async function main(doc = document, serverBaseUrl = DEFAULT_SERVER_BASE_URL) {
  injectFeedbackButton(doc);

  const player = findBguVideoPlayer(doc);

  if (!player) {
    if (doc.querySelector('li[data-for="cmitem"]')) {
      injectCourseItemButtons(doc, serverBaseUrl);
      return null;
    }
    return null;
  }

  const api = createApiClient(serverBaseUrl);
  const sidebar = createSidebar(doc, player.videoEl);
  const overlay = createCaptionOverlay(doc, player.videoEl);
  const toolbar = createVideoToolbar(doc, player.videoEl);

  const job = await api.createJob({ videoUrl: player.mp4Url, moodleVideoId: player.moodleVideoId });
  addDownloadButton(doc, toolbar, api, job.id);
  addSubtitleControls(toolbar, overlay);
  attachChapters(doc, api, job.id, player.videoEl, toolbar).catch(() => {});

  if (job.status === "completed" && job.text) {
    await backfillCompletedJob(api, job.id, job.text, sidebar, overlay);
    return { player, api, job, socket: null };
  }

  const socket = connectJobSocket(api, job.id, (event) => {
    if (event.type === "segment") {
      sidebar.addSegment(event);
      overlay.addSegment(event);
    }
  });
  fallbackForMissedSegments(api, job.id, sidebar, overlay).catch(() => {});

  return { player, api, job, socket, sidebar, overlay };
}

if (typeof window !== "undefined" && !window.__moodleproTest) {
  main();
}
