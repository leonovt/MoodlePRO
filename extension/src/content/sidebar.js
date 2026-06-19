import { findActiveSegmentIndex } from "./segment-sync.js";

/** Injects a fixed-position auto-scrolling transcript panel and keeps it in sync with the video. */
export function createSidebar(doc, videoEl) {
  const panel = doc.createElement("div");
  panel.id = "moodlepro-sidebar";
  panel.style.cssText = [
    "position:fixed", "top:0", "right:0", "width:320px", "height:100vh",
    "overflow-y:auto", "background:#111", "color:#eee", "z-index:2147483000",
    "font-family:sans-serif", "font-size:14px", "padding:12px", "direction:rtl",
    "box-shadow:-2px 0 8px rgba(0,0,0,.4)",
  ].join(";");
  doc.body.appendChild(panel);

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
