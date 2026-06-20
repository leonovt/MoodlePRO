import { beforeEach, describe, expect, it, vi } from "vitest";
import { injectCoursePageToolbar } from "../src/content/course-toolbar.js";

function setupDom() {
  document.body.innerHTML = `
    <header id="page-header" class="header-maxwidth d-print-none">
      <div class="page-context-header d-flex flex-column">
        <div class="page-header-headings"><h1>Computer Security</h1></div>
      </div>
    </header>
    <li class="activity activity-wrapper modtype_zoom" data-for="cmitem" data-id="1">
      <div class="activity-name-area"><div class="activityname"><a href="viewvideo.php?id=123"><span class="instancename">Lecture 1: Intro</span></a></div></div>
    </li>
    <li class="activity activity-wrapper modtype_resource" data-for="cmitem" data-id="2">
      <div class="activity-name-area"><div class="activityname"><a href="x.pdf"><span class="instancename">Slides 1: Cryptography</span></a></div></div>
    </li>
    <li class="activity activity-wrapper modtype_forum" data-for="cmitem" data-id="3">
      <div class="activity-name-area"><div class="activityname"><a href="forum.php"><span class="instancename">News & Announcements Forum</span></a></div></div>
    </li>
  `;
}

function mockFetchForApi(extraHandlers = {}) {
  global.fetch.mockImplementation((url) => {
    for (const [suffix, handler] of Object.entries(extraHandlers)) {
      if (typeof url === "string" && url.endsWith(suffix)) return handler();
    }
    return Promise.reject(new Error("unexpected url " + url));
  });
}

beforeEach(() => {
  setupDom();
  global.fetch = vi.fn();
});

describe("injectCoursePageToolbar", () => {
  it("does nothing when page-header is not present", () => {
    document.body.innerHTML = "<p>no header here</p>";
    expect(() => injectCoursePageToolbar(document, "http://localhost:8000")).not.toThrow();
  });

  it("injects distinct Course Summary and Course Quiz buttons into the header", () => {
    injectCoursePageToolbar(document, "http://localhost:8000");
    const toolbar = document.querySelector('[data-moodlepro-ui="course-page-toolbar"]');
    expect(toolbar).not.toBeNull();
    expect(toolbar.textContent).toContain("Course Summary");
    expect(toolbar.textContent).toContain("Course Quiz");
  });

  it("opens the selection popup, filters out the technical forum, and lists only the academic lecture/slides", () => {
    injectCoursePageToolbar(document, "http://localhost:8000");
    const summaryBtn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("Course Summary"));
    summaryBtn.click();

    const menu = document.querySelector("#moodlepro-selection-menu");
    expect(menu).not.toBeNull();

    const labels = Array.from(menu.querySelectorAll("#moodlepro-lecture-list label span")).map(s => s.textContent.trim());
    expect(labels).toEqual(["🎥 Lecture 1: Intro", "📄 Slides 1: Cryptography"]);
  });

  it("posts selected academic items to /courses/summary on Generate Summary click", async () => {
    mockFetchForApi({
      "/courses/summary": () => Promise.resolve({ ok: true, json: async () => ({ summary: "academic summary" }) })
    });

    injectCoursePageToolbar(document, "http://localhost:8000");
    const summaryBtn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("Course Summary"));
    summaryBtn.click();

    const menu = document.querySelector("#moodlepro-selection-menu");
    expect(menu).not.toBeNull();

    menu.querySelector("#moodlepro-generate-btn").click();

    await vi.waitFor(() => {
      const summaryCall = global.fetch.mock.calls.find(([url]) => typeof url === "string" && url.endsWith("/courses/summary"));
      expect(summaryCall).toBeDefined();
      const body = JSON.parse(summaryCall[1].body);
      expect(body.scope).toBe("everything");
      expect(body.items).toHaveLength(2);
      expect(body.items[0].title).toBe("Lecture 1: Intro");
      expect(body.items[1].title).toBe("Slides 1: Cryptography");
    });

    await vi.waitFor(() => {
      expect(document.querySelector("#moodlepro-modal").textContent).toContain("academic summary");
    });
  });

  it("posts chosen length and difficulty along with selected items to /courses/quiz on Generate Quiz click", async () => {
    mockFetchForApi({
      "/courses/quiz": () => Promise.resolve({
        ok: true,
        json: async () => ({ questions: [{ question: "Q?", options: ["a", "b", "c", "d"], correct_index: 0, explanation: "e" }] })
      })
    });

    injectCoursePageToolbar(document, "http://localhost:8000");
    const quizBtn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("Course Quiz"));
    quizBtn.click();

    const menu = document.querySelector("#moodlepro-selection-menu");
    expect(menu).not.toBeNull();

    const lengthSel = menu.querySelector("#moodlepro-length-select");
    const hardSel = menu.querySelector("#moodlepro-hardness-select");
    lengthSel.value = "10";
    hardSel.value = "easy";

    menu.querySelector("#moodlepro-generate-btn").click();

    await vi.waitFor(() => {
      const quizCall = global.fetch.mock.calls.find(([url]) => typeof url === "string" && url.endsWith("/courses/quiz"));
      expect(quizCall).toBeDefined();
      const body = JSON.parse(quizCall[1].body);
      expect(body.num_questions).toBe(10);
      expect(body.difficulty).toBe("easy");
      expect(body.items).toHaveLength(2);
    });

    await vi.waitFor(() => {
      expect(document.querySelector("#moodlepro-modal").textContent).toContain("Q?");
    });
  });
});
