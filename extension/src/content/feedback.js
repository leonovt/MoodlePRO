const REVIEW_URL =
  "https://hub02.com/hubs/03bd43e5-ca7c-4287-beb1-738104497ca5/tools/f36f0001-1daf-4acf-a1cb-dc94b8fb3fbb?utm_source=copy_link&utm_medium=share&utm_campaign=hub02_share";

/** A small always-present button that sends testers to leave a review on hub02. */
export function injectFeedbackButton(doc, win = doc.defaultView) {
  if (doc.querySelector('[data-moodlepro-ui="feedback"]')) return;

  const button = doc.createElement("button");
  button.setAttribute("data-moodlepro-ui", "feedback");
  button.textContent = "⭐ Leave a review";
  button.style.cssText = [
    "position:fixed", "bottom:12px", "left:12px", "z-index:2147483600",
    "padding:6px 12px", "font-size:12px", "border:none", "border-radius:4px",
    "background:#333", "color:#fff", "cursor:pointer", "font-family:sans-serif",
  ].join(";");

  button.addEventListener("click", () => {
    win.open(REVIEW_URL, "_blank", "noopener,noreferrer");
  });

  doc.body.appendChild(button);
}
