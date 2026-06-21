import { COLORS } from "./theme.js";

// Used by the feedback button and the lecture-quota review prompt (quota-prompt.js).
export const REVIEW_URL =
  "https://hub02.com/hubs/03bd43e5-ca7c-4287-beb1-738104497ca5/tools/6413fd4c-b224-4117-8871-7b676c9d22df";

/** A small always-present button that sends testers to leave a review on hub02. */
export function injectFeedbackButton(doc, win = doc.defaultView) {
  if (doc.querySelector('[data-moodlepro-ui="feedback"]')) return;

  const button = doc.createElement("button");
  button.setAttribute("data-moodlepro-ui", "feedback");
  button.textContent = 'קבלו עוד הרצאות ע"י השארת ביקורת ⭐';
  button.style.cssText = [
    "position:fixed", "bottom:16px", "left:16px", "z-index:2147483600",
    "padding:12px 20px", "font-size:14px", "font-weight:700", "border:none", "border-radius:10px",
    "background:linear-gradient(135deg," + COLORS.orangeLight + "," + COLORS.orangeDeep + ")",
    "color:#1a1107", "cursor:pointer", "font-family:sans-serif",
    "box-shadow:0 4px 14px rgba(247,148,30,.5)", "transition:transform .15s ease",
  ].join(";");
  button.addEventListener("mouseenter", () => { button.style.transform = "translateY(-2px) scale(1.03)"; });
  button.addEventListener("mouseleave", () => { button.style.transform = "none"; });

  button.addEventListener("click", () => {
    win.open(REVIEW_URL, "_blank", "noopener,noreferrer");
  });

  doc.body.appendChild(button);
}
