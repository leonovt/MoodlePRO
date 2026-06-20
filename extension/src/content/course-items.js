import { createResultModal } from "./result-modal.js";
import { arrayBufferToBase64, resolveResourceFile } from "./resource-file.js";
import { scrapeCourseItems } from "./course-scraper.js";

/** Slides/resource items don't carry real content in their course-page text — fetch the actual file. */
async function resolveFileFields(item) {
  if (item.type !== "slides" || !item.href) return {};
  const file = await resolveResourceFile(item.href);
  if (!file) return {};
  return { file_base64: arrayBufferToBase64(file.buffer), mime_type: file.mimeType };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`request to ${url} failed: ${res.status}`);
  }
  return res.json();
}

function findLiForItem(doc, id) {
  return doc.querySelector(`li[data-for="cmitem"][data-id="${id}"]`);
}

export function injectCourseItemButtons(doc, serverBaseUrl) {
  const httpBase = serverBaseUrl.replace(/\/$/, "");
  const items = scrapeCourseItems(doc);

  items.forEach((item) => {
    const li = findLiForItem(doc, item.id);
    if (!li) return;

    const nameArea = li.querySelector(".activity-name-area");
    if (!nameArea) return;
    if (nameArea.querySelector("[data-moodlepro-ui]")) return;

    const makeButton = (label) => {
      const button = doc.createElement("button");
      button.setAttribute("data-moodlepro-ui", "1");
      button.textContent = label;
      button.style.cssText = [
        "display:block", "margin-top:6px", "padding:4px 10px", "font-size:12px",
        "border:1px solid #e07a00", "border-radius:4px", "background:#ff9800", "color:#fff",
        "font-weight:600", "cursor:pointer",
      ].join(";");
      return button;
    };

    const summaryButton = makeButton("📝 Summary");
    summaryButton.addEventListener("click", async () => {
      const modal = createResultModal(doc);
      modal.showLoading();
      try {
        const fileFields = await resolveFileFields(item);
        const summaryRes = await postJson(`${httpBase}/items/summary`, {
          title: item.title,
          text: item.text,
          item_type: item.type,
          mode: "default",
          ...fileFields,
        });
        modal.showSummary(summaryRes.summary);
      } catch (err) {
        modal.showSummary(`Failed to load: ${err.message}`);
      }
    });

    const quizButton = makeButton("🧠 Quiz");
    quizButton.addEventListener("click", async () => {
      const modal = createResultModal(doc);
      modal.showLoading();
      try {
        const fileFields = await resolveFileFields(item);
        const quizRes = await postJson(`${httpBase}/items/quiz`, {
          title: item.title,
          text: item.text,
          item_type: item.type,
          num_questions: 5,
          ...fileFields,
        });
        modal.showQuiz(quizRes.questions);
      } catch (err) {
        modal.showSummary(`Failed to load: ${err.message}`);
      }
    });

    nameArea.appendChild(summaryButton);
    nameArea.appendChild(quizButton);
  });
}
