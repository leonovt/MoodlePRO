import { beforeEach, describe, expect, it, vi } from "vitest";
import { injectFeedbackButton, REVIEW_URL } from "../src/content/feedback.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("injectFeedbackButton", () => {
  it("adds a review button to the page", () => {
    injectFeedbackButton(document);
    expect(document.querySelector('[data-moodlepro-ui="feedback"]')).not.toBeNull();
  });

  it("does not add a second button if one already exists", () => {
    injectFeedbackButton(document);
    injectFeedbackButton(document);
    expect(document.querySelectorAll('[data-moodlepro-ui="feedback"]')).toHaveLength(1);
  });

  it("opens the hub02 review link on click", () => {
    const win = { open: vi.fn() };
    injectFeedbackButton(document, win);

    document.querySelector('[data-moodlepro-ui="feedback"]').click();

    expect(win.open).toHaveBeenCalledWith(REVIEW_URL, "_blank", "noopener,noreferrer");
  });
});
