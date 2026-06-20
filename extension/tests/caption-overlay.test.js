import { beforeEach, describe, expect, it } from "vitest";
import { createCaptionOverlay } from "../src/content/caption-overlay.js";

function setupVideo() {
  document.body.innerHTML = `<div id="container"><video></video></div>`;
  return document.querySelector("video");
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("caption overlay subtitle controls", () => {
  it("toggles visibility on and off", () => {
    const overlay = createCaptionOverlay(document, setupVideo());
    expect(overlay.overlay.style.display).toBe("");
    expect(overlay.toggle()).toBe(false);
    expect(overlay.overlay.style.display).toBe("none");
    expect(overlay.toggle()).toBe(true);
    expect(overlay.overlay.style.display).toBe("");
  });

  it("grows and shrinks font size, clamped to 10–48px", () => {
    const overlay = createCaptionOverlay(document, setupVideo());

    expect(overlay.changeFontSize(2)).toBe(20);
    expect(overlay.overlay.style.fontSize).toBe("20px");

    for (let i = 0; i < 40; i++) overlay.changeFontSize(2);
    expect(overlay.changeFontSize(2)).toBe(48); // clamped at max

    for (let i = 0; i < 40; i++) overlay.changeFontSize(-2);
    expect(overlay.changeFontSize(-2)).toBe(10); // clamped at min
  });
});
