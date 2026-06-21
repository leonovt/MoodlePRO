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
import { createUsageBadge } from "./usage-badge.js";
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

function installFetchProxy(serverBaseUrl) {
  // Only in a real loaded extension (chrome.runtime.id is set). Under vitest the
  // page's window.fetch is a mock we must not monkeypatch, or every test hangs.
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) return;

  const originalFetch = window.fetch;
  const base = serverBaseUrl.replace(/\/$/, "");
  console.log("🚀 MoodlePRO: Fetch proxy installed for", base);
  
  window.fetch = async function (url, options) {
    const urlStr = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString();
    if (urlStr.startsWith(base)) {
      console.log("🚀 MoodlePRO: Intercepted fetch to", urlStr);
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "PROXY_FETCH_RAW", url: urlStr, options },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error("Fetch Proxy Error (IPC):", chrome.runtime.lastError);
              return reject(new TypeError("Failed to fetch (Proxy IPC error)"));
            }
            if (response.error) {
              console.error("Fetch Proxy Error (Network):", response.error);
              return reject(new TypeError(`Failed to fetch (Proxy Network error): ${response.error}`));
            }
            resolve({
              ok: response.status >= 200 && response.status < 300,
              status: response.status,
              json: async () => response.data,
              text: async () => response.text,
              headers: new Headers(response.headers || {}),
            });
          }
        );
      });
    }
    return originalFetch.apply(this, arguments);
  };
}

export async function main(doc = document, serverBaseUrl = DEFAULT_SERVER_BASE_URL) {
  if (typeof window !== "undefined") {
    installFetchProxy(serverBaseUrl);
  }
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

  // Show the user how many free lectures (credits) they have left. Best-effort: needs a
  // Moodle user id, and a failure here must never block transcription.
  let usageBadge = null;
  async function refreshUsage(usage) {
    if (!userId) return;
    try {
      const data = usage ?? (await api.getUsage(userId));
      if (!usageBadge) usageBadge = createUsageBadge(doc, toolbar);
      usageBadge.update(data);
    } catch {
      /* usage badge is decorative; ignore */
    }
  }
  refreshUsage();

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
      refreshUsage(); // a credit may have been consumed (no-op for cache hits)

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
        } else if (event.type === "completed") {
          status.hide(); // done — covers jobs that finish without live segment events
        } else if (event.type === "failed") {
          status.showError("התמלול נכשל. נסו שוב מאוחר יותר.");
        }
      });
      // The live WebSocket can fail to deliver (page CSP blocks wss://), so this poller is
      // what actually clears the loading banner: hide on completion (even if the backfill
      // produced no segments), show an error on failure, and only leave the banner up if the
      // window elapsed without finishing.
      fallbackForMissedSegments(api, job.id, sidebar, overlay)
        .then((outcome) => {
          if (outcome === "failed") {
            status.showError("התמלול נכשל. נסו שוב מאוחר יותר.");
          } else if (outcome === "completed" || outcome === "segments") {
            status.hide();
          }
        })
        .catch(() => {});

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
          onReviewed: async ({ username, referredBy } = {}) => {
            if (!userId) return null;
            const usageData = await api.claimReview(userId, { username, referredBy });
            await refreshUsage(usageData);
            return usageData;
          },
          onContinue: () => start().catch(() => {}),
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
