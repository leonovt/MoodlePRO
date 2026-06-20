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
  let visible = true;
  let fontSizePx = 18;

  function syncToTime(currentTime) {
    const newIndex = findActiveSegmentIndex(segments, currentTime);
    if (newIndex === activeIndex) return;
    activeIndex = newIndex;
    overlay.textContent = activeIndex >= 0 ? segments[activeIndex].text : "";
  }

  function addSegment(segment) {
    segments.push(segment);
  }

  /** Show or hide the caption layer. Returns the new visible state. */
  function setVisible(next) {
    visible = next;
    overlay.style.display = visible ? "" : "none";
    return visible;
  }

  function toggle() {
    return setVisible(!visible);
  }

  /** Grow/shrink caption text, clamped to a readable range. Returns the new px size. */
  function changeFontSize(deltaPx) {
    fontSizePx = Math.max(10, Math.min(48, fontSizePx + deltaPx));
    overlay.style.fontSize = `${fontSizePx}px`;
    return fontSizePx;
  }

  videoEl.addEventListener("timeupdate", () => syncToTime(videoEl.currentTime));

  return { overlay, addSegment, syncToTime, segments, setVisible, toggle, changeFontSize };
}
