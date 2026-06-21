import { beforeEach, describe, expect, it } from "vitest";
import { renderRichText } from "../src/content/markdown-render.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("renderRichText", () => {
  it("renders markdown headings and bold text as real elements, not literal text", () => {
    const container = document.createElement("div");
    renderRichText(document, container, "### Heading\n**bold text**");

    expect(container.querySelector("h3")).not.toBeNull();
    expect(container.querySelector("h3").textContent).toBe("Heading");
    expect(container.querySelector("strong")).not.toBeNull();
    expect(container.textContent).toContain("bold text");
  });

  it("typesets inline LaTeX math instead of leaving raw $ delimiters", () => {
    const container = document.createElement("div");
    renderRichText(document, container, "Set theory: $S \\subseteq T$");

    expect(container.querySelector(".katex")).not.toBeNull();
  });

  it("sanitizes raw script tags out of the rendered output", () => {
    const container = document.createElement("div");
    renderRichText(document, container, '<script>window.pwned = true</script>hello');

    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("hello");
  });

  it("handles empty/undefined input without throwing", () => {
    const container = document.createElement("div");
    expect(() => renderRichText(document, container, undefined)).not.toThrow();
  });
});
