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
      "width:90%", "max-height:80vh", "overflow-y:auto", "border-radius:8px",
      "padding:20px", "font-family:sans-serif", "font-size:14px",
      "box-shadow:0 4px 24px rgba(0,0,0,.4)",
    ].join(";");

    const closeButton = doc.createElement("button");
    closeButton.textContent = "×";
    closeButton.style.cssText = [
      "position:absolute", "top:8px", "right:12px", "border:none",
      "background:transparent", "font-size:22px", "line-height:1",
      "cursor:pointer", "color:#333",
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
    const p = doc.createElement("p");
    p.textContent = text;
    p.style.cssText = "white-space:pre-wrap;margin-top:8px;color:#111 !important;";
    content.appendChild(p);
  }

  function renderQuizInto(content, questions) {
    questions.forEach((q, qIndex) => {
      const qBlock = doc.createElement("div");
      qBlock.style.cssText = "margin:16px 0;padding-bottom:12px;border-bottom:1px solid #ddd;";

      const qText = doc.createElement("div");
      qText.textContent = `${qIndex + 1}. ${q.question}`;
      qText.style.cssText = "font-weight:bold;margin-bottom:8px;color:#111 !important;";
      qBlock.appendChild(qText);

      const explanation = doc.createElement("div");
      explanation.textContent = q.explanation ?? "";
      explanation.style.cssText = "display:none;margin-top:8px;font-style:italic;color:#444 !important;";

      let answered = false;
      q.options.forEach((option, optIndex) => {
        const optionButton = doc.createElement("button");
        optionButton.textContent = option;
        optionButton.style.cssText = [
          "display:block", "width:100%", "text-align:left", "margin:4px 0",
          "padding:8px", "border:1px solid #ccc", "border-radius:4px",
          "background:#f7f7f7", "color:#111 !important", "cursor:pointer",
        ].join(";");
        optionButton.addEventListener("click", () => {
          if (answered) return;
          answered = true;
          const correct = optIndex === q.correct_index;
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
        });
        qBlock.appendChild(optionButton);
      });

      qBlock.appendChild(explanation);
      content.appendChild(qBlock);
    });
  }

  function showQuiz(questions) {
    const content = open();
    renderQuizInto(content, questions);
  }

  function showSummaryAndQuiz(summaryText, questions) {
    const content = open();
    const p = doc.createElement("p");
    p.textContent = summaryText;
    p.style.cssText = "white-space:pre-wrap;margin-top:8px;";
    content.appendChild(p);
    renderQuizInto(content, questions);
  }

  return { showSummary, showQuiz, showSummaryAndQuiz, showLoading, close };
}
