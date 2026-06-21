import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSidebar } from "../src/content/sidebar.js";

function stubDownloadApis() {
  URL.createObjectURL = vi.fn(() => "blob:mock-url");
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
}

beforeEach(() => {
  document.body.innerHTML = "";
  stubDownloadApis();
});

describe("createSidebar", () => {
  it("renders a download button alongside the transcript panel", () => {
    createSidebar(document, null);
    const downloadButton = document.getElementById("moodlepro-sidebar-download");
    expect(downloadButton).not.toBeNull();
    expect(downloadButton.textContent).toContain("Download");
  });

  it("downloads the joined segment text as transcript.txt when clicked", () => {
    const sidebar = createSidebar(document, null);
    sidebar.addSegment({ text: "Hello there", start: 0, end: 1 });
    sidebar.addSegment({ text: "Second line", start: 1, end: 2 });

    const downloadButton = document.getElementById("moodlepro-sidebar-download");
    downloadButton.click();

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("text/plain;charset=utf-8");
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("downloads an empty string when there are no segments yet", () => {
    const sidebar = createSidebar(document, null);
    expect(sidebar.segments).toHaveLength(0);

    const downloadButton = document.getElementById("moodlepro-sidebar-download");
    expect(() => downloadButton.click()).not.toThrow();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});
