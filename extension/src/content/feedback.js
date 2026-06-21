import { COLORS, addHoverEffect } from "./theme.js";

// TODO(before publish): this points at a TEMPORARY hub02 project. Replace with the real
// MoodlePRO review/hub02 URL once the project is published. Used by the feedback button
// and the lecture-quota review prompt (quota-prompt.js).
export const REVIEW_URL =
  "https://hub02.com/hubs/03bd43e5-ca7c-4287-beb1-738104497ca5/tools/f36f0001-1daf-4acf-a1cb-dc94b8fb3fbb?utm_source=copy_link&utm_medium=share&utm_campaign=hub02_share";

/** A small always-present button that sends testers to leave a review on hub02. */
export function injectFeedbackButton(doc, win = doc.defaultView) {
  if (doc.querySelector('[data-moodlepro-ui="feedback"]')) return;

  const button = doc.createElement("button");
  button.setAttribute("data-moodlepro-ui", "feedback");
  button.textContent = "⭐ Leave a review";
  button.style.cssText = [
    "position:fixed", "bottom:12px", "left:12px", "z-index:2147483600",
    "padding:6px 12px", "font-size:12px", "border:1px solid " + COLORS.orangeDeep, "border-radius:6px",
    "background:" + COLORS.dark, "color:" + COLORS.cream, "cursor:pointer", "font-family:sans-serif",
    "transition:background .15s ease",
  ].join(";");
  addHoverEffect(button, COLORS.dark, COLORS.orangeDeep);

  button.addEventListener("click", () => {
    win.open(REVIEW_URL, "_blank", "noopener,noreferrer");
  });

  doc.body.appendChild(button);
}
