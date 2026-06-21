import { findActiveSegmentIndex } from "./segment-sync.js";
import { COLORS, addHoverEffect } from "./theme.js";

/** Downloads `text` as a local .txt file with no server round-trip. */
function downloadAsTextFile(doc, text, filename) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = url;
  link.download = filename;
  doc.body.appendChild(link);
  link.click();
  doc.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Injects an in-page, auto-scrolling transcript panel right below the video and keeps it in sync. */
export function createSidebar(doc, videoEl) {
  const wrapper = doc.createElement("div");
  wrapper.id = "moodlepro-sidebar-wrapper";

  const downloadButton = doc.createElement("button");
  downloadButton.id = "moodlepro-sidebar-download";
  downloadButton.textContent = "⬇ Download transcript";
  downloadButton.style.cssText = [
    "margin-top:12px", "padding:6px 12px", "border:1px solid " + COLORS.border,
    "border-radius:6px", "background:" + COLORS.orange, "color:#fff !important",
    "font-size:13px", "cursor:pointer", "display:block",
  ].join(";");
  addHoverEffect(downloadButton, COLORS.orange, COLORS.orangeDeep);

  const panel = doc.createElement("div");
  panel.id = "moodlepro-sidebar";
  panel.style.cssText = [
    "margin-top:8px", "max-height:50vh", "overflow-y:auto", "background:" + COLORS.dark,
    "color:" + COLORS.cream, "font-family:sans-serif", "font-size:14px", "padding:12px",
    "direction:rtl", "border-radius:8px", "border:1px solid " + COLORS.border,
    "box-shadow:0 1px 4px rgba(0,0,0,.3)",
  ].join(";");

  wrapper.appendChild(downloadButton);
  wrapper.appendChild(panel);

  const mountAfter =
    videoEl && typeof videoEl.closest === "function"
      ? videoEl.closest(".block_video-responsive-video") || videoEl.parentElement
      : null;
  if (mountAfter && mountAfter.insertAdjacentElement) {
    mountAfter.insertAdjacentElement("afterend", wrapper);
  } else {
    doc.body.appendChild(wrapper);
  }

  const segments = [];
  let activeIndex = -1;

  downloadButton.addEventListener("click", () => {
    const text = segments.map((s) => s.text).join("\n");
    downloadAsTextFile(doc, text, "transcript.txt");
  });

  function render() {
    panel.innerHTML = "";
    segments.forEach((seg, i) => {
      const line = doc.createElement("div");
      line.textContent = seg.text;
      line.dataset.index = String(i);
      line.style.padding = "4px 0";
      line.style.opacity = i === activeIndex ? "1" : "0.6";
      line.style.fontWeight = i === activeIndex ? "bold" : "normal";
      line.style.color = i === activeIndex ? COLORS.orangeLight : COLORS.cream;
      panel.appendChild(line);
    });
  }

  function addSegment(segment) {
    segments.push(segment);
    render();
  }

  function syncToTime(currentTime) {
    const newIndex = findActiveSegmentIndex(segments, currentTime);
    if (newIndex === activeIndex) return;
    activeIndex = newIndex;
    render();
    const activeEl = panel.querySelector(`[data-index="${activeIndex}"]`);
    if (activeEl) activeEl.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  if (videoEl) {
    videoEl.addEventListener("timeupdate", () => syncToTime(videoEl.currentTime));
  }

  return { panel, addSegment, syncToTime, segments };
}
