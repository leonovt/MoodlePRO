import { REVIEW_URL } from "./feedback.js";
import { COLORS, addHoverEffect } from "./theme.js";

/** Shown when a user hits their lecture quota. Offers the honor-system review path:
 *  "Leave a review" opens hub02; "I left a review" calls onReviewed() to claim the bonus
 *  and retry. */
export function showQuotaPrompt(doc, { onReviewed, onContinue, win = doc.defaultView } = {}) {
  const existing = doc.getElementById("moodlepro-quota-backdrop");
  if (existing) existing.remove();

  const backdrop = doc.createElement("div");
  backdrop.id = "moodlepro-quota-backdrop";
  backdrop.style.cssText = [
    "position:fixed", "inset:0", "background:rgba(0,0,0,.5)", "z-index:2147483600",
    "display:flex", "align-items:center", "justify-content:center",
  ].join(";");

  const box = doc.createElement("div");
  box.style.cssText = [
    "background:#fff", "color:#111", "max-width:380px", "width:90%", "border-radius:10px",
    "border:1px solid " + COLORS.border,
    "padding:22px", "font-family:sans-serif", "direction:rtl", "text-align:center",
    "box-shadow:0 4px 24px rgba(0,0,0,.4)",
  ].join(";");

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
    const logo = doc.createElement("img");
    logo.src = chrome.runtime.getURL("icons/logo.png");
    logo.alt = "MoodlePRO";
    logo.style.cssText = "width:40px;height:40px;border-radius:50%;margin-bottom:10px;";
    box.appendChild(logo);
  }

  const title = doc.createElement("div");
  title.textContent = "הגעת למכסת ההרצאות החינמית";
  title.style.cssText = "font-weight:bold;font-size:16px;margin-bottom:8px;";
  box.appendChild(title);

  const msg = doc.createElement("div");
  msg.textContent = "השאירו ביקורת וקבלו 5 הרצאות נוספות 🎁";
  msg.style.cssText = "font-size:13px;color:#444;margin-bottom:10px;";
  box.appendChild(msg);

  const referralNote = doc.createElement("div");
  referralNote.textContent = "🤝 הזמנתם חבר/ה? כל אחד מכם מקבל עוד 3 הרצאות נוספות!";
  referralNote.style.cssText = "font-size:12.5px;color:" + COLORS.orangeDeep + ";margin-bottom:14px;font-weight:600;";
  box.appendChild(referralNote);

  const inputStyle = "display:block;width:100%;margin:4px 0;padding:8px;border:1px solid #ccc;border-radius:5px;font-size:13px;box-sizing:border-box;";

  const usernameLabel = doc.createElement("label");
  usernameLabel.textContent = "שם המשתמש שלך במודל (כדי שחברים יוכלו להזמין אתכם)";
  usernameLabel.style.cssText = "display:block;font-size:11.5px;color:#666;text-align:right;margin-top:6px;";
  box.appendChild(usernameLabel);
  const usernameInput = doc.createElement("input");
  usernameInput.type = "text";
  usernameInput.placeholder = "שם המשתמש שלך, לדוגמה leonovt";
  usernameInput.style.cssText = inputStyle;
  box.appendChild(usernameInput);

  const referredByLabel = doc.createElement("label");
  referredByLabel.textContent = "מי הזמין אתכם? (אופציונלי)";
  referredByLabel.style.cssText = "display:block;font-size:11.5px;color:#666;text-align:right;margin-top:6px;";
  box.appendChild(referredByLabel);
  const referredByInput = doc.createElement("input");
  referredByInput.type = "text";
  referredByInput.placeholder = "שם המשתמש של מי שהזמין אתכם";
  referredByInput.style.cssText = inputStyle;
  box.appendChild(referredByInput);

  const close = () => backdrop.remove();

  const reviewBtn = doc.createElement("button");
  reviewBtn.textContent = "⭐ השאר ביקורת וקבל 5 הרצאות בחינם";
  reviewBtn.style.cssText = "display:block;width:100%;margin:14px 0 6px;padding:11px;border:none;border-radius:7px;background:" + COLORS.orange + ";color:#fff;font-weight:700;font-size:14px;cursor:pointer;transition:background .15s ease;box-shadow:0 2px 8px rgba(247,148,30,.4);";
  addHoverEffect(reviewBtn, COLORS.orange, COLORS.orangeDeep);
  reviewBtn.addEventListener("click", () => {
    if (win && win.open) win.open(REVIEW_URL, "_blank", "noopener,noreferrer");
  });
  box.appendChild(reviewBtn);

  const confirmBtn = doc.createElement("button");
  confirmBtn.textContent = "כבר השארתי ביקורת";
  confirmBtn.style.cssText = "display:block;width:100%;margin:6px 0;padding:9px;border:1px solid #2e7d32;border-radius:5px;background:#fff;color:#2e7d32;font-weight:600;font-size:14px;cursor:pointer;";
  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    reviewBtn.disabled = true;
    confirmBtn.textContent = "מעדכן…";
    const referredBy = referredByInput.value.trim() || null;
    let result;
    try {
      if (onReviewed) {
        result = await onReviewed({ username: usernameInput.value.trim() || null, referredBy });
      }
    } catch {
      confirmBtn.disabled = false;
      reviewBtn.disabled = false;
      confirmBtn.textContent = "כבר השארתי ביקורת";
      return;
    }
    // Clear success feedback, then close and continue with the (now-unblocked) transcription.
    box.textContent = "";
    const ok = doc.createElement("div");
    ok.textContent =
      referredBy && result && result.referral_credits > 0
        ? "🎁 קיבלת 5 הרצאות נוספות + 3 הרצאות הפניה! מתחילים…"
        : "🎁 קיבלת 5 הרצאות נוספות! מתחילים…";
    ok.style.cssText = "font-weight:bold;font-size:15px;color:#2e7d32;direction:rtl;";
    box.appendChild(ok);
    const scheduler = win && win.setTimeout ? win.setTimeout.bind(win) : setTimeout;
    scheduler(() => {
      close();
      if (onContinue) onContinue();
    }, 1600);
  });
  box.appendChild(confirmBtn);

  const cancelBtn = doc.createElement("button");
  cancelBtn.textContent = "סגור";
  cancelBtn.style.cssText = "display:block;width:100%;margin:6px 0 0;padding:7px;border:none;border-radius:5px;background:transparent;color:#777;font-size:13px;cursor:pointer;";
  cancelBtn.addEventListener("click", close);
  box.appendChild(cancelBtn);

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  backdrop.appendChild(box);
  doc.body.appendChild(backdrop);
  return { backdrop, close };
}
