import { beforeEach, describe, expect, it, vi } from "vitest";
import { injectCourseVipTools } from "../src/content/course-vip-tools.js";

function fakeApi(usage, overrides = {}) {
  return {
    getUsage: vi.fn(async () => usage),
    txtUrl: (id) => `http://localhost:8000/jobs/${id}/txt`,
    purgeCache: vi.fn(async () => ({ deleted_transcripts: 0, deleted_mappings: 0, requested_ids: 0 })),
    ...overrides,
  };
}

function setupDom() {
  document.body.innerHTML = `
    <header id="page-header">
      <div class="page-header-headings"><h1>Computer Security</h1></div>
    </header>
    <ul data-for="course_sectionlist">
      <li class="section" id="section-1">
        <h3 class="sectionname">פרופ' כהן</h3>
        <ul class="cmlist">
          <li class="activity modtype_zoom" data-for="cmitem" data-id="10">
            <div class="activity-name-area"><div class="activityname">
              <a href="https://moodle.bgu.ac.il/moodle/viewvideo.php?id=1"><span class="instancename">הרצאה 1</span></a>
            </div></div>
          </li>
        </ul>
      </li>
      <li class="section" id="section-2">
        <h3 class="sectionname">מתרגל לוי</h3>
        <ul class="cmlist">
          <li class="activity modtype_zoom" data-for="cmitem" data-id="19">
            <div class="activity-name-area"><div class="activityname">
              <a href="https://moodle.bgu.ac.il/moodle/viewvideo.php?id=4"><span class="instancename">תרגול 1</span></a>
            </div></div>
          </li>
          <li class="activity modtype_resource" data-for="cmitem" data-id="20">
            <div class="activity-name-area"><div class="activityname">
              <a href="https://moodle.bgu.ac.il/moodle/mod/resource/view.php?id=2"><span class="instancename">מצגת 1</span></a>
            </div></div>
          </li>
          <li class="activity modtype_assign" data-for="cmitem" data-id="21">
            <div class="activity-name-area"><div class="activityname">
              <a href="https://moodle.bgu.ac.il/moodle/mod/assign/view.php?id=3"><span class="instancename">מטלה 1</span></a>
            </div></div>
          </li>
          <li class="activity modtype_forum" data-for="cmitem" data-id="22">
            <div class="activity-name-area"><div class="activityname">
              <a href="https://moodle.bgu.ac.il/moodle/forum.php"><span class="instancename">פורום</span></a>
            </div></div>
          </li>
        </ul>
      </li>
    </ul>
  `;
}

beforeEach(() => {
  setupDom();
  global.fetch = vi.fn();
  global.chrome = { runtime: { sendMessage: vi.fn() } };
  // jsdom doesn't implement object URLs; stub them so the Blob-anchor download works.
  global.URL.createObjectURL = vi.fn(() => "blob:fake-zip-url");
  global.URL.revokeObjectURL = vi.fn();
});

describe("injectCourseVipTools", () => {
  it("does not inject the toolbar for non-unlimited users", async () => {
    await injectCourseVipTools(document, "http://localhost:8000", {
      api: fakeApi({ unlimited: false }),
      userId: "moodle:1",
    });
    expect(document.querySelector('[data-moodlepro-ui="course-vip-toolbar"]')).toBeNull();
  });

  it("injects the export + purge buttons for unlimited (VIP) users", async () => {
    await injectCourseVipTools(document, "http://localhost:8000", {
      api: fakeApi({ unlimited: true }),
      userId: "moodle:102628",
    });
    const toolbar = document.querySelector('[data-moodlepro-ui="course-vip-toolbar"]');
    expect(toolbar).not.toBeNull();
    const labels = Array.from(toolbar.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels.some((l) => l.includes("תמלולי מרצה"))).toBe(true);
    expect(labels.some((l) => l.includes("מסמכי קורס"))).toBe(true);
    expect(labels.some((l) => l.includes("נקה קאש"))).toBe(true);
  });

  it("does not inject twice", async () => {
    const opts = { api: fakeApi({ unlimited: true }), userId: "moodle:102628" };
    await injectCourseVipTools(document, "http://localhost:8000", opts);
    await injectCourseVipTools(document, "http://localhost:8000", opts);
    expect(document.querySelectorAll('[data-moodlepro-ui="course-vip-toolbar"]')).toHaveLength(1);
  });

  it("lecturer picker lists the distinct professors/TAs as choices", async () => {
    await injectCourseVipTools(document, "http://localhost:8000", {
      api: fakeApi({ unlimited: true }),
      userId: "moodle:102628",
    });
    const lecturerBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent.includes("תמלולי מרצה")
    );
    lecturerBtn.click();

    await vi.waitFor(() => {
      const list = document.querySelector("#moodlepro-lecturer-list");
      expect(list).not.toBeNull();
      const text = list.textContent;
      expect(text).toContain("פרופ' כהן");
      expect(text).toContain("מתרגל לוי");
    });
  });

  it("documents button bundles only slides/assignment files into a ZIP download", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.4 doc");
    global.fetch.mockImplementation((url) =>
      Promise.resolve({
        url,
        headers: { get: () => "application/pdf" },
        arrayBuffer: async () => pdf.buffer,
      })
    );

    let downloadedAnchor = null;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function () {
        downloadedAnchor = this;
      });

    await injectCourseVipTools(document, "http://localhost:8000", {
      api: fakeApi({ unlimited: true }),
      userId: "moodle:102628",
    });
    const docsBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent.includes("מסמכי קורס")
    );
    docsBtn.click();

    // Two document items (slides + assignment); the forum is excluded.
    await vi.waitFor(() => {
      const startBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent === "צור ZIP"
      );
      expect(startBtn).toBeDefined();
    });
    const startBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "צור ZIP"
    );
    startBtn.click();

    await vi.waitFor(() => {
      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(downloadedAnchor).not.toBeNull();
    });
    expect(global.URL.createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(downloadedAnchor.download).toContain("documents.zip");
    expect(downloadedAnchor.href).toBe("blob:fake-zip-url");
    // The forum item must not have been fetched.
    const fetchedUrls = global.fetch.mock.calls.map(([u]) => u);
    expect(fetchedUrls.some((u) => u.includes("forum.php"))).toBe(false);

    clickSpy.mockRestore();
  });

  it("purge button resolves each lecture's video id and calls purgeCache", async () => {
    // Each lecture page returns a player whose thumb id mirrors the viewvideo id.
    global.fetch.mockImplementation((url) => {
      const u = String(url);
      const n = (u.match(/viewvideo\.php\?id=(\d+)/) || [])[1] || "0";
      return Promise.resolve({
        url: u,
        text: async () =>
          `<html><body><video class="vjs-tech" src="https://cdn/${n}.mp4"></video>` +
          `<a href="https://moodle.bgu.ac.il/thumb.php?id=${n}">t</a></body></html>`,
      });
    });

    const api = fakeApi({ unlimited: true });
    await injectCourseVipTools(document, "http://localhost:8000", { api, userId: "moodle:102628" });

    const purgeBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent.includes("נקה קאש")
    );
    purgeBtn.click();

    await vi.waitFor(() => {
      const confirm = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent === "נקה קאש"
      );
      expect(confirm).toBeDefined();
    });
    Array.from(document.querySelectorAll("button"))
      .find((b) => b.textContent === "נקה קאש")
      .click();

    await vi.waitFor(() => {
      expect(api.purgeCache).toHaveBeenCalled();
    });
    const [userId, ids] = api.purgeCache.mock.calls[0];
    expect(userId).toBe("moodle:102628");
    // The two lecture items (viewvideo ?id=1 and ?id=4) resolve to those video ids.
    expect(ids.sort()).toEqual(["1", "4"]);
  });
});
