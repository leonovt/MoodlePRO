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
  it("injects a button into the activity-name-area", () => {
    injectCourseItemButtons(document, "http://localhost:8000");
    const buttons = document.querySelectorAll('[data-moodlepro-ui]');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain("Summary + Quiz");
  });

  it("does not duplicate buttons when called twice", () => {
    injectCourseItemButtons(document, "http://localhost:8000");
    injectCourseItemButtons(document, "http://localhost:8000");
    const buttons = document.querySelectorAll('[data-moodlepro-ui]');
    expect(buttons).toHaveLength(1);
  });

  it("calls the summary and quiz endpoints on click", async () => {
    global.fetch.mockImplementation((url) => {
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
    const button = document.querySelector('[data-moodlepro-ui]');
    button.click();

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

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/items/quiz",
      expect.objectContaining({ method: "POST" })
    );

    await vi.waitFor(() => {
      expect(document.querySelector("#moodlepro-modal").textContent).toContain("a summary");
    });
  });
});
