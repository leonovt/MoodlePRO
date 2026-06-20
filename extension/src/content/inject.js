import { createApiClient } from "../shared/api-client.js";
import { MSG } from "../shared/messages.js";
import { attachChapters } from "./chapters.js";
import { createCaptionOverlay } from "./caption-overlay.js";
import { injectCourseItemButtons } from "./course-items.js";
import { injectCourseToolbar } from "./course-toolbar.js";
import { findBguVideoPlayer } from "./detect-player.js";
import { fallbackForMissedSegments } from "./segment-fallback.js";
import { createSidebar } from "./sidebar.js";

const DEFAULT_SERVER_BASE_URL = "http://localhost:8000";

function addDownloadButton(doc, sidebar, api, jobId) {
  const button = doc.createElement("button");
  button.textContent = "Download";
  button.style.cssText =
    "display:inline-block;margin-bottom:8px;padding:3px 10px;font-size:12px;cursor:pointer;";
  button.addEventListener("click", () => {
    chrome.runtime.sendMessage({
      type: MSG.DOWNLOAD_TRANSCRIPT,
      txtUrl: api.txtUrl(jobId),
      srtUrl: api.srtUrl(jobId),
    });
  });
  sidebar.panel.insertBefore(button, sidebar.panel.firstChild);
}

function connectJobSocket(api, jobId, onEvent) {
  const socket = new WebSocket(api.wsUrl(jobId));
  socket.addEventListener("message", (event) => onEvent(JSON.parse(event.data)));
  return socket;
}

export async function main(doc = document, serverBaseUrl = DEFAULT_SERVER_BASE_URL) {
  const player = findBguVideoPlayer(doc);

  if (!player) {
    if (doc.querySelector('li[data-for="cmitem"]')) {
      injectCourseItemButtons(doc, serverBaseUrl);
      return null;
    }
    if (doc.querySelector('[data-region="courses-view"]')) {
      injectCourseToolbar(doc, serverBaseUrl);
      return null;
    }
    return null;
  }

  const api = createApiClient(serverBaseUrl);
  const sidebar = createSidebar(doc, player.videoEl);
  const overlay = createCaptionOverlay(doc, player.videoEl);

  const job = await api.createJob({ videoUrl: player.mp4Url, moodleVideoId: player.moodleVideoId });
  addDownloadButton(doc, sidebar, api, job.id);
  attachChapters(doc, api, job.id, player.videoEl).catch(() => {});

  if (job.status === "completed" && job.text) {
    sidebar.addSegment({ text: job.text, start: 0, end: Number.MAX_SAFE_INTEGER });
    overlay.addSegment({ text: job.text, start: 0, end: Number.MAX_SAFE_INTEGER });
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
