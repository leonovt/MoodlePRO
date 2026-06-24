/** Best-effort read of the logged-in Moodle user from the page DOM, used as the quota key.
 *  Content scripts can't see the page's JS globals (isolated world), so we read the DOM:
 *  the profile link carries the stable numeric user id. Returns null if not found, in
 *  which case the request is sent without a user_id and the server doesn't gate it. */
export function getMoodleUserId(doc) {
  // The logged-in user's own profile link lives in the user menu (top nav). Scope to it
  // FIRST: a page-wide search for any profile link picks up OTHER people's links scattered
  // through course pages (teachers, forum authors, participant lists), so it returns a
  // different id on every page and never matches the unlimited allowlist.
  const menuSelectors = [
    '[data-region="user-menu"]',
    ".usermenu",
    "#user-menu-toggle",
    ".userbutton",
  ];
  for (const sel of menuSelectors) {
    const menu = doc.querySelector(sel);
    const link = menu && menu.querySelector('a[href*="/user/profile.php?id="]');
    const match = link && (link.getAttribute("href") || "").match(/[?&]id=(\d+)/);
    if (match) return `moodle:${match[1]}`;
  }

  // BGU's user-menu "profile" link is just /user/profile.php (no id), so the menu check
  // above misses. The notification bell carries the logged-in user's own id on every page
  // and is unambiguously the current user — use it as the primary fallback.
  const notif = doc.querySelector("#nav-notification-popover-container[data-userid]");
  const notifId = notif && notif.getAttribute("data-userid");
  if (notifId && /^\d+$/.test(notifId)) return `moodle:${notifId}`;

  // Footer "you are logged in as: <name>" link — also unambiguously the current user.
  const footerLink = doc.querySelector('.logininfo a[href*="/user/profile.php?id="]');
  const footerMatch = footerLink && (footerLink.getAttribute("href") || "").match(/[?&]id=(\d+)/);
  if (footerMatch) return `moodle:${footerMatch[1]}`;

  const nameEl = doc.querySelector(
    '[data-region="user-menu"] .usertext, .userbutton .usertext, .usermenu .usertext'
  );
  if (nameEl && nameEl.textContent.trim()) {
    return `name:${nameEl.textContent.trim()}`;
  }

  return null;
}
