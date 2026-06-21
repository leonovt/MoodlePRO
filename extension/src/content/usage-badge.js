/** A small non-interactive pill in the video toolbar showing how many free lectures
 *  (credits) the user has left. Updated on load, after a job is created, and after the
 *  review bonus is claimed. */
export function createUsageBadge(doc, toolbar) {
  const badge = doc.createElement("span");
  badge.id = "moodlepro-usage-badge";
  badge.style.cssText = [
    "padding:5px 10px", "font-size:12px", "border-radius:4px",
    "background:rgba(0,0,0,.55)", "color:#fff", "font-family:sans-serif",
    "direction:rtl", "white-space:nowrap", "align-self:center", "display:none",
  ].join(";");
  toolbar.bar.appendChild(badge);

  return {
    element: badge,
    update(usage) {
      if (!usage) return;
      if (usage.unlimited) {
        badge.textContent = "🎓 ∞";
        badge.style.display = "inline-block";
        return;
      }
      // Best-effort UI: ignore malformed payloads rather than render "NaN".
      if (typeof usage.limit !== "number" || typeof usage.used !== "number") return;
      const remaining = Math.max(0, usage.limit - usage.used);
      badge.textContent =
        remaining > 0 ? `🎓 נותרו לך ${remaining} הרצאות` : "🎓 נגמרו ההרצאות החינמיות";
      badge.style.display = "inline-block";
    },
  };
}
