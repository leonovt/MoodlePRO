import { beforeEach, describe, expect, it, vi } from "vitest";
import { injectCourseToolbar } from "../src/content/course-toolbar.js";

function setupDom() {
  document.body.innerHTML = `
    <div data-region="courses-view" data-display="card">
      <div data-region="course-view-content">
        <ul class="list-group unstyled" data-region="courses-list"></ul>
      </div>
    </div>
  `;
}

function addCourseLink(href, text = "My Course") {
  const list = document.querySelector('[data-region="courses-list"]');
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.href = href;
  a.textContent = text;
  li.appendChild(a);
  list.appendChild(li);
  return a;
}

const COURSE_HTML = `
  <html><body>
    <li class="activity activity-wrapper resource modtype_resource   " data-for="cmitem" data-id="1">
      <div class="activity-name-area"><div class="activityname"><a href="x"><span class="instancename">Item 1</span></a></div></div>
    </li>
  </body></html>
`;

function mockFetchForCoursePage(extraHandlers = {}) {
  global.fetch.mockImplementation((url) => {
    if (typeof url === "string" && url.includes("course/view.php")) {
      return Promise.resolve({ ok: true, text: async () => COURSE_HTML });
    }
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

describe("injectCourseToolbar", () => {
  it("does nothing when the courses-view container is not present", () => {
    document.body.innerHTML = "<p>no courses here</p>";
    expect(() => injectCourseToolbar(document, "http://localhost:8000")).not.toThrow();
  });

  it("injects distinct Summary and Quiz buttons when a course link appears", async () => {
    injectCourseToolbar(document, "http://localhost:8000");
    addCourseLink("https://moodle.bgu.ac.il/moodle/course/view.php?id=43312");

    await vi.waitFor(() => {
      expect(document.querySelector('[data-moodlepro-ui="course-summarize"]')).not.toBeNull();
      expect(document.querySelector('[data-moodlepro-ui="course-quiz"]')).not.toBeNull();
    });
  });

  it("does not duplicate the buttons if the mutation observer fires again for the same link", async () => {
    injectCourseToolbar(document, "http://localhost:8000");
    addCourseLink("https://moodle.bgu.ac.il/moodle/course/view.php?id=43312");

    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-moodlepro-ui="course-summarize"]')).toHaveLength(1);
      expect(document.querySelectorAll('[data-moodlepro-ui="course-quiz"]')).toHaveLength(1);
    });
  });

  it("offers all four scopes (everything/lectures/assignments/slides) from the Summary button", async () => {
    mockFetchForCoursePage({ "/courses/summary": () => Promise.resolve({ ok: true, json: async () => ({ summary: "x" }) }) });
    injectCourseToolbar(document, "http://localhost:8000");
    addCourseLink("https://moodle.bgu.ac.il/moodle/course/view.php?id=43312");

    const button = await vi.waitFor(() => {
      const b = document.querySelector('[data-moodlepro-ui="course-summarize"]');
      expect(b).not.toBeNull();
      return b;
    });
    button.click();

    await vi.waitFor(() => {
      const labels = Array.from(document.querySelectorAll("#moodlepro-scope-menu button")).map((b) => b.textContent);
      expect(labels).toEqual(["Everything", "Lectures only", "Assignments only", "Slides only"]);
    });
  });

  it("fetches the course page, scrapes items with item_type, and posts to /courses/summary when a scope is chosen", async () => {
    mockFetchForCoursePage({
      "/courses/summary": () => Promise.resolve({ ok: true, json: async () => ({ summary: "course summary" }) }),
    });

    injectCourseToolbar(document, "http://localhost:8000");
    const link = addCourseLink("https://moodle.bgu.ac.il/moodle/course/view.php?id=43312");

    const summaryButton = await vi.waitFor(() => {
      const b = document.querySelector('[data-moodlepro-ui="course-summarize"]');
      expect(b).not.toBeNull();
      return b;
    });
    summaryButton.click();

    const everythingOption = await vi.waitFor(() => {
      const menu = document.querySelector("#moodlepro-scope-menu");
      expect(menu).not.toBeNull();
      return Array.from(menu.querySelectorAll("button")).find((b) => b.textContent === "Everything");
    });
    everythingOption.click();

    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(link.href, expect.objectContaining({ credentials: "same-origin" }));
    });

    await vi.waitFor(() => {
      const summaryCall = global.fetch.mock.calls.find(([url]) => typeof url === "string" && url.endsWith("/courses/summary"));
      expect(summaryCall).toBeDefined();
      const body = JSON.parse(summaryCall[1].body);
      expect(body.scope).toBe("everything");
      expect(body.items).toEqual([expect.objectContaining({ id: "1", item_type: "slides", title: "Item 1" })]);
    });

    await vi.waitFor(() => {
      expect(document.querySelector("#moodlepro-modal").textContent).toContain("course summary");
    });
  });

  it("posts to /courses/quiz with the chosen scope when the Quiz button is used", async () => {
    mockFetchForCoursePage({
      "/courses/quiz": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            questions: [{ question: "Q?", options: ["a", "b", "c", "d"], correct_index: 0, explanation: "e" }],
          }),
        }),
    });

    injectCourseToolbar(document, "http://localhost:8000");
    addCourseLink("https://moodle.bgu.ac.il/moodle/course/view.php?id=43312");

    const quizButton = await vi.waitFor(() => {
      const b = document.querySelector('[data-moodlepro-ui="course-quiz"]');
      expect(b).not.toBeNull();
      return b;
    });
    quizButton.click();

    const slidesOption = await vi.waitFor(() => {
      const menu = document.querySelector("#moodlepro-scope-menu");
      expect(menu).not.toBeNull();
      return Array.from(menu.querySelectorAll("button")).find((b) => b.textContent === "Slides only");
    });
    slidesOption.click();

    await vi.waitFor(() => {
      const quizCall = global.fetch.mock.calls.find(([url]) => typeof url === "string" && url.endsWith("/courses/quiz"));
      expect(quizCall).toBeDefined();
      expect(JSON.parse(quizCall[1].body).scope).toBe("slides");
    });

    await vi.waitFor(() => {
      expect(document.querySelector("#moodlepro-modal").textContent).toContain("Q?");
    });
  });
});
