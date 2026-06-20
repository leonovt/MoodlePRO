import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachChapters } from "../src/content/chapters.js";

function makeApi() {
  return {
    txtUrl: (jobId) => `http://localhost:8000/jobs/${jobId}/txt`,
  };
}

function makeVideoEl() {
  return { currentTime: 0 };
}

beforeEach(() => {
  document.body.innerHTML = "";
  global.fetch = vi.fn();
});

describe("attachChapters", () => {
  it("renders nothing when the chapters list is empty", async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => [] });
    const result = await attachChapters(document, makeApi(), "job-1", makeVideoEl());
    expect(result).toBeNull();
    expect(document.getElementById("moodlepro-chapters")).toBeNull();
  });

  it("renders chapters from the chapters endpoint", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: "c1", title: "Intro", start: 0, end: 60 },
        { id: "c2", title: "Deep dive", start: 60, end: 180 },
      ],
    });

    await attachChapters(document, makeApi(), "job-1", makeVideoEl());

    expect(global.fetch).toHaveBeenCalledWith("http://localhost:8000/jobs/job-1/chapters");
    const panel = document.getElementById("moodlepro-chapters");
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain("Intro");
    expect(panel.textContent).toContain("Deep dive");
  });

  it("sets videoEl.currentTime when a chapter title is clicked", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => [{ id: "c1", title: "Intro", start: 42, end: 60 }],
    });
    const videoEl = makeVideoEl();

    await attachChapters(document, makeApi(), "job-1", videoEl);

    const titleButton = document.querySelector("#moodlepro-chapters button");
    titleButton.click();

    expect(videoEl.currentTime).toBe(42);
  });

  it("calls the chapter summary and quiz endpoints when their buttons are clicked", async () => {
    global.fetch.mockImplementation((url, opts) => {
      if (typeof url === "string" && url.endsWith("/chapters")) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: "c1", title: "Intro", start: 0, end: 60 }],
        });
      }
      if (typeof url === "string" && url.endsWith("/chapters/c1/summary")) {
        return Promise.resolve({ ok: true, json: async () => ({ summary: "chapter summary" }) });
      }
      if (typeof url === "string" && url.endsWith("/chapters/c1/quiz")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            questions: [{ question: "Q?", options: ["a", "b", "c", "d"], correct_index: 0, explanation: "e" }],
          }),
        });
      }
      return Promise.reject(new Error("unexpected url " + url));
    });

    await attachChapters(document, makeApi(), "job-1", makeVideoEl());

    const buttons = document.querySelectorAll("#moodlepro-chapters button");
    const summaryButton = Array.from(buttons).find((b) => b.textContent === "Summary");
    const quizButton = Array.from(buttons).find((b) => b.textContent === "Quiz");

    summaryButton.click();
    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:8000/jobs/job-1/chapters/c1/summary",
        expect.objectContaining({ method: "POST" })
      );
    });
    await vi.waitFor(() => {
      expect(document.querySelector("#moodlepro-modal").textContent).toContain("chapter summary");
    });

    quizButton.click();
    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:8000/jobs/job-1/chapters/c1/quiz",
        expect.objectContaining({ method: "POST" })
      );
    });
    await vi.waitFor(
      () => {
        expect(document.querySelector("#moodlepro-modal").textContent).toContain("Q?");
      },
      { timeout: 2000 }
    );
  });
});
