import { beforeEach, describe, expect, it, vi } from "vitest";
import { arrayBufferToBase64, resolveResourceFile } from "../src/content/resource-file.js";

beforeEach(() => {
  global.fetch = vi.fn();
});

describe("resolveResourceFile", () => {
  it("returns the bytes directly when the resource view URL redirects straight to the file", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4 fake pdf bytes");
    global.fetch.mockResolvedValue({
      url: "https://moodle.bgu.ac.il/moodle/pluginfile.php/123/mod_resource/content/0/slides.pdf",
      headers: { get: () => "application/pdf" },
      arrayBuffer: async () => bytes.buffer,
    });

    const result = await resolveResourceFile("https://moodle.bgu.ac.il/moodle/mod/resource/view.php?id=1");

    expect(result.mimeType).toBe("application/pdf");
    expect(new TextDecoder().decode(result.buffer)).toBe("%PDF-1.4 fake pdf bytes");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("follows an embedded iframe/object/link to the real pluginfile.php URL", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4 embedded");
    global.fetch.mockImplementation((url) => {
      if (typeof url === "string" && url.includes("resource/view.php")) {
        return Promise.resolve({
          url,
          headers: { get: () => "text/html" },
          text: async () =>
            '<html><body><iframe src="https://moodle.bgu.ac.il/moodle/pluginfile.php/9/mod_resource/content/0/x.pdf"></iframe></body></html>',
        });
      }
      return Promise.resolve({
        headers: { get: () => "application/pdf" },
        arrayBuffer: async () => bytes.buffer,
      });
    });

    const result = await resolveResourceFile("https://moodle.bgu.ac.il/moodle/mod/resource/view.php?id=9");

    expect(result.mimeType).toBe("application/pdf");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://moodle.bgu.ac.il/moodle/pluginfile.php/9/mod_resource/content/0/x.pdf",
      { credentials: "same-origin" }
    );
  });

  it("returns null when the page has no embedded file and isn't a file itself", async () => {
    global.fetch.mockResolvedValue({
      url: "https://moodle.bgu.ac.il/moodle/mod/resource/view.php?id=2",
      headers: { get: () => "text/html" },
      text: async () => "<html><body>nothing here</body></html>",
    });

    const result = await resolveResourceFile("https://moodle.bgu.ac.il/moodle/mod/resource/view.php?id=2");
    expect(result).toBeNull();
  });
});

describe("arrayBufferToBase64", () => {
  it("base64-encodes the buffer", () => {
    const buffer = new TextEncoder().encode("hello").buffer;
    expect(arrayBufferToBase64(buffer)).toBe(btoa("hello"));
  });
});
