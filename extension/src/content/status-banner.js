import { COLORS } from "./theme.js";

function ensureSpinnerStyle(doc) {
  if (doc.getElementById("moodlepro-spin-style")) return;
  const style = doc.createElement("style");
  style.id = "moodlepro-spin-style";
  style.textContent = "@keyframes moodlepro-spin{to{transform:rotate(360deg)}}";
  (doc.head || doc.documentElement).appendChild(style);
}

/** A small status banner over the video for loading/error feedback. */
export function createStatusBanner(doc, videoEl) {
  ensureSpinnerStyle(doc);
  const container = videoEl && videoEl.parentElement ? videoEl.parentElement : doc.body;
  if (container.style && !container.style.position) container.style.position = "relative";

  const banner = doc.createElement("div");
  banner.id = "moodlepro-status";
  banner.style.cssText = [
    "position:absolute", "top:8px", "left:50%", "transform:translateX(-50%)",
    "z-index:2147483200", "display:none", "align-items:center", "gap:8px",
    "padding:6px 14px", "border-radius:6px", "color:#fff", "font-size:13px",
    "font-family:sans-serif", "direction:rtl", "max-width:80%", "text-align:center",
  ].join(";");
  container.appendChild(banner);

  const spinner = doc.createElement("span");
  spinner.style.cssText = [
    "display:inline-block", "width:12px", "height:12px", "border:2px solid " + COLORS.orangeLight,
    "border-top-color:transparent", "border-radius:50%",
    "animation:moodlepro-spin .8s linear infinite",
  ].join(";");

  const label = doc.createElement("span");
  let autoHideTimer = null;

  function render({ background, withSpinner, text }) {
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
    banner.textContent = "";
    banner.style.background = background;
    banner.style.display = "flex";
    if (withSpinner) banner.appendChild(spinner);
    label.textContent = text;
    banner.appendChild(label);
  }

  function hide() {
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
    banner.style.display = "none";
  }

  return {
    banner,
    showLoading(text) {
      render({ background: "rgba(26,17,7,.85)", withSpinner: true, text });
    },
    showError(text) {
      render({ background: "rgba(180,30,30,.92)", withSpinner: false, text });
    },
    showInfo(text, { autoHideMs = 6000 } = {}) {
      render({ background: COLORS.orangeDeep, withSpinner: false, text });
      const win = doc.defaultView;
      if (autoHideMs && win && win.setTimeout) {
        autoHideTimer = win.setTimeout(hide, autoHideMs);
      }
    },
    hide,
  };
}
