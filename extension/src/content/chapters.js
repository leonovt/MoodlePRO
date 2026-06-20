import { createResultModal } from "./result-modal.js";

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

async function fetchChaptersWithRetry(httpBase, jobId, attempts = 8, delayMs = 1000) {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${httpBase}/jobs/${jobId}/chapters`);
    if (res.ok) return res.json();
    // 409 means the transcript isn't stored yet (job still processing) — worth retrying.
    if (res.status !== 409) return null;
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

export async function attachChapters(doc, api, jobId, videoEl, toolbar) {
  const httpBase = api.txtUrl(jobId).replace(/\/jobs\/.*$/, "");

  const chapters = await fetchChaptersWithRetry(httpBase, jobId);
  if (!Array.isArray(chapters) || chapters.length === 0) return null;

  const panel = doc.createElement("div");
  panel.id = "moodlepro-chapters";
  panel.style.cssText = toolbar
    ? [
        "position:absolute", "top:100%", "right:0", "margin-top:4px", "width:280px",
        "max-height:50vh", "overflow-y:auto", "background:#1a1a1a", "color:#eee",
        "font-family:sans-serif", "font-size:13px", "padding:10px",
        "border-radius:8px", "box-shadow:0 1px 4px rgba(0,0,0,.3)", "display:none",
        "z-index:2147483100",
      ].join(";")
    : [
        "margin-top:12px", "max-height:40vh",
        "overflow-y:auto", "background:#1a1a1a", "color:#eee",
        "font-family:sans-serif", "font-size:13px", "padding:10px",
        "border-radius:8px", "box-shadow:0 1px 4px rgba(0,0,0,.3)",
      ].join(";");

  const mountAfter =
    doc.getElementById("moodlepro-sidebar") ??
    (videoEl && typeof videoEl.closest === "function"
      ? videoEl.closest(".block_video-responsive-video") || videoEl.parentElement
      : null);

  chapters.forEach((chapter) => {
    const row = doc.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #333;";

    const titleButton = doc.createElement("button");
    titleButton.textContent = `${chapter.title} (${formatTime(chapter.start)}–${formatTime(chapter.end)})`;
    titleButton.style.cssText = [
      "flex:1", "text-align:left", "background:transparent", "border:none",
      "color:#eee", "cursor:pointer", "font-size:13px", "padding:2px 0",
    ].join(";");
    titleButton.addEventListener("click", () => {
      if (videoEl) videoEl.currentTime = chapter.start;
    });
    row.appendChild(titleButton);

    const summaryButton = doc.createElement("button");
    summaryButton.textContent = "Summary";
    summaryButton.style.cssText =
      "padding:2px 6px;font-size:11px;cursor:pointer;border:1px solid #e07a00;border-radius:3px;background:#ff9800;color:#fff;font-weight:600;";
    summaryButton.addEventListener("click", async () => {
      const modal = createResultModal(doc);
      modal.showLoading();
      try {
        const summaryRes = await fetch(`${httpBase}/jobs/${jobId}/chapters/${chapter.id}/summary`, {
          method: "POST",
        });
        if (!summaryRes.ok) throw new Error(`request failed: ${summaryRes.status}`);
        const data = await summaryRes.json();
        modal.showSummary(data.summary);
      } catch (err) {
        modal.showSummary(`Failed to load: ${err.message}`);
      }
    });
    row.appendChild(summaryButton);

    const quizButton = doc.createElement("button");
    quizButton.textContent = "Quiz";
    quizButton.style.cssText =
      "padding:2px 6px;font-size:11px;cursor:pointer;border:1px solid #e07a00;border-radius:3px;background:#ff9800;color:#fff;font-weight:600;";
    quizButton.addEventListener("click", async () => {
      const modal = createResultModal(doc);
      modal.showLoading();
      try {
        const quizRes = await fetch(`${httpBase}/jobs/${jobId}/chapters/${chapter.id}/quiz`, {
          method: "POST",
        });
        if (!quizRes.ok) throw new Error(`request failed: ${quizRes.status}`);
        const data = await quizRes.json();
        modal.showQuiz(data.questions);
      } catch (err) {
        modal.showSummary(`Failed to load: ${err.message}`);
      }
    });
    row.appendChild(quizButton);

    panel.appendChild(row);
  });

  if (toolbar) {
    toolbar.bar.appendChild(panel);
    toolbar.addButton("Chapters", () => {
      panel.style.display = panel.style.display === "none" ? "block" : "none";
    });
  } else if (mountAfter && mountAfter.insertAdjacentElement) {
    mountAfter.insertAdjacentElement("afterend", panel);
  } else {
    doc.body.appendChild(panel);
  }
  return panel;
}
