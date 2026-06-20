import { createResultModal } from "./result-modal.js";
import { scrapeCourseItems } from "./course-scraper.js";

function toApiItems(items) {
  return items.map(({ id, type, title, text }) => ({ id, item_type: type, title, text }));
}

async function runCourseSummaryWithItems(doc, httpBase, items) {
  const modal = createResultModal(doc);
  modal.showLoading();
  try {
    const res = await fetch(`${httpBase}/courses/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "everything", items }),
    });
    if (!res.ok) throw new Error(`request failed: ${res.status}`);
    const data = await res.json();
    modal.showSummary(data.summary);
  } catch (err) {
    modal.showSummary(`Failed to load: ${err.message}`);
  }
}

async function runCourseQuizWithItems(doc, httpBase, items, numQuestions, difficulty) {
  const modal = createResultModal(doc);
  modal.showLoading();
  try {
    const res = await fetch(`${httpBase}/courses/quiz`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "everything",
        items,
        num_questions: numQuestions,
        difficulty,
      }),
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

export function isAcademicItem(item) {
  const title = (item.title || "").toLowerCase();
  const type = item.item_type || item.type;

  if (type !== "lecture" && type !== "slides" && type !== "assignment") {
    return false;
  }

  const technicalPatterns = [
    /forum/i, /announcement/i, /news/i, /q&a/i, /support/i, /help/i, /technical/i,
    /פורום/i, /הודעות/i, /לוח מודעות/i, /תמיכה/i, /סילבוס/i, /syllabus/i, /מבוא/i,
    /הוראות/i, /מדריך/i, /קישורים/i, /חומרי עזר/i
  ];

  for (const pattern of technicalPatterns) {
    if (pattern.test(title)) {
      return false;
    }
  }

  return true;
}

export function showSelectionMenu(doc, anchorButton, items, isQuiz, onGenerate) {
  const existing = doc.querySelector("#moodlepro-selection-menu");
  if (existing) existing.remove();

  const menu = doc.createElement("div");
  menu.id = "moodlepro-selection-menu";
  menu.setAttribute("data-moodlepro-ui", "1");
  menu.style.cssText = [
    "position:absolute", "z-index:2147483500", "background:#fff", "border:1px solid #bbb",
    "border-radius:8px", "box-shadow:0 4px 16px rgba(0,0,0,.2)", "padding:16px",
    "width:320px", "font-family:sans-serif", "color:#333", "background-color:#ffffff",
    "display:flex", "flex-direction:column", "gap:12px"
  ].join(";");

  const title = doc.createElement("div");
  title.textContent = isQuiz ? "Configure MoodlePRO Quiz" : "Configure MoodlePRO Summary";
  title.style.cssText = "font-weight:bold; font-size:14px; color:#111; margin-bottom:4px; border-bottom:1px solid #eee; padding-bottom:6px;";
  menu.appendChild(title);

  const listHeader = doc.createElement("div");
  listHeader.textContent = "Select Course Items:";
  listHeader.style.cssText = "font-weight:600; font-size:12px; color:#555;";
  menu.appendChild(listHeader);

  const listContainer = doc.createElement("div");
  listContainer.id = "moodlepro-lecture-list";
  listContainer.style.cssText = "max-height:120px; overflow-y:auto; border:1px solid #ddd; border-radius:4px; padding:6px; background:#fafafa; display:flex; flex-direction:column; gap:6px;";

  const checkboxes = [];

  if (items.length === 0) {
    const emptyMsg = doc.createElement("div");
    emptyMsg.textContent = "No relevant course items found.";
    emptyMsg.style.cssText = "font-size:11px; color:#999; font-style:italic;";
    listContainer.appendChild(emptyMsg);
  } else {
    items.forEach((lec) => {
      const label = doc.createElement("label");
      label.style.cssText = "display:flex; align-items:center; gap:8px; font-size:11.5px; color:#333; cursor:pointer; font-weight:normal; margin:0;";

      const cb = doc.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.value = lec.id;
      cb.style.cssText = "margin:0; cursor:pointer;";

      const span = doc.createElement("span");
      span.textContent = `${lec.item_type === "slides" ? "📄" : lec.item_type === "lecture" ? "🎥" : "📝"} ${lec.title}`;
      span.style.cssText = "overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#000;";

      label.appendChild(cb);
      label.appendChild(span);
      listContainer.appendChild(label);

      checkboxes.push({ checkbox: cb, item: lec });
    });
  }
  menu.appendChild(listContainer);

  let lengthSelect = null;
  let hardnessSelect = null;

  if (isQuiz) {
    const lengthContainer = doc.createElement("div");
    lengthContainer.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:10px;";

    const lengthLabel = doc.createElement("span");
    lengthLabel.textContent = "Quiz Length:";
    lengthLabel.style.cssText = "font-weight:600; font-size:12px; color:#555;";

    lengthSelect = doc.createElement("select");
    lengthSelect.id = "moodlepro-length-select";
    lengthSelect.style.cssText = "padding:4px 8px; font-size:12px; border:1px solid #ccc; border-radius:4px; background:#fff; color:#000; cursor:pointer;";
    [
      { val: "3", label: "3 Questions" },
      { val: "5", label: "5 Questions" },
      { val: "10", label: "10 Questions" }
    ].forEach(opt => {
      const o = doc.createElement("option");
      o.value = opt.val;
      o.textContent = opt.label;
      o.style.color = "#000";
      lengthSelect.appendChild(o);
    });

    lengthContainer.appendChild(lengthLabel);
    lengthContainer.appendChild(lengthSelect);
    menu.appendChild(lengthContainer);

    const hardnessContainer = doc.createElement("div");
    hardnessContainer.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:10px;";

    const hardnessLabel = doc.createElement("span");
    hardnessLabel.textContent = "Difficulty:";
    hardnessLabel.style.cssText = "font-weight:600; font-size:12px; color:#555;";

    hardnessSelect = doc.createElement("select");
    hardnessSelect.id = "moodlepro-hardness-select";
    hardnessSelect.style.cssText = "padding:4px 8px; font-size:12px; border:1px solid #ccc; border-radius:4px; background:#fff; color:#000; cursor:pointer;";
    [
      { val: "easy", label: "Easy" },
      { val: "medium", label: "Medium" },
      { val: "hard", label: "Hard" }
    ].forEach(opt => {
      const o = doc.createElement("option");
      o.value = opt.val;
      o.textContent = opt.label;
      o.style.color = "#000";
      hardnessSelect.appendChild(o);
    });
    hardnessSelect.value = "medium";

    hardnessContainer.appendChild(hardnessLabel);
    hardnessContainer.appendChild(hardnessSelect);
    menu.appendChild(hardnessContainer);
  }

  const footer = doc.createElement("div");
  footer.style.cssText = "display:flex; justify-content:flex-end; gap:8px; margin-top:6px; border-top:1px solid #eee; padding-top:10px;";

  const cancelBtn = doc.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText = "padding:4px 10px; font-size:12px; border:1px solid #ccc; border-radius:4px; background:#fff; color:#333; cursor:pointer; font-weight:500;";
  cancelBtn.addEventListener("click", () => menu.remove());

  const generateBtn = doc.createElement("button");
  generateBtn.id = "moodlepro-generate-btn";
  generateBtn.textContent = isQuiz ? "Generate Quiz" : "Generate Summary";
  generateBtn.style.cssText = "padding:4px 12px; font-size:12px; border:none; border-radius:4px; background:#ff9800; color:#fff; cursor:pointer; font-weight:600;";
  generateBtn.addEventListener("click", () => {
    const checked = checkboxes
      .filter(c => c.checkbox.checked)
      .map(c => c.item);

    if (checked.length === 0 && items.length > 0) {
      alert("Please select at least one item.");
      return;
    }

    menu.remove();

    const numQ = lengthSelect ? parseInt(lengthSelect.value, 10) : 3;
    const diff = hardnessSelect ? hardnessSelect.value : "medium";
    onGenerate(checked, numQ, diff);
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(generateBtn);
  menu.appendChild(footer);

  const rect = anchorButton.getBoundingClientRect();
  menu.style.top = `${rect.bottom + window.scrollY}px`;
  menu.style.left = `${rect.left + window.scrollX}px`;

  menu.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  doc.body.appendChild(menu);

  const closeHandler = (e) => {
    if (!menu.contains(e.target) && e.target !== anchorButton) {
      menu.remove();
      doc.removeEventListener("click", closeHandler);
    }
  };
  doc.addEventListener("click", closeHandler);
}

export function injectCoursePageToolbar(doc, serverBaseUrl) {
  const httpBase = serverBaseUrl.replace(/\/$/, "");
  const target = doc.querySelector(".page-header-headings") || doc.querySelector("#page-header");
  if (!target) return;
  if (target.querySelector('[data-moodlepro-ui="course-page-toolbar"]')) return;

  const toolbar = doc.createElement("div");
  toolbar.setAttribute("data-moodlepro-ui", "course-page-toolbar");
  toolbar.style.cssText = "display:inline-flex; align-items:center; margin-left:15px; margin-top:5px; vertical-align:middle; gap:8px;";

  const summaryButton = doc.createElement("button");
  summaryButton.textContent = "📚 Course Summary";
  summaryButton.style.cssText = [
    "padding:6px 12px", "font-size:12px", "border:1px solid #0056b3",
    "border-radius:4px", "background:#007bff", "color:#fff", "font-weight:600", "cursor:pointer",
  ].join(";");

  const quizButton = doc.createElement("button");
  quizButton.textContent = "🧠 Course Quiz";
  quizButton.style.cssText = [
    "padding:6px 12px", "font-size:12px", "border:1px solid #28a745",
    "border-radius:4px", "background:#28a745", "color:#fff", "font-weight:600", "cursor:pointer",
  ].join(";");

  summaryButton.addEventListener("click", () => {
    const rawItems = toApiItems(scrapeCourseItems(doc));
    const academicItems = rawItems.filter(isAcademicItem);
    showSelectionMenu(doc, summaryButton, academicItems, false, (selectedItems) => {
      runCourseSummaryWithItems(doc, httpBase, selectedItems);
    });
  });

  quizButton.addEventListener("click", () => {
    const rawItems = toApiItems(scrapeCourseItems(doc));
    const academicItems = rawItems.filter(isAcademicItem);
    showSelectionMenu(doc, quizButton, academicItems, true, (selectedItems, numQuestions, difficulty) => {
      runCourseQuizWithItems(doc, httpBase, selectedItems, numQuestions, difficulty);
    });
  });

  toolbar.appendChild(summaryButton);
  toolbar.appendChild(quizButton);
  target.appendChild(toolbar);
}
