import { beforeEach, describe, expect, it, vi } from "vitest";
import { showQuizConfig } from "../src/content/quiz-config.js";

beforeEach(() => {
  document.body.innerHTML = `<button id="anchor">Quiz</button>`;
});

describe("showQuizConfig", () => {
  it("calls onConfirm with the selected length and difficulty", () => {
    const onConfirm = vi.fn();
    const anchor = document.getElementById("anchor");

    showQuizConfig(document, anchor, onConfirm);

    document.querySelector("#moodlepro-quiz-config select").value = "10";
    document.querySelectorAll("#moodlepro-quiz-config select")[1].value = "hard";
    document.querySelector("#moodlepro-quiz-config button:last-child").click();

    expect(onConfirm).toHaveBeenCalledWith(10, "hard");
    expect(document.getElementById("moodlepro-quiz-config")).toBeNull();
  });

  it("removes the menu without calling onConfirm when cancelled", () => {
    const onConfirm = vi.fn();
    const anchor = document.getElementById("anchor");

    showQuizConfig(document, anchor, onConfirm);
    document.querySelector("#moodlepro-quiz-config button:first-child").click();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.getElementById("moodlepro-quiz-config")).toBeNull();
  });

  it("replaces an existing open menu instead of stacking two", () => {
    showQuizConfig(document, document.getElementById("anchor"), vi.fn());
    showQuizConfig(document, document.getElementById("anchor"), vi.fn());

    expect(document.querySelectorAll("#moodlepro-quiz-config")).toHaveLength(1);
  });
});
