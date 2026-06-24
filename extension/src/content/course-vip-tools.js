import { createApiClient } from "../shared/api-client.js";
import { getMoodleUserId } from "./moodle-user.js";
import { findCourseMediaLink, fetchAllCourseMediaVideos } from "./course-media.js";
import { scrapeCourseItems } from "./course-scraper.js";
import { resolveResourceFile } from "./resource-file.js";
import { resolvePlayerForItem, waitForCompletion } from "./course-downloader.js";
import { buildZip } from "./zip.js";
import { COLORS, addHoverEffect } from "./theme.js";

// How long the ZIP flow waits for a single lecture to transcribe before treating it as
// "still processing": 90 polls × 10s ≈ 15 minutes, comfortably past the server's 300s
// cluster grace period plus typical cluster/Groq transcription time.
const LECTURE_WAIT_ATTEMPTS = 90;
const LECTURE_WAIT_DELAY_MS = 10000;

/** These two power-user exports are only worth showing to unlimited (VIP) accounts. */
async function isUnlimited(api, userId) {
  try {
    const usage = await api.getUsage(userId);
    return !!(usage && usage.unlimited);
  } catch {
    return false;
  }
}

function courseName(doc) {
  const heading = doc.querySelector(".page-header-headings h1, #page-header h1");
  const name = heading ? heading.textContent.trim() : doc.title || "course";
  return name;
}

function sanitizeFilename(text, fallback = "file") {
  const cleaned = (text ?? "")
    .replace(/[^\w֐-׿\-. ]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80);
  return cleaned || fallback;
}

/** Ensure each ZIP entry name is unique (a course can have several "slides.pdf"). */
function uniqueName(used, name) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let i = 2;
  let candidate;
  do {
    candidate = `${base} (${i})${ext}`;
    i++;
  } while (used.has(candidate));
  used.add(candidate);
  return candidate;
}

function downloadZip(doc, entries, filename) {
  // Download straight from the content script via a Blob URL + anchor click. A documents
  // ZIP can be tens of MB; routing it to the service worker as a base64 data: URL hit
  // message-size and chrome.downloads data:-URL limits and failed silently.
  const bytes = buildZip(entries);
  const blob = new Blob([bytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  doc.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

// --- shared modal chrome ---------------------------------------------------

function buildModal(doc, titleText) {
  const existing = doc.getElementById("moodlepro-vip-backdrop");
  if (existing) existing.remove();

  const backdrop = doc.createElement("div");
  backdrop.id = "moodlepro-vip-backdrop";
  backdrop.setAttribute("data-moodlepro-ui", "1");
  backdrop.style.cssText = [
    "position:fixed", "top:0", "left:0", "width:100%", "height:100%",
    "background:rgba(0,0,0,.5)", "z-index:2147483600",
    "display:flex", "align-items:center", "justify-content:center",
  ].join(";");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  const box = doc.createElement("div");
  box.style.cssText = [
    "position:relative", "background:#fff", "color:#111", "max-width:480px", "width:90%",
    "max-height:80vh", "overflow-y:auto", "border-radius:8px", "padding:20px",
    "font-family:sans-serif", "font-size:14px", "box-shadow:0 4px 24px rgba(0,0,0,.4)",
  ].join(";");

  const close = doc.createElement("button");
  close.textContent = "×";
  close.style.cssText = [
    "position:absolute", "top:8px", "right:12px", "border:none", "background:transparent",
    "font-size:22px", "line-height:1", "cursor:pointer", "color:#333",
  ].join(";");
  close.addEventListener("click", () => backdrop.remove());
  box.appendChild(close);

  const heading = doc.createElement("h3");
  heading.textContent = titleText;
  heading.style.cssText = "margin:0 0 12px; font-size:16px;";
  box.appendChild(heading);

  backdrop.appendChild(box);
  doc.body.appendChild(backdrop);
  return { backdrop, box };
}

function primaryButton(doc, label) {
  const btn = doc.createElement("button");
  btn.textContent = label;
  btn.style.cssText = [
    "margin-top:16px", "padding:8px 16px", "font-size:13px",
    "border:1px solid " + COLORS.orangeDeep, "border-radius:6px",
    "background:" + COLORS.orange, "color:#fff", "font-weight:600", "cursor:pointer",
    "transition:background .15s ease",
  ].join(";");
  addHoverEffect(btn, COLORS.orange, COLORS.orangeDeep);
  return btn;
}

// --- button 1: per-lecturer transcript ZIP --------------------------------

async function getCourseLectures(doc) {
  const courseMediaHref = findCourseMediaLink(doc);
  if (courseMediaHref) return fetchAllCourseMediaVideos(courseMediaHref);
  return scrapeCourseItems(doc).filter((item) => item.type === "lecture");
}

function groupByOwner(lectures) {
  const groups = new Map();
  lectures.forEach((lec) => {
    const key = lec.section || "Untitled";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(lec);
  });
  return groups;
}

async function transcribeToText(api, item, userId) {
  const player = await resolvePlayerForItem(item);
  if (!player) return { status: "failed", reason: "no video found" };

  const job = await api.createJob({
    videoUrl: player.mp4Url,
    moodleVideoId: player.moodleVideoId,
    userId,
  });
  // A real lecture takes several minutes on the cluster (the server's own grace period
  // before it even considers the Groq fallback is 300s), so a short client wait would
  // give up while the job is still happily transcribing. Wait generously.
  const finalJob =
    job.status === "completed"
      ? job
      : await waitForCompletion(api, job.id, LECTURE_WAIT_ATTEMPTS, LECTURE_WAIT_DELAY_MS);
  if (!finalJob) {
    // Timed out on our side — the job keeps running server-side and the transcript will be
    // cached, so a re-run picks it up instantly. Not a hard failure.
    return { status: "pending", reason: "עדיין מתמלל — יהיה מוכן בהרצה הבאה" };
  }
  if (finalJob.status !== "completed") {
    return { status: "failed", reason: finalJob.error ?? "failed" };
  }

  let text = finalJob.text;
  if (!text) {
    const res = await fetch(api.txtUrl(finalJob.id));
    text = await res.text();
  }
  return { status: "done", text: text ?? "", fromCache: !!finalJob.from_cache };
}

async function openLecturerDialog(doc, api, userId) {
  const { box } = buildModal(doc, "📥 ZIP של תמלולי מרצה");

  const loading = doc.createElement("p");
  loading.textContent = "טוען את רשימת ההרצאות…";
  box.appendChild(loading);

  const lectures = await getCourseLectures(doc);
  loading.remove();

  const groups = groupByOwner(lectures);
  if (groups.size === 0) {
    const empty = doc.createElement("p");
    empty.textContent = "לא נמצאו הרצאות מוקלטות בקורס הזה.";
    box.appendChild(empty);
    return;
  }

  const hint = doc.createElement("p");
  hint.textContent = "בחרו מרצה / מתרגל. כל ההרצאות שלו יתומללו (כולל כאלה שעוד לא תומללו) ויארזו ל-ZIP:";
  hint.style.cssText = "color:#555; font-size:13px;";
  box.appendChild(hint);

  const list = doc.createElement("div");
  list.id = "moodlepro-lecturer-list";
  list.style.cssText = "display:flex; flex-direction:column; gap:6px; max-height:220px; overflow-y:auto;";

  let firstRadio = null;
  groups.forEach((owners, ownerName) => {
    const label = doc.createElement("label");
    label.style.cssText = "display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px;";
    const radio = doc.createElement("input");
    radio.type = "radio";
    radio.name = "moodlepro-lecturer";
    radio.value = ownerName;
    if (!firstRadio) {
      radio.checked = true;
      firstRadio = radio;
    }
    label.appendChild(radio);
    label.appendChild(doc.createTextNode(` ${ownerName} (${owners.length})`));
    list.appendChild(label);
  });
  box.appendChild(list);

  const status = doc.createElement("div");
  status.style.cssText = "margin-top:12px; font-size:12px; display:flex; flex-direction:column; gap:2px;";

  const startBtn = primaryButton(doc, "צור ZIP");
  startBtn.addEventListener("click", async () => {
    const selected = list.querySelector('input[name="moodlepro-lecturer"]:checked');
    if (!selected) return;
    const ownerName = selected.value;
    const ownerLectures = groups.get(ownerName) || [];

    startBtn.disabled = true;
    list.style.display = "none";
    status.innerHTML = "";

    const rows = new Map();
    ownerLectures.forEach((item) => {
      const row = doc.createElement("div");
      row.textContent = `${item.title} — ממתין`;
      status.appendChild(row);
      rows.set(item.id, row);
    });

    const entries = [];
    const usedNames = new Set();
    let pending = 0;
    let failed = 0;
    for (const item of ownerLectures) {
      const row = rows.get(item.id);
      row.textContent = `${item.title} — מתמלל…`;
      try {
        const result = await transcribeToText(api, item, userId);
        if (result.status === "done") {
          const name = uniqueName(usedNames, `${sanitizeFilename(item.title, "lecture")}.txt`);
          entries.push({ name, bytes: result.text });
          row.textContent = `${item.title} — הושלם`;
        } else if (result.status === "pending") {
          pending++;
          row.textContent = `${item.title} — ${result.reason}`;
        } else {
          failed++;
          row.textContent = `${item.title} — נכשל (${result.reason})`;
        }
      } catch (err) {
        failed++;
        row.textContent = `${item.title} — נכשל (${err.message})`;
      }
    }

    const notes = [];
    if (pending) notes.push(`${pending} עדיין מתמללים — הריצו שוב מאוחר יותר להשלמה`);
    if (failed) notes.push(`${failed} נכשלו`);
    const suffix = notes.length ? ` (${notes.join("; ")})` : "";

    if (entries.length === 0) {
      const done = doc.createElement("div");
      done.textContent = `לא הופקו תמלולים — ה-ZIP לא נוצר${suffix}.`;
      done.style.cssText = "margin-top:8px; font-weight:600;";
      status.appendChild(done);
      return;
    }

    const filename = `${sanitizeFilename(courseName(doc), "course")}_${sanitizeFilename(ownerName, "lecturer")}_transcripts.zip`;
    downloadZip(doc, entries, filename);

    const done = doc.createElement("div");
    done.textContent = `✅ נוצר ZIP עם ${entries.length} תמלולים${suffix}.`;
    done.style.cssText = "margin-top:8px; font-weight:600;";
    status.appendChild(done);
  });

  box.appendChild(startBtn);
  box.appendChild(status);
}

// --- button 2: all-documents ZIP ------------------------------------------

async function openDocumentsDialog(doc, api) {
  const { box } = buildModal(doc, "📦 ZIP של כל מסמכי הקורס");

  const items = scrapeCourseItems(doc).filter(
    (item) => (item.type === "slides" || item.type === "assignment") && item.href
  );

  if (items.length === 0) {
    const empty = doc.createElement("p");
    empty.textContent = "לא נמצאו מסמכים להורדה בקורס הזה.";
    box.appendChild(empty);
    return;
  }

  const hint = doc.createElement("p");
  hint.textContent = `נמצאו ${items.length} פריטים. כל המסמכים הזמינים יורדו ויארזו ל-ZIP:`;
  hint.style.cssText = "color:#555; font-size:13px;";
  box.appendChild(hint);

  const status = doc.createElement("div");
  status.style.cssText = "margin-top:12px; font-size:12px; display:flex; flex-direction:column; gap:2px;";

  const startBtn = primaryButton(doc, "צור ZIP");
  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    status.innerHTML = "";

    const rows = new Map();
    items.forEach((item) => {
      const row = doc.createElement("div");
      row.textContent = `${item.title} — ממתין`;
      status.appendChild(row);
      rows.set(item.id, row);
    });

    const entries = [];
    const usedNames = new Set();
    let skipped = 0;
    for (const item of items) {
      const row = rows.get(item.id);
      row.textContent = `${item.title} — מוריד…`;
      try {
        const file = await resolveResourceFile(item.href);
        if (!file || !file.buffer) {
          row.textContent = `${item.title} — דולג (אין קובץ)`;
          skipped++;
          continue;
        }
        const rawName = file.filename || `${sanitizeFilename(item.title, "document")}`;
        const name = uniqueName(usedNames, rawName);
        entries.push({ name, bytes: new Uint8Array(file.buffer) });
        row.textContent = `${item.title} — נוסף`;
      } catch (err) {
        row.textContent = `${item.title} — דולג (${err.message})`;
        skipped++;
      }
    }

    if (entries.length === 0) {
      const done = doc.createElement("div");
      done.textContent = "לא הורדו מסמכים — ה-ZIP לא נוצר.";
      done.style.cssText = "margin-top:8px; font-weight:600;";
      status.appendChild(done);
      return;
    }

    const filename = `${sanitizeFilename(courseName(doc), "course")}_documents.zip`;
    downloadZip(doc, entries, filename);

    const done = doc.createElement("div");
    done.textContent = `✅ נוצר ZIP עם ${entries.length} מסמכים${skipped ? ` (${skipped} דולגו)` : ""}.`;
    done.style.cssText = "margin-top:8px; font-weight:600;";
    status.appendChild(done);
  });

  box.appendChild(startBtn);
  box.appendChild(status);
}

// --- button 3: clear this course's transcript cache -----------------------

async function openPurgeDialog(doc, api, userId) {
  const { box } = buildModal(doc, "🗑️ ניקוי קאש תמלולים של הקורס");

  const loading = doc.createElement("p");
  loading.textContent = "טוען את רשימת ההרצאות…";
  box.appendChild(loading);

  const lectures = await getCourseLectures(doc);
  loading.remove();

  if (lectures.length === 0) {
    const empty = doc.createElement("p");
    empty.textContent = "לא נמצאו הרצאות בקורס הזה.";
    box.appendChild(empty);
    return;
  }

  const hint = doc.createElement("p");
  hint.textContent =
    `יימחקו מהקאש התמלולים השמורים של ${lectures.length} הרצאות בקורס זה, כדי שיתומללו מחדש. ` +
    "(לא נמחקים קבצים או וידאו — רק תמלולים שמורים.)";
  hint.style.cssText = "color:#555; font-size:13px;";
  box.appendChild(hint);

  const status = doc.createElement("div");
  status.style.cssText = "margin-top:12px; font-size:12px; display:flex; flex-direction:column; gap:2px;";

  const startBtn = primaryButton(doc, "נקה קאש");
  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    status.innerHTML = "";

    const progress = doc.createElement("div");
    status.appendChild(progress);

    // The cache is keyed by the lecture's real video id, which lives on the player page —
    // resolve each lecture to collect those ids (same source the transcribe flow uses).
    const ids = [];
    let resolved = 0;
    for (const item of lectures) {
      try {
        const player = await resolvePlayerForItem(item);
        if (player && player.moodleVideoId) ids.push(player.moodleVideoId);
      } catch {
        /* skip lectures whose player can't be resolved */
      }
      resolved++;
      progress.textContent = `מאתר מזהי וידאו… (${resolved}/${lectures.length})`;
    }

    if (ids.length === 0) {
      progress.textContent = "לא נמצאו מזהי וידאו — לא נמחק דבר.";
      return;
    }

    progress.textContent = "מנקה קאש…";
    try {
      const result = await api.purgeCache(userId, ids);
      progress.textContent =
        `✅ נמחקו ${result.deleted_transcripts} תמלולים מהקאש (מתוך ${ids.length} הרצאות). ` +
        "כעת אפשר לתמלל מחדש.";
    } catch (err) {
      progress.textContent = `נכשל: ${err.message}`;
    }
  });

  box.appendChild(startBtn);
  box.appendChild(status);
}

// --- injection -------------------------------------------------------------

export async function injectCourseVipTools(doc, serverBaseUrl, { api, userId } = {}) {
  const target = doc.querySelector(".page-header-headings") || doc.querySelector("#page-header");
  if (!target) return;
  if (target.querySelector('[data-moodlepro-ui="course-vip-toolbar"]')) return;

  const client = api || createApiClient(serverBaseUrl);
  const uid = userId || getMoodleUserId(doc);
  if (!uid) return;

  if (!(await isUnlimited(client, uid))) return;

  // Re-check the guard: the awaited usage call gives another injection a chance to win.
  if (target.querySelector('[data-moodlepro-ui="course-vip-toolbar"]')) return;

  const toolbar = doc.createElement("div");
  toolbar.setAttribute("data-moodlepro-ui", "course-vip-toolbar");
  toolbar.style.cssText = "display:inline-flex; align-items:center; margin-left:15px; margin-top:5px; vertical-align:middle; gap:8px;";

  const makeButton = (label, bg, fg) => {
    const btn = doc.createElement("button");
    btn.textContent = label;
    btn.style.cssText = [
      "padding:6px 12px", "font-size:12px", "border:1px solid " + COLORS.orangeDeep,
      "border-radius:6px", "background:" + bg, "color:" + fg, "font-weight:600", "cursor:pointer",
      "transition:background .15s ease",
    ].join(";");
    return btn;
  };

  const lecturerBtn = makeButton("🎓 ZIP תמלולי מרצה", COLORS.orange, "#fff");
  addHoverEffect(lecturerBtn, COLORS.orange, COLORS.orangeDeep);
  lecturerBtn.addEventListener("click", () => {
    openLecturerDialog(doc, client, uid).catch(() => {});
  });

  const documentsBtn = makeButton("📦 ZIP מסמכי קורס", COLORS.orangeLight, COLORS.dark);
  addHoverEffect(documentsBtn, COLORS.orangeLight, COLORS.orange);
  documentsBtn.addEventListener("click", () => {
    openDocumentsDialog(doc, client).catch(() => {});
  });

  const purgeBtn = makeButton("🗑️ נקה קאש קורס", COLORS.orangeLight, COLORS.dark);
  addHoverEffect(purgeBtn, COLORS.orangeLight, COLORS.orange);
  purgeBtn.addEventListener("click", () => {
    openPurgeDialog(doc, client, uid).catch(() => {});
  });

  toolbar.appendChild(lecturerBtn);
  toolbar.appendChild(documentsBtn);
  toolbar.appendChild(purgeBtn);
  target.appendChild(toolbar);
}
