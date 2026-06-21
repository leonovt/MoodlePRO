import { beforeEach, describe, expect, it, vi } from "vitest";
import { replaceBguLogo } from "../src/content/brand-logo.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("replaceBguLogo", () => {
  it("swaps the BGU logo image for the MoodlePRO logo", () => {
    document.body.innerHTML = `<img class="bgulinklogo-image" src="/bgu-logo.png" alt="BGU Moodle">`;
    const getUrl = vi.fn(() => "chrome-extension://abc/icons/logo.png");

    replaceBguLogo(document, getUrl);

    const logo = document.querySelector("img.bgulinklogo-image");
    expect(getUrl).toHaveBeenCalledWith("icons/logo.png");
    expect(logo.src).toBe("chrome-extension://abc/icons/logo.png");
    expect(logo.alt).toBe("MoodlePRO");
  });

  it("does nothing when the BGU logo isn't on the page", () => {
    const getUrl = vi.fn();
    expect(() => replaceBguLogo(document, getUrl)).not.toThrow();
    expect(getUrl).not.toHaveBeenCalled();
  });
});
