import { COLORS, addHoverEffect } from "./theme.js";
import { renderRichText } from "./markdown-render.js";

/** Computes a grade line + short Hebrew advice from quiz results. Pure, so it's unit-tested. */
export function gradeAdvice(correct, total, missedTitles = []) {
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const grade = `ציון: ${correct}/${total} (${pct}%)`;
  let advice;
  if (pct === 100) advice = "כל הכבוד! שלטת בחומר של הפרק.";
  else if (pct >= 80) advice = "עבודה טובה! כדאי לעבור שוב על השאלות שטעית בהן.";
  else if (pct >= 50) advice = "לא רע. מומלץ לחזור על הפרק ולהתמקד בנושאים שפספסת.";
  else advice = "כדאי לצפות שוב בפרק ולחזור על החומר מההתחלה.";
  if (missedTitles.length > 0) {
    const topics = missedTitles
      .slice(0, 3)
      .map((t) => "• " + (t.length > 70 ? t.slice(0, 70) + "…" : t))
      .join("\n");
    advice += "\nנושאים לחזרה:\n" + topics;
  }
  return { grade, advice };
}

/** Renders a dismissible fixed-position overlay for summaries and quizzes. */
export function createResultModal(doc) {
  let backdrop = null;
  let box = null;

  function close() {
    const existing = doc.getElementById ? doc.getElementById("moodlepro-modal-backdrop") : null;
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
    backdrop = null;
    box = null;
  }

  function open() {
    close();
    backdrop = doc.createElement("div");
    backdrop.id = "moodlepro-modal-backdrop";
    backdrop.style.cssText = [
      "position:fixed", "top:0", "left:0", "width:100%", "height:100%",
      "background:rgba(0,0,0,.5)", "z-index:2147483600",
      "display:flex", "align-items:center", "justify-content:center",
    ].join(";");
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close();
    });

    box = doc.createElement("div");
    box.id = "moodlepro-modal";
    box.style.cssText = [
      "position:relative", "background:#fff !important", "color:#111 !important", "max-width:600px",
      "width:90%", "max-height:80vh", "overflow-y:auto", "border-radius:10px",
      "border:1px solid " + COLORS.border,
      "padding:20px", "font-family:sans-serif", "font-size:14px",
      "box-shadow:0 4px 24px rgba(0,0,0,.4)",
    ].join(";");

    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
      const logo = doc.createElement("img");
      logo.src = chrome.runtime.getURL("icons/logo.png");
      logo.alt = "MoodlePRO";
      logo.style.cssText = "position:absolute;top:10px;left:14px;width:24px;height:24px;border-radius:50%;";
      box.appendChild(logo);
    }

    const closeButton = doc.createElement("button");
    closeButton.textContent = "×";
    closeButton.style.cssText = [
      "position:absolute", "top:8px", "right:12px", "border:none",
      "background:transparent", "font-size:22px", "line-height:1",
      "cursor:pointer", "color:" + COLORS.orangeDeep,
    ].join(";");
    closeButton.addEventListener("click", close);
    box.appendChild(closeButton);

    backdrop.appendChild(box);
    doc.body.appendChild(backdrop);
    return box;
  }

  function showLoading() {
    const content = open();
    const loading = doc.createElement("div");
    loading.textContent = "Loading...";
    loading.style.cssText = "padding:24px 0;text-align:center;";
    content.appendChild(loading);
  }

  function showSummary(text) {
    const content = open();
    const p = doc.createElement("div");
    p.style.cssText = "margin-top:8px;color:#111 !important;";
    renderRichText(doc, p, text);
    content.appendChild(p);
  }

  function renderQuizInto(content, questions) {
    const total = questions.length;
    let answeredCount = 0;
    let correctCount = 0;
    const missed = [];

    const resultBlock = doc.createElement("div");
    resultBlock.id = "moodlepro-quiz-result";
    resultBlock.style.cssText = [
      "display:none", "margin-top:8px", "padding:12px", "border-radius:6px",
      "background:#eef4ff", "border:1px solid #c5d3f7", "direction:rtl",
      "text-align:right", "color:#111 !important",
    ].join(";");

    questions.forEach((q, qIndex) => {
      const qBlock = doc.createElement("div");
      qBlock.style.cssText = "margin:16px 0;padding-bottom:12px;border-bottom:1px solid #ddd;";

      const qText = doc.createElement("div");
      qText.style.cssText = "font-weight:bold;margin-bottom:8px;color:#111 !important;";
      const qNumber = doc.createElement("span");
      qNumber.textContent = `${qIndex + 1}. `;
      const qBody = doc.createElement("span");
      renderRichText(doc, qBody, q.question);
      qText.appendChild(qNumber);
      qText.appendChild(qBody);
      qBlock.appendChild(qText);

      const explanation = doc.createElement("div");
      renderRichText(doc, explanation, q.explanation ?? "");
      explanation.style.cssText = "display:none;margin-top:8px;font-style:italic;color:#444 !important;";

      let answered = false;
      q.options.forEach((option, optIndex) => {
        const optionButton = doc.createElement("button");
        renderRichText(doc, optionButton, option);
        optionButton.style.cssText = [
          "display:block", "width:100%", "text-align:left", "margin:4px 0",
          "padding:8px", "border:1px solid #ccc", "border-radius:4px",
          "background:#f7f7f7", "color:#111 !important", "cursor:pointer",
        ].join(";");
        optionButton.addEventListener("click", () => {
          if (answered) return;
          answered = true;
          const correct = optIndex === q.correct_index;
          answeredCount += 1;
          if (correct) correctCount += 1;
          else missed.push(q.question);
          optionButton.style.background = correct ? "#c8f7c5" : "#f7c5c5";
          optionButton.style.borderColor = correct ? "#2e7d32" : "#c62828";
          if (!correct) {
            const correctButton = qBlock.querySelectorAll("button")[q.correct_index];
            if (correctButton) {
              correctButton.style.background = "#c8f7c5";
              correctButton.style.borderColor = "#2e7d32";
            }
          }
          explanation.style.display = "block";

          if (answeredCount === total) {
            const { grade, advice } = gradeAdvice(correctCount, total, missed);
            const gradeEl = doc.createElement("div");
            gradeEl.textContent = grade;
            gradeEl.style.cssText = "font-weight:bold;font-size:15px;margin-bottom:6px;";
            const adviceEl = doc.createElement("div");
            adviceEl.textContent = advice;
            adviceEl.style.cssText = "font-size:13px;white-space:pre-wrap;";
            resultBlock.appendChild(gradeEl);
            resultBlock.appendChild(adviceEl);
            resultBlock.style.display = "block";
            if (resultBlock.scrollIntoView) resultBlock.scrollIntoView({ block: "nearest" });
          }
        });
        qBlock.appendChild(optionButton);
      });

      qBlock.appendChild(explanation);
      content.appendChild(qBlock);
    });

    content.appendChild(resultBlock);
  }

  function showQuiz(questions) {
    const content = open();
    renderQuizInto(content, questions);
  }

  function showSummaryAndQuiz(summaryText, questions) {
    const content = open();
    const p = doc.createElement("div");
    p.style.cssText = "margin-top:8px;";
    renderRichText(doc, p, summaryText);
    content.appendChild(p);
    renderQuizInto(content, questions);
  }

  return { showSummary, showQuiz, showSummaryAndQuiz, showLoading, close };
}
