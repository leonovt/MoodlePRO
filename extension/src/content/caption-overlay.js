import { findActiveSegmentIndex } from "./segment-sync.js";

/** Renders the active segment as a caption layer absolutely positioned over the video. */
export function createCaptionOverlay(doc, videoEl) {
  const container = videoEl.parentElement ?? doc.body;
  if (!container.style.position) {
    container.style.position = "relative";
  }

  const overlay = doc.createElement("div");
  overlay.id = "moodlepro-caption-overlay";
  overlay.style.cssText = [
    "position:absolute", "bottom:8%", "left:50%", "transform:translateX(-50%)",
    "max-width:80%", "background:rgba(0,0,0,.65)", "color:#fff", "padding:6px 14px",
    "border-radius:6px", "font-size:18px", "text-align:center", "direction:rtl",
    "z-index:2147483000", "pointer-events:none",
  ].join(";");
  container.appendChild(overlay);

  const segments = [];
  let activeIndex = -1;

  function syncToTime(currentTime) {
    const newIndex = findActiveSegmentIndex(segments, currentTime);
    if (newIndex === activeIndex) return;
    activeIndex = newIndex;
    overlay.textContent = activeIndex >= 0 ? segments[activeIndex].text : "";
  }

  function addSegment(segment) {
    segments.push(segment);
  }

  videoEl.addEventListener("timeupdate", () => syncToTime(videoEl.currentTime));

  return { overlay, addSegment, syncToTime, segments };
}
