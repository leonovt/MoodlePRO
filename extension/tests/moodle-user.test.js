import { beforeEach, describe, expect, it } from "vitest";
import { getMoodleUserId } from "../src/content/moodle-user.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("getMoodleUserId", () => {
  it("reads the numeric user id from the user-menu profile link", () => {
    document.body.innerHTML = `
      <div data-region="user-menu">
        <a href="https://moodle.bgu.ac.il/moodle/user/profile.php?id=12345">My profile</a>
      </div>`;
    expect(getMoodleUserId(document)).toBe("moodle:12345");
  });

  it("ignores other people's profile links and uses the user menu's own id", () => {
    // Course pages are full of OTHER users' profile links (teachers, forum authors).
    // The id must come from the logged-in user's menu, not the first link on the page.
    document.body.innerHTML = `
      <a href="/moodle/user/profile.php?id=99999">Prof. Someone</a>
      <a href="/moodle/user/profile.php?id=88888">Another student</a>
      <div class="usermenu">
        <a href="/moodle/user/profile.php?id=102494">My profile</a>
      </div>`;
    expect(getMoodleUserId(document)).toBe("moodle:102494");
  });

  it("does not pick up a stray profile link outside the user menu", () => {
    document.body.innerHTML = `
      <a href="/moodle/user/profile.php?id=99999">Prof. Someone</a>`;
    expect(getMoodleUserId(document)).toBeNull();
  });

  it("falls back to the notification bell data-userid (BGU menu has no id link)", () => {
    document.body.innerHTML = `
      <div class="usermenu">
        <a href="https://moodle.bgu.ac.il/moodle/user/profile.php">My profile</a>
      </div>
      <div id="nav-notification-popover-container" data-userid="102494"></div>`;
    expect(getMoodleUserId(document)).toBe("moodle:102494");
  });

  it("falls back to the 'logged in as' footer link", () => {
    document.body.innerHTML = `
      <div class="logininfo">את/ה מחובר/ת כ:
        <a href="https://moodle.bgu.ac.il/moodle/user/profile.php?id=102494">שם</a>
      </div>`;
    expect(getMoodleUserId(document)).toBe("moodle:102494");
  });

  it("falls back to the user-menu name when no profile link exists", () => {
    document.body.innerHTML = `
      <div data-region="user-menu"><span class="usertext">דנה כהן</span></div>`;
    expect(getMoodleUserId(document)).toBe("name:דנה כהן");
  });

  it("returns null when the user can't be identified", () => {
    document.body.innerHTML = `<div>no user info</div>`;
    expect(getMoodleUserId(document)).toBeNull();
  });
});
