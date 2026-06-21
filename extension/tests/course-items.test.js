import { beforeEach, describe, expect, it, vi } from "vitest";
import { injectCourseItemButtons } from "../src/content/course-items.js";

function setupDom() {
  document.body.innerHTML = `
    <ul class="section m-0 p-0 img-text d-block" data-for="cmlist">
      <li class="activity activity-wrapper resource modtype_resource   " id="module-100" data-for="cmitem" data-id="100">
        <div class="activity-item focus-control" data-region="activity-card">
          <div class="activity-name-area activity-instance d-flex flex-column me-2">
            <div class="activitytitle modtype_resource position-relative align-self-start">
              <div class="activityname">
                <a href="https://moodle.bgu.ac.il/moodle/mod/resource/view.php?id=100" class="aalink stretched-link">
                  <span class="instancename">Syllabus</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </li>
    </ul>
  `;
}

beforeEach(() => {
  setupDom();
  global.fetch = vi.fn();
});

describe("injectCourseItemButtons", () => {
  it("injects separate Summary and Quiz buttons into the activity-name-area", () => {
    injectCourseItemButtons(document, "http://localhost:8000");
    const buttons = Array.from(document.querySelectorAll('[data-moodlepro-ui]'));
    expect(buttons).toHaveLength(2);
    const texts = buttons.map((b) => b.textContent);
    expect(texts.some((t) => t.includes("📝"))).toBe(true);
    expect(texts.some((t) => t.includes("🧠"))).toBe(true);
  });

  it("does not inject buttons on a link/URL item (external, unreadable)", () => {
    document.body.innerHTML = `
      <ul data-for="cmlist">
        <li class="activity modtype_url" data-for="cmitem" data-id="200">
          <div class="activity-item">
            <div class="activity-name-area">
              <div class="activityname">
                <a href="https://moodle.bgu.ac.il/moodle/mod/url/view.php?id=200">
                  <span class="instancename">External link</span>
                </a>
              </div>
            </div>
          </div>
        </li>
      </ul>`;
    injectCourseItemButtons(document, "http://localhost:8000");
    expect(document.querySelectorAll("[data-moodlepro-ui]")).toHaveLength(0);
  });

  it("does not duplicate buttons when called twice", () => {
    injectCourseItemButtons(document, "http://localhost:8000");
    injectCourseItemButtons(document, "http://localhost:8000");
    const buttons = document.querySelectorAll('[data-moodlepro-ui]');
    expect(buttons).toHaveLength(2);
  });

  it("calls the summary and quiz endpoints on click", async () => {
    global.fetch.mockImplementation((url) => {
      if (typeof url === "string" && url.includes("resource/view.php")) {
        return Promise.resolve({
          url,
          headers: { get: () => "text/html" },
          text: async () => "<html><body>no embedded file here</body></html>",
        });
      }
      if (url.endsWith("/items/summary")) {
        return Promise.resolve({ ok: true, json: async () => ({ summary: "a summary" }) });
      }
      if (url.endsWith("/items/quiz")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            questions: [
              { question: "Q1?", options: ["a", "b", "c", "d"], correct_index: 1, explanation: "because" },
            ],
          }),
        });
      }
      return Promise.reject(new Error("unexpected url " + url));
    });

    injectCourseItemButtons(document, "http://localhost:8000");
    const buttons = Array.from(document.querySelectorAll('[data-moodlepro-ui]'));
    const summaryButton = buttons.find((b) => b.textContent.includes("📝"));
    const quizButton = buttons.find((b) => b.textContent.includes("🧠"));

    summaryButton.click();
    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:8000/items/summary",
        expect.objectContaining({ method: "POST" })
      );
    });
    const summaryCall = global.fetch.mock.calls.find(([url]) => url.endsWith("/items/summary"));
    const summaryBody = JSON.parse(summaryCall[1].body);
    expect(summaryBody).toEqual(
      expect.objectContaining({ title: "Syllabus", item_type: "slides", mode: "default" })
    );
    await vi.waitFor(() => {
      expect(document.querySelector("#moodlepro-modal").textContent).toContain("a summary");
    });

    quizButton.click();
    document.querySelector("#moodlepro-quiz-config button:last-child").click();
    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:8000/items/quiz",
        expect.objectContaining({ method: "POST" })
      );
    });
    const quizCall = global.fetch.mock.calls.find(([url]) => url.endsWith("/items/quiz"));
    const quizBody = JSON.parse(quizCall[1].body);
    expect(quizBody).toEqual(
      expect.objectContaining({ title: "Syllabus", num_questions: 5, difficulty: "medium" })
    );
  });

  it("shows quiz config asking for length and difficulty before generating", () => {
    injectCourseItemButtons(document, "http://localhost:8000");
    const quizButton = Array.from(document.querySelectorAll('[data-moodlepro-ui]')).find((b) =>
      b.textContent.includes("🧠")
    );

    quizButton.click();

    const config = document.getElementById("moodlepro-quiz-config");
    expect(config).not.toBeNull();
    expect(config.textContent).toContain("Questions");
    expect(config.textContent).toContain("Difficulty");
  });

  it("adds a Solve button only for assignment items", () => {
    document.body.innerHTML = `
      <ul data-for="cmlist">
        <li class="activity modtype_assign" data-for="cmitem" data-id="300">
          <div class="activity-item">
            <div class="activity-name-area">
              <div class="activityname">
                <a href="https://moodle.bgu.ac.il/moodle/mod/assign/view.php?id=300">
                  <span class="instancename">HW1</span>
                </a>
              </div>
            </div>
          </div>
        </li>
      </ul>`;

    injectCourseItemButtons(document, "http://localhost:8000");
    const buttons = Array.from(document.querySelectorAll('[data-moodlepro-ui]'));
    expect(buttons).toHaveLength(3);
    expect(buttons.some((b) => b.textContent.includes("🧩"))).toBe(true);
  });

  it("calls /items/summary with mode=solve when Solve is clicked", async () => {
    document.body.innerHTML = `
      <ul data-for="cmlist">
        <li class="activity modtype_assign" data-for="cmitem" data-id="300">
          <div class="activity-item">
            <div class="activity-name-area">
              <div class="activityname">
                <a href="https://moodle.bgu.ac.il/moodle/mod/assign/view.php?id=300">
                  <span class="instancename">HW1</span>
                </a>
              </div>
            </div>
          </div>
        </li>
      </ul>`;
    global.fetch.mockImplementation((url) => {
      if (typeof url === "string" && url.includes("mod/assign/view.php")) {
        return Promise.resolve({
          url,
          headers: { get: () => "text/html" },
          text: async () => "<html><body>no embedded file here</body></html>",
        });
      }
      if (url.endsWith("/items/summary")) {
        return Promise.resolve({ ok: true, json: async () => ({ summary: "the solved answer" }) });
      }
      return Promise.reject(new Error("unexpected url " + url));
    });

    injectCourseItemButtons(document, "http://localhost:8000");
    const solveButton = Array.from(document.querySelectorAll('[data-moodlepro-ui]')).find((b) =>
      b.textContent.includes("🧩")
    );
    solveButton.click();

    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:8000/items/summary",
        expect.objectContaining({ method: "POST" })
      );
    });
    const call = global.fetch.mock.calls.find(([url]) => url.endsWith("/items/summary"));
    const body = JSON.parse(call[1].body);
    expect(body).toEqual(expect.objectContaining({ mode: "solve", item_type: "assignment" }));
  });
});
