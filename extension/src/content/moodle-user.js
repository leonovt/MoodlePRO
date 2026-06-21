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

  const nameEl = doc.querySelector(
    '[data-region="user-menu"] .usertext, .userbutton .usertext, .usermenu .usertext'
  );
  if (nameEl && nameEl.textContent.trim()) {
    return `name:${nameEl.textContent.trim()}`;
  }

  return null;
}
