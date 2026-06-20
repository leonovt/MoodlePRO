/** Floating control bar overlaid directly on the video player, instead of a separate panel beside it. */
export function createVideoToolbar(doc, videoEl) {
  const container = videoEl && videoEl.parentElement ? videoEl.parentElement : doc.body;
  if (container.style && !container.style.position) {
    container.style.position = "relative";
  }

  const bar = doc.createElement("div");
  bar.id = "moodlepro-video-toolbar";
  bar.style.cssText = [
    "position:absolute", "top:8px", "right:8px", "z-index:2147483100",
    "display:flex", "gap:6px", "align-items:flex-start",
  ].join(";");
  container.appendChild(bar);

  function addButton(label, onClick) {
    const button = doc.createElement("button");
    button.textContent = label;
    button.style.cssText = [
      "padding:5px 12px", "font-size:12px", "cursor:pointer", "border:none",
      "border-radius:4px", "background:rgba(0,0,0,.7)", "color:#fff",
      "font-weight:600", "font-family:sans-serif",
    ].join(";");
    button.addEventListener("click", onClick);
    bar.appendChild(button);
    return button;
  }

  return { bar, addButton };
}
