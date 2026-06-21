import { COLORS, addHoverEffect } from "./theme.js";

/** A small popup to pick quiz length + difficulty, anchored under a button.
 *  Calls onConfirm(numQuestions, difficulty) when the user clicks Generate. */
export function showQuizConfig(doc, anchorButton, onConfirm) {
  const existing = doc.getElementById("moodlepro-quiz-config");
  if (existing) existing.remove();

  const menu = doc.createElement("div");
  menu.id = "moodlepro-quiz-config";
  menu.setAttribute("data-moodlepro-ui", "1");
  menu.style.cssText = [
    "position:absolute", "z-index:2147483500", "background:#fff", "border:1px solid " + COLORS.border,
    "border-radius:10px", "box-shadow:0 4px 16px rgba(0,0,0,.2)", "padding:14px",
    "width:240px", "font-family:sans-serif", "color:#222", "display:flex",
    "flex-direction:column", "gap:10px",
  ].join(";");

  const title = doc.createElement("div");
  title.textContent = "Quiz options";
  title.style.cssText = "font-weight:bold;font-size:13px;color:#111;";
  menu.appendChild(title);

  function makeRow(labelText, options, defaultValue) {
    const row = doc.createElement("div");
    row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;";
    const label = doc.createElement("span");
    label.textContent = labelText;
    label.style.cssText = "font-size:12px;color:#555;";
    const select = doc.createElement("select");
    select.style.cssText = "padding:3px 6px;font-size:12px;border:1px solid #ccc;border-radius:4px;background:#fff;color:#000;cursor:pointer;";
    options.forEach(({ val, label: optLabel }) => {
      const o = doc.createElement("option");
      o.value = val;
      o.textContent = optLabel;
      select.appendChild(o);
    });
    select.value = defaultValue;
    row.appendChild(label);
    row.appendChild(select);
    menu.appendChild(row);
    return select;
  }

  const lengthSelect = makeRow("Questions", [
    { val: "3", label: "3" },
    { val: "5", label: "5" },
    { val: "10", label: "10" },
  ], "5");

  const difficultySelect = makeRow("Difficulty", [
    { val: "easy", label: "Easy" },
    { val: "medium", label: "Medium" },
    { val: "hard", label: "Hard" },
  ], "medium");

  const footer = doc.createElement("div");
  footer.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";

  const cancelBtn = doc.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText = "padding:4px 10px;font-size:12px;border:1px solid #ccc;border-radius:4px;background:#fff;color:#333;cursor:pointer;";
  cancelBtn.addEventListener("click", () => menu.remove());

  const generateBtn = doc.createElement("button");
  generateBtn.textContent = "Generate";
  generateBtn.style.cssText = "padding:4px 12px;font-size:12px;border:none;border-radius:6px;background:" + COLORS.orange + ";color:#fff;cursor:pointer;font-weight:600;transition:background .15s ease;";
  addHoverEffect(generateBtn, COLORS.orange, COLORS.orangeDeep);
  generateBtn.addEventListener("click", () => {
    const numQuestions = parseInt(lengthSelect.value, 10);
    const difficulty = difficultySelect.value;
    menu.remove();
    onConfirm(numQuestions, difficulty);
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(generateBtn);
  menu.appendChild(footer);

  menu.addEventListener("click", (e) => e.stopPropagation());

  if (anchorButton && typeof anchorButton.getBoundingClientRect === "function") {
    const rect = anchorButton.getBoundingClientRect();
    menu.style.top = `${rect.bottom + (doc.defaultView?.scrollY || 0)}px`;
    menu.style.left = `${rect.left + (doc.defaultView?.scrollX || 0)}px`;
  }
  doc.body.appendChild(menu);

  const closeHandler = (e) => {
    if (!menu.contains(e.target) && e.target !== anchorButton) {
      menu.remove();
      doc.removeEventListener("click", closeHandler);
    }
  };
  doc.addEventListener("click", closeHandler);

  return menu;
}
