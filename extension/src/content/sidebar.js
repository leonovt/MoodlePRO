import { findActiveSegmentIndex } from "./segment-sync.js";
import { COLORS } from "./theme.js";

/** Injects an in-page, auto-scrolling transcript panel right below the video and keeps it in sync. */
export function createSidebar(doc, videoEl) {
  const panel = doc.createElement("div");
  panel.id = "moodlepro-sidebar";
  panel.style.cssText = [
    "margin-top:12px", "max-height:50vh", "overflow-y:auto", "background:" + COLORS.dark,
    "color:" + COLORS.cream, "font-family:sans-serif", "font-size:14px", "padding:12px",
    "direction:rtl", "border-radius:8px", "border:1px solid " + COLORS.border,
    "box-shadow:0 1px 4px rgba(0,0,0,.3)",
  ].join(";");

  const mountAfter =
    videoEl && typeof videoEl.closest === "function"
      ? videoEl.closest(".block_video-responsive-video") || videoEl.parentElement
      : null;
  if (mountAfter && mountAfter.insertAdjacentElement) {
    mountAfter.insertAdjacentElement("afterend", panel);
  } else {
    doc.body.appendChild(panel);
  }

  const segments = [];
  let activeIndex = -1;

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
