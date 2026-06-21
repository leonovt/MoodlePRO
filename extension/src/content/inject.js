import { createApiClient } from "../shared/api-client.js";
import { MSG } from "../shared/messages.js";
import { attachChapters } from "./chapters.js";
import { replaceBguLogo } from "./brand-logo.js";
import { createCaptionOverlay } from "./caption-overlay.js";
import { injectCourseItemButtons } from "./course-items.js";
import { findBguVideoPlayer } from "./detect-player.js";
import { injectFeedbackButton } from "./feedback.js";
import { getMoodleUserId } from "./moodle-user.js";
import { showQuotaPrompt } from "./quota-prompt.js";
import { backfillCompletedJob, fallbackForMissedSegments } from "./segment-fallback.js";
import { createSidebar } from "./sidebar.js";
import { createStatusBanner } from "./status-banner.js";
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
  replaceBguLogo(doc);
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
  const userId = getMoodleUserId(doc);
  const toolbar = createVideoToolbar(doc, player.videoEl);
  const status = createStatusBanner(doc, player.videoEl);

  let started = false;
  let context = null;

  // #3: subtitles/transcript are NOT generated automatically — the user starts them.
  async function start() {
    if (started) return context;
    started = true;
    startButton.disabled = true;
    startButton.textContent = "מתמלל…";
    status.showLoading("מתמלל את ההרצאה… זה עשוי לקחת רגע");

    try {
      const sidebar = createSidebar(doc, player.videoEl);
      const overlay = createCaptionOverlay(doc, player.videoEl);
      const job = await api.createJob({
        videoUrl: player.mp4Url,
        moodleVideoId: player.moodleVideoId,
        userId,
      });

      addDownloadButton(doc, toolbar, api, job.id);
      addSubtitleControls(toolbar, overlay);
      attachChapters(doc, api, job.id, player.videoEl, toolbar).catch(() => {});
      startButton.remove();

      if (job.status === "completed" && job.text) {
        await backfillCompletedJob(api, job.id, job.text, sidebar, overlay);
        if (job.from_cache) {
          status.showInfo("🎁 ההרצאה הזו על חשבון הבית — לא ירדו לך קרדיטים!");
        } else {
          status.hide();
        }
        context = { player, api, job, socket: null, sidebar, overlay, status };
        return context;
      }

      const socket = connectJobSocket(api, job.id, (event) => {
        if (event.type === "segment") {
          status.hide(); // first words arrived
          sidebar.addSegment(event);
          overlay.addSegment(event);
        } else if (event.type === "failed") {
          status.showError("התמלול נכשל. נסו שוב מאוחר יותר.");
        }
      });
      fallbackForMissedSegments(api, job.id, sidebar, overlay).catch(() => {});

      context = { player, api, job, socket, sidebar, overlay, status };
      return context;
    } catch (err) {
      started = false;
      startButton.disabled = false;
      startButton.textContent = "הצג כתוביות";

      if (err && err.status === 403) {
        // Lecture quota reached — offer the honor-system review path, then retry.
        status.hide();
        showQuotaPrompt(doc, {
          onReviewed: async () => {
            if (userId) await api.claimReview(userId);
            await start();
          },
        });
      } else {
        // #2: surface failures instead of failing silently, and let the user retry.
        status.showError("שגיאה בהפעלת התמלול. בדקו את החיבור ונסו שוב.");
      }
      throw err;
    }
  }

  const startButton = toolbar.addButton("הצג כתוביות", () => {
    start().catch(() => {});
  });

  return { player, api, toolbar, status, start };
}

if (typeof window !== "undefined" && !window.__moodleproTest) {
  main();
}
