import { createResultModal } from "./result-modal.js";
import { scrapeCourseItems } from "./course-scraper.js";

const SCOPE_OPTIONS = [
  { label: "Everything", scope: "everything" },
  { label: "Lectures only", scope: "lectures" },
  { label: "Assignments only", scope: "assignments" },
  { label: "Slides only", scope: "slides" },
];

function courseIdFromHref(href) {
  const match = href.match(/[?&]id=(\d+)/);
  return match ? match[1] : null;
}

function toApiItems(items) {
  return items.map(({ id, type, title, text }) => ({ id, item_type: type, title, text }));
}

async function scrapeCourseApiItems(courseUrl) {
  const pageRes = await fetch(courseUrl, { credentials: "same-origin" });
  const html = await pageRes.text();
  const courseDoc = new DOMParser().parseFromString(html, "text/html");
  return toApiItems(scrapeCourseItems(courseDoc));
}

async function runCourseSummary(doc, httpBase, courseUrl, scope) {
  const modal = createResultModal(doc);
  modal.showLoading();
  try {
    const items = await scrapeCourseApiItems(courseUrl);
    const res = await fetch(`${httpBase}/courses/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, items }),
    });
    if (!res.ok) throw new Error(`request failed: ${res.status}`);
    const data = await res.json();
    modal.showSummary(data.summary);
  } catch (err) {
    modal.showSummary(`Failed to load: ${err.message}`);
  }
}

async function runCourseQuiz(doc, httpBase, courseUrl, scope) {
  const modal = createResultModal(doc);
  modal.showLoading();
  try {
    const items = await scrapeCourseApiItems(courseUrl);
    const res = await fetch(`${httpBase}/courses/quiz`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, items }),
    });
    if (!res.ok) throw new Error(`request failed: ${res.status}`);
    const data = await res.json();
    if (!data.questions || data.questions.length === 0) {
      modal.showSummary("No matching items were found for the requested scope.");
      return;
    }
    modal.showQuiz(data.questions);
  } catch (err) {
    modal.showSummary(`Failed to load: ${err.message}`);
  }
}

function showScopeMenu(doc, anchorButton, onPick) {
  const existing = doc.querySelector("#moodlepro-scope-menu");
  if (existing) existing.remove();

  const menu = doc.createElement("div");
  menu.id = "moodlepro-scope-menu";
  menu.setAttribute("data-moodlepro-ui", "1");
  menu.style.cssText = [
    "position:absolute", "z-index:2147483500", "background:#fff", "border:1px solid #ccc",
    "border-radius:4px", "box-shadow:0 2px 8px rgba(0,0,0,.3)", "padding:4px",
  ].join(";");

  SCOPE_OPTIONS.forEach((option) => {
    const item = doc.createElement("button");
    item.textContent = option.label;
    item.style.cssText = [
      "display:block", "width:100%", "text-align:left", "padding:6px 12px",
      "border:none", "background:transparent", "cursor:pointer", "font-size:12px",
    ].join(";");
    item.addEventListener("click", () => {
      menu.remove();
      onPick(option.scope);
    });
    menu.appendChild(item);
  });

  const rect = anchorButton.getBoundingClientRect();
  menu.style.top = `${rect.bottom + window.scrollY}px`;
  menu.style.left = `${rect.left + window.scrollX}px`;
  doc.body.appendChild(menu);
}

function makeActionButton(doc, label, dataAttr) {
  const button = doc.createElement("button");
  button.setAttribute("data-moodlepro-ui", dataAttr);
  button.textContent = label;
  button.style.cssText = [
    "margin-left:6px", "padding:2px 8px", "font-size:12px", "border:1px solid #e07a00",
    "border-radius:4px", "background:#ff9800", "color:#fff", "font-weight:600", "cursor:pointer",
  ].join(";");
  return button;
}

function injectButtonForLink(doc, link, httpBase) {
  const parent = link.parentElement;
  if (!parent) return;
  if (parent.querySelector('[data-moodlepro-ui="course-summarize"]')) return;

  const courseId = courseIdFromHref(link.getAttribute("href") ?? "");
  if (!courseId) return;

  const summaryButton = makeActionButton(doc, "Summary", "course-summarize");
  summaryButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showScopeMenu(doc, summaryButton, (scope) => {
      runCourseSummary(doc, httpBase, link.href, scope);
    });
  });

  const quizButton = makeActionButton(doc, "Quiz", "course-quiz");
  quizButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showScopeMenu(doc, quizButton, (scope) => {
      runCourseQuiz(doc, httpBase, link.href, scope);
    });
  });

  parent.appendChild(summaryButton);
  parent.appendChild(quizButton);
}

export function injectCourseToolbar(doc, serverBaseUrl) {
  const httpBase = serverBaseUrl.replace(/\/$/, "");
  const container = doc.querySelector('[data-region="courses-view"]');
  if (!container) return;

  function scan(root) {
    const links = root.querySelectorAll
      ? root.querySelectorAll('a[href*="course/view.php?id="]')
      : [];
    links.forEach((link) => injectButtonForLink(doc, link, httpBase));
    if (root.matches && root.matches('a[href*="course/view.php?id="]')) {
      injectButtonForLink(doc, root, httpBase);
    }
  }

  scan(container);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        scan(node);
      });
    });
  });

  observer.observe(container, { childList: true, subtree: true });
}
