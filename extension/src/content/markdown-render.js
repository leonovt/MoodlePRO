import { marked } from "marked";
import DOMPurify from "dompurify";
import renderMathInElement from "katex/contrib/auto-render";

function ensureKatexStyle(doc) {
  if (doc.getElementById("moodlepro-katex-style")) return;
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.getURL) return;
  const link = doc.createElement("link");
  link.id = "moodlepro-katex-style";
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("vendor/katex/katex.min.css");
  (doc.head || doc.documentElement).appendChild(link);
}

const MATH_DELIMITERS = [
  { left: "$$", right: "$$", display: true },
  { left: "\\[", right: "\\]", display: true },
  { left: "$", right: "$", display: false },
  { left: "\\(", right: "\\)", display: false },
];

/** Renders LLM-produced Markdown + LaTeX (Gemini's summary/quiz output) as real HTML + typeset math. */
export function renderRichText(doc, container, rawText) {
  ensureKatexStyle(doc);
  container.innerHTML = DOMPurify.sanitize(marked.parse(rawText ?? ""));
  try {
    renderMathInElement(container, { delimiters: MATH_DELIMITERS, throwOnError: false });
  } catch {
    // Malformed LaTeX shouldn't break the rest of the rendered content.
  }
}
