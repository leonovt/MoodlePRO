import { createApiClient } from "../shared/api-client.js";
import { MSG } from "../shared/messages.js";
import { findBguVideoPlayer } from "./detect-player.js";
import { findCourseMediaLink, fetchAllCourseMediaVideos } from "./course-media.js";
import { scrapeCourseItems } from "./course-scraper.js";

/**
 * The course page's own activity list often doesn't link directly to recordings — BGU routes
 * real lecture videos through a separate "Course media" page (blocks/video/videoslist.php).
 * Prefer that as the source of truth; fall back to scraping lecture activities directly only
 * when a course has no Course media link.
 */
async function getDownloadableLectures(doc) {
  const courseMediaHref = findCourseMediaLink(doc);
  if (courseMediaHref) {
    return fetchAllCourseMediaVideos(courseMediaHref);
  }
  return scrapeCourseItems(doc).filter((item) => item.type === "lecture");
}

export function groupLecturesBySection(items) {
  const groups = new Map();
  items
    .filter((item) => item.type === "lecture")
    .forEach((item) => {
      const key = item.section || "Untitled";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
  return groups;
}

function sanitizeFilename(text) {
  const cleaned = (text ?? "")
    .replace(/[^\w֐-׿\- ]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80);
  return cleaned || "lecture";
}

export async function resolvePlayerForItem(item) {
  if (!item.href) return null;
  const res = await fetch(item.href, { credentials: "same-origin" });
  const html = await res.text();
  const itemDoc = new DOMParser().parseFromString(html, "text/html");
  return findBguVideoPlayer(itemDoc);
}

export async function waitForCompletion(api, jobId, attempts = 30, delayMs = 2000) {
  for (let i = 0; i < attempts; i++) {
    const job = await api.getJob(jobId);
    if (job.status === "completed" || job.status === "failed") return job;
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

export async function downloadLecture(api, item) {
  const player = await resolvePlayerForItem(item);
  if (!player) return { item, status: "failed", reason: "no video found on lecture page" };

  const job = await api.createJob({ videoUrl: player.mp4Url, moodleVideoId: player.moodleVideoId });
  const finalJob = job.status === "completed" ? job : await waitForCompletion(api, job.id);

  if (!finalJob || finalJob.status !== "completed") {
    return { item, status: "failed", reason: finalJob?.error ?? "timed out waiting for transcription" };
  }

  chrome.runtime.sendMessage({
    type: MSG.DOWNLOAD_TRANSCRIPT,
    txtUrl: api.txtUrl(finalJob.id),
    srtUrl: api.srtUrl(finalJob.id),
    filenameBase: sanitizeFilename(item.title),
  });
  return { item, status: "done" };
}

function buildDialog(doc) {
  const existing = doc.getElementById("moodlepro-modal-backdrop");
  if (existing) existing.remove();

  const backdrop = doc.createElement("div");
  backdrop.id = "moodlepro-modal-backdrop";
  backdrop.style.cssText = [
    "position:fixed", "top:0", "left:0", "width:100%", "height:100%",
    "background:rgba(0,0,0,.5)", "z-index:2147483600",
    "display:flex", "align-items:center", "justify-content:center",
  ].join(";");
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) backdrop.remove();
  });

  const box = doc.createElement("div");
  box.id = "moodlepro-modal";
  box.style.cssText = [
    "position:relative", "background:#fff", "color:#111", "max-width:480px",
    "width:90%", "max-height:80vh", "overflow-y:auto", "border-radius:8px",
    "padding:20px", "font-family:sans-serif", "font-size:14px",
    "box-shadow:0 4px 24px rgba(0,0,0,.4)",
  ].join(";");

  const closeButton = doc.createElement("button");
  closeButton.textContent = "×";
  closeButton.style.cssText = [
    "position:absolute", "top:8px", "right:12px", "border:none",
    "background:transparent", "font-size:22px", "line-height:1", "cursor:pointer", "color:#333",
  ].join(";");
  closeButton.addEventListener("click", () => backdrop.remove());
  box.appendChild(closeButton);

  backdrop.appendChild(box);
  doc.body.appendChild(backdrop);
  return box;
}

async function openDownloadDialog(doc, api) {
  const box = buildDialog(doc);

  const heading = doc.createElement("h3");
  heading.textContent = "Download course transcripts";
  heading.style.cssText = "margin-top:0;";
  box.appendChild(heading);

  const loading = doc.createElement("p");
  loading.textContent = "Loading course media...";
  box.appendChild(loading);

  const items = await getDownloadableLectures(doc);
  loading.remove();

  const groups = groupLecturesBySection(items);

  if (groups.size === 0) {
    const empty = doc.createElement("p");
    empty.textContent = "No video lectures were found on this course page.";
    box.appendChild(empty);
    return;
  }

  const hint = doc.createElement("p");
  hint.textContent = "Choose which sections to include (this course groups recordings by professor/TA):";
  hint.style.cssText = "color:#555;font-size:13px;";
  box.appendChild(hint);

  const checkboxEntries = [];
  groups.forEach((lectures, sectionName) => {
    const label = doc.createElement("label");
    label.style.cssText = "display:block;margin:8px 0;cursor:pointer;";
    const checkbox = doc.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    label.appendChild(checkbox);
    label.appendChild(doc.createTextNode(` ${sectionName} (${lectures.length})`));
    box.appendChild(label);
    checkboxEntries.push({ checkbox, lectures });
  });

  const startButton = doc.createElement("button");
  startButton.textContent = "Download Selected";
  startButton.style.cssText = [
    "display:block", "margin-top:16px", "padding:8px 16px", "font-size:13px",
    "border:1px solid #e07a00", "border-radius:4px", "background:#ff9800", "color:#fff",
    "font-weight:600", "cursor:pointer",
  ].join(";");

  const status = doc.createElement("div");
  status.style.cssText = "margin-top:12px;font-size:12px;";

  startButton.addEventListener("click", async () => {
    startButton.disabled = true;
    const selectedLectures = checkboxEntries
      .filter(({ checkbox }) => checkbox.checked)
      .flatMap(({ lectures }) => lectures);

    status.innerHTML = "";
    const rows = new Map();
    selectedLectures.forEach((item) => {
      const row = doc.createElement("div");
      row.textContent = `${item.title} — pending`;
      status.appendChild(row);
      rows.set(item.id, row);
    });

    for (const item of selectedLectures) {
      const row = rows.get(item.id);
      row.textContent = `${item.title} — transcribing…`;
      const result = await downloadLecture(api, item);
      row.textContent =
        result.status === "done" ? `${item.title} — downloaded` : `${item.title} — failed (${result.reason})`;
    }
  });

  box.appendChild(startButton);
  box.appendChild(status);
}

export function injectCourseDownloader(doc, serverBaseUrl) {
  const sectionList = doc.querySelector('ul[data-for="course_sectionlist"]');
  if (!sectionList || !sectionList.parentElement) return;
  if (doc.querySelector('[data-moodlepro-ui="course-downloader"]')) return;

  const api = createApiClient(serverBaseUrl);

  const button = doc.createElement("button");
  button.setAttribute("data-moodlepro-ui", "course-downloader");
  button.textContent = "📥 Download Course Transcripts";
  button.style.cssText = [
    "display:block", "margin:12px 0", "padding:6px 14px", "font-size:13px",
    "border:1px solid #e07a00", "border-radius:4px", "background:#ff9800", "color:#fff",
    "font-weight:600", "cursor:pointer",
  ].join(";");

  button.addEventListener("click", () => openDownloadDialog(doc, api));

  sectionList.parentElement.insertBefore(button, sectionList);
}
