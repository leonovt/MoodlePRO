import { createResultModal } from "./result-modal.js";
import { arrayBufferToBase64, resolveResourceFile } from "./resource-file.js";
import { scrapeCourseItems } from "./course-scraper.js";
import { showQuizConfig } from "./quiz-config.js";
import { COLORS, addHoverEffect } from "./theme.js";

/** Slides and assignment items don't carry real content in their course-page text — fetch the actual file. */
async function resolveFileFields(item) {
  if ((item.type !== "slides" && item.type !== "assignment") || !item.href) return {};
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
    // Link/URL items point to external content the extension can't read — skip them
    // instead of injecting buttons that would summarize/quiz on empty text.
    if (item.type === "link") return;

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
        "border:1px solid " + COLORS.orangeDeep, "border-radius:6px", "background:" + COLORS.orange,
        "color:#fff", "font-weight:600", "cursor:pointer", "transition:background .15s ease",
      ].join(";");
      addHoverEffect(button, COLORS.orange, COLORS.orangeDeep);
      return button;
    };

    const summaryButton = makeButton("📝 סיכום");
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

    const quizButton = makeButton("🧠 חידון");
    quizButton.addEventListener("click", () => {
      showQuizConfig(doc, quizButton, async (numQuestions, difficulty) => {
        const modal = createResultModal(doc);
        modal.showLoading();
        try {
          const fileFields = await resolveFileFields(item);
          const quizRes = await postJson(`${httpBase}/items/quiz`, {
            title: item.title,
            text: item.text,
            item_type: item.type,
            num_questions: numQuestions,
            difficulty,
            ...fileFields,
          });
          modal.showQuiz(quizRes.questions);
        } catch (err) {
          modal.showSummary(`Failed to load: ${err.message}`);
        }
      });
    });

    nameArea.appendChild(summaryButton);
    nameArea.appendChild(quizButton);

    if (item.type === "assignment") {
      const solveButton = makeButton("🧩 פתרון");
      solveButton.addEventListener("click", async () => {
        const modal = createResultModal(doc);
        modal.showLoading();
        try {
          const fileFields = await resolveFileFields(item);
          const solveRes = await postJson(`${httpBase}/items/summary`, {
            title: item.title,
            text: item.text,
            item_type: item.type,
            mode: "solve",
            ...fileFields,
          });
          modal.showSummary(solveRes.summary);
        } catch (err) {
          modal.showSummary(`Failed to load: ${err.message}`);
        }
      });
      nameArea.appendChild(solveButton);
    }
  });
}
