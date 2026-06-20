import { beforeEach, describe, expect, it, vi } from "vitest";
import { injectFeedbackButton } from "../src/content/feedback.js";

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

    expect(win.open).toHaveBeenCalledWith(
      "https://hub02.com/hubs/03bd43e5-ca7c-4287-beb1-738104497ca5/tools/f36f0001-1daf-4acf-a1cb-dc94b8fb3fbb?utm_source=copy_link&utm_medium=share&utm_campaign=hub02_share",
      "_blank",
      "noopener,noreferrer"
    );
  });
});
