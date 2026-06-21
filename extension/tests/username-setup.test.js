import { beforeEach, describe, expect, it, vi } from "vitest";
import { maybeShowUsernameSetup } from "../src/content/username-setup.js";

describe("maybeShowUsernameSetup", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.localStorage.clear();
  });

  it("shows the prompt and registers the username on submit", async () => {
    const onSubmit = vi.fn().mockResolvedValue();

    maybeShowUsernameSetup(document, { onSubmit });
    const backdrop = document.getElementById("moodlepro-username-backdrop");
    expect(backdrop).not.toBeNull();

    const input = backdrop.querySelector("input");
    input.value = "leonovt";
    backdrop.querySelectorAll("button")[0].click();

    await Promise.resolve();
    await Promise.resolve();

    expect(onSubmit).toHaveBeenCalledWith("leonovt");
    expect(document.getElementById("moodlepro-username-backdrop")).toBeNull();
    expect(window.localStorage.getItem("moodlepro_username")).toBe("1");
  });

  it("does not call onSubmit when skipped", () => {
    const onSubmit = vi.fn();

    maybeShowUsernameSetup(document, { onSubmit });
    const backdrop = document.getElementById("moodlepro-username-backdrop");
    backdrop.querySelectorAll("button")[1].click();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.getElementById("moodlepro-username-backdrop")).toBeNull();
    expect(window.localStorage.getItem("moodlepro_username")).toBe("1");
  });

  it("is only shown once per browser profile", () => {
    window.localStorage.setItem("moodlepro_username", "1");

    const result = maybeShowUsernameSetup(document, { onSubmit: vi.fn() });

    expect(result).toBeNull();
    expect(document.getElementById("moodlepro-username-backdrop")).toBeNull();
  });
});
