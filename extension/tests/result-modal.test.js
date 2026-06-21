import { beforeEach, describe, expect, it, vi } from "vitest";
import { createResultModal, gradeAdvice } from "../src/content/result-modal.js";

function stubDownloadApis() {
  URL.createObjectURL = vi.fn(() => "blob:mock-url");
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
}

describe("gradeAdvice", () => {
  it("reports a perfect score with no review topics", () => {
    const { grade, advice } = gradeAdvice(4, 4, []);
    expect(grade).toBe("ציון: 4/4 (100%)");
    expect(advice).not.toContain("נושאים לחזרה");
  });

  it("computes the percentage and lists missed topics", () => {
    const { grade, advice } = gradeAdvice(1, 4, ["מהי מורכבות זמן?", "מהו עץ AVL?"]);
    expect(grade).toBe("ציון: 1/4 (25%)");
    expect(advice).toContain("נושאים לחזרה");
    expect(advice).toContain("מהי מורכבות זמן?");
  });

  it("caps the listed topics at three", () => {
    const missed = ["a", "b", "c", "d", "e"];
    const { advice } = gradeAdvice(0, 5, missed);
    expect(advice).toContain("• a");
    expect(advice).toContain("• c");
    expect(advice).not.toContain("• d");
  });
});

describe("createResultModal download button", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    stubDownloadApis();
  });

  it("shows a download button alongside the summary that downloads it as summary.txt", () => {
    const modal = createResultModal(document);
    modal.showSummary("a great summary");

    const downloadButton = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent.includes("Download")
    );
    expect(downloadButton).toBeDefined();

    downloadButton.click();

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("text/plain;charset=utf-8");
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("shows a download button for the summary when rendering summary + quiz together", () => {
    const modal = createResultModal(document);
    modal.showSummaryAndQuiz("combined summary", [
      { question: "Q?", options: ["a", "b"], correct_index: 0, explanation: "e" },
    ]);

    const downloadButton = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent.includes("Download")
    );
    expect(downloadButton).toBeDefined();

    downloadButton.click();

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });
});
