import { describe, expect, it } from "vitest";
import { gradeAdvice } from "../src/content/result-modal.js";

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
