import { COLORS, addHoverEffect } from "./theme.js";

const STORAGE_KEY = "moodlepro_username";

/** One-time, dismissible prompt asking for the user's Moodle username, shown the first
 *  time the extension runs for this browser profile. Registers the username with the
 *  server independently of leaving a review (must NOT grant the review bonus) so a
 *  user on the unlimited-quota allowlist is never gated, even before they'd ever see
 *  the quota/review prompt. Skippable; only ever asked once (tracked in localStorage). */
export function maybeShowUsernameSetup(doc, { onSubmit, win = doc.defaultView } = {}) {
  const storage = win && win.localStorage;
  if (storage && storage.getItem(STORAGE_KEY)) return null;

  const backdrop = doc.createElement("div");
  backdrop.id = "moodlepro-username-backdrop";
  backdrop.style.cssText = [
    "position:fixed", "inset:0", "background:rgba(0,0,0,.5)", "z-index:2147483600",
    "display:flex", "align-items:center", "justify-content:center",
  ].join(";");

  const box = doc.createElement("div");
  box.style.cssText = [
    "background:#fff", "color:#111", "max-width:340px", "width:90%", "border-radius:10px",
    "border:1px solid " + COLORS.border,
    "padding:20px", "font-family:sans-serif", "direction:rtl", "text-align:center",
    "box-shadow:0 4px 24px rgba(0,0,0,.4)",
  ].join(";");

  const title = doc.createElement("div");
  title.textContent = "מה שם המשתמש שלך במודל?";
  title.style.cssText = "font-weight:bold;font-size:15px;margin-bottom:8px;";
  box.appendChild(title);

  const msg = doc.createElement("div");
  msg.textContent = "נשמור את זה כדי שנוכל לזהות אתכם בהמשך (אפשר לדלג).";
  msg.style.cssText = "font-size:12.5px;color:#444;margin-bottom:12px;";
  box.appendChild(msg);

  const input = doc.createElement("input");
  input.type = "text";
  input.placeholder = "שם המשתמש שלך, לדוגמה leonovt";
  input.style.cssText =
    "display:block;width:100%;margin:4px 0 14px;padding:8px;border:1px solid #ccc;border-radius:5px;font-size:13px;box-sizing:border-box;";
  box.appendChild(input);

  const close = () => backdrop.remove();
  const markDone = () => { if (storage) storage.setItem(STORAGE_KEY, "1"); };

  const submitBtn = doc.createElement("button");
  submitBtn.textContent = "שמירה";
  submitBtn.style.cssText =
    "display:block;width:100%;margin:0 0 6px;padding:10px;border:none;border-radius:7px;background:" +
    COLORS.orange + ";color:#fff;font-weight:700;font-size:14px;cursor:pointer;";
  addHoverEffect(submitBtn, COLORS.orange, COLORS.orangeDeep);
  submitBtn.addEventListener("click", async () => {
    const username = input.value.trim();
    markDone();
    if (username && onSubmit) {
      try {
        await onSubmit(username);
      } catch {
        /* registration is best-effort; the prompt is already dismissed for good */
      }
    }
    close();
  });
  box.appendChild(submitBtn);

  const skipBtn = doc.createElement("button");
  skipBtn.textContent = "דלג";
  skipBtn.style.cssText =
    "display:block;width:100%;padding:7px;border:none;border-radius:5px;background:transparent;color:#777;font-size:13px;cursor:pointer;";
  skipBtn.addEventListener("click", () => {
    markDone();
    close();
  });
  box.appendChild(skipBtn);

  backdrop.appendChild(box);
  doc.body.appendChild(backdrop);
  return { backdrop, close };
}
