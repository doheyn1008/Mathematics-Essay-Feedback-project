"use strict";

const $ = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
const key = "mathgrade-studio-v1";
const attachments = new Map();

const sampleRubric = {
  title: "미분과 함수의 극값",
  prompt: "닫힌 구간 [0, 3]에서 함수 f(x) = x³ − 3x² + 2의 최댓값과 최솟값을 구하고, 각 값을 갖는 모든 x를 풀이와 함께 쓰시오.",
  notes: "f(x)−2=x²(x−3)≤0, f(x)+2=(x−2)²(x+1)≥0과 같이 범위를 직접 증명하는 풀이도 인정합니다.",
  criteria: [
    { title: "최댓값·최솟값 판정 근거", max: 4, description: "도함수 2점, 내부 임계점과 양 끝점 확인 2점. 타당한 대안 풀이도 인정합니다." },
    { title: "함수값 비교", max: 3, description: "세 후보의 함수값을 비교하거나 상한과 하한을 증명합니다." },
    { title: "최댓값·최솟값과 모든 위치", max: 3, description: "최댓값과 최솟값 각 1점, 해당하는 x를 모두 명시하면 1점." }
  ]
};
const samples = [
  { id: "sample-a", student: "A-001", answer: "f′(x) = 3x(x − 2)\n후보는 x = 0, 2, 3이다.\nf(0) = 2, f(2) = −2, f(3) = 2\n최댓값 2 (x = 0), 최솟값 −2 (x = 2)", status: "pending",
    scores: [4, 3, 2], evidence: ["‘f′(x) = 3x(x − 2)’와 ‘x = 0, 2, 3’에서 판정 대상을 모두 확인했습니다.", "‘f(0) = 2, f(2) = −2, f(3) = 2’가 모두 정확합니다.", "‘최댓값 2 (x = 0)’에서 같은 최댓값을 갖는 x = 3이 빠졌습니다. (−1점)"],
    feedback: "후보의 함수값을 정확히 계산했어요. 최댓값 2는 x = 0과 x = 3에서 모두 나오므로 두 위치를 함께 적어 주세요." },
  { id: "sample-b", student: "A-002", answer: "0 ≤ x ≤ 3이면 f(x) − 2 = x²(x − 3) ≤ 0.\nf(x) + 2 = (x − 2)²(x + 1) ≥ 0.\n따라서 최댓값은 2 (x = 0, 3), 최솟값은 −2 (x = 2)이다.", status: "confirmed",
    scores: [4, 3, 3], evidence: ["두 인수분해로 도함수 없이 범위를 판정했습니다.", "각 부등식의 방향이 올바릅니다.", "두 부등식의 등호 성립 위치를 모두 적었습니다."], feedback: "인수분해로 함수값의 범위를 직접 증명하고 등호 성립 위치를 모두 확인했어요." },
  { id: "sample-c", student: "A-003", answer: "f′(x) = 3x(x − 2)\nx = 2에서 f(2) = −2\n따라서 최솟값은 −2이다.", status: "pending",
    scores: [2, 0, 1], evidence: ["도함수는 맞았지만 구간 양 끝점 확인이 없습니다.", "f(2)만 계산해 전체 구간에서의 비교를 생략했습니다.", "최솟값은 정확합니다. 최댓값과 해당 위치가 빠졌습니다."], feedback: "구간의 양 끝점 x = 0, 3에서도 함수값을 계산하고 x = 2의 값과 비교해 주세요." }
].map((item) => ({...item, demo: true, rubric: sampleRubric, file: null}));

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    const validRubric = (rubric) => rubric && typeof rubric === "object" && Array.isArray(rubric.criteria) && rubric.criteria.length > 0 && rubric.criteria.every((criterion) => criterion && typeof criterion === "object" && Number.isFinite(criterion.max) && criterion.max > 0);
    const validItem = (item) => item && typeof item === "object" && !Array.isArray(item) && typeof item.id === "string" && validRubric(item.rubric) && Array.isArray(item.scores) && item.scores.every((score) => score === null || Number.isFinite(score)) && Array.isArray(item.evidence) && item.evidence.every((evidence) => typeof evidence === "string");
    if (Array.isArray(saved?.items) && saved.items.every(validItem) && validRubric(saved.rubric)) return saved;
  } catch {}
  return { rubric: sampleRubric, items: samples };
}

let state = restore();
let selectedId = state.items[0]?.id;
let filter = "all";
let timer;

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => { element.hidden = true; }, 3000);
}

function persist(message) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
    toast(message);
  } catch {
    toast("이 탭에 반영했습니다. 브라우저 저장 공간이 부족하거나 차단되어 있습니다.");
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function totalOf(values) {
  return values.reduce((sum, value) => sum + Number(value ?? 0), 0);
}

function maxOf(rubric) {
  return totalOf(rubric.criteria.map(({max}) => max));
}

function format(value) {
  return Number(value.toFixed(2)).toLocaleString("ko-KR");
}

function shownItems() {
  return state.items.filter((item) => filter === "all" || item.status === filter);
}

function render() {
  const items = shownItems();
  const item = items.find(({id}) => id === selectedId) ?? items[0];
  selectedId = item?.id;
  const count = state.items.filter(({status}) => status === "confirmed").length;
  $("#total").textContent = state.items.length;
  $("#pending").textContent = state.items.length - count;
  $("#confirmed").textContent = count;
  $("#listCount").textContent = items.length;
  all("[data-filter]").forEach((button) => {
    const active = button.dataset.filter === filter;
    button.classList.toggle("chosen", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#list").innerHTML = items.length ? items.map((entry) => {
    const done = entry.status === "confirmed";
    const active = entry.id === selectedId;
    return `<button class="row ${active ? "selected" : ""}" data-id="${escapeHtml(entry.id)}" aria-pressed="${active}"><span class="row-label"><strong>${escapeHtml(entry.student)}</strong><small>${escapeHtml(entry.rubric.title)}</small></span><span class="tag ${done ? "done" : "wait"}">${done ? "확정" : "검토 대기"}</span></button>`;
  }).join("") : '<div class="empty-state">이 상태의 답안이 없습니다.</div>';

  $("#studentTitle").textContent = item ? item.student + " 풀이" : "학생 풀이";
  $("#studentType").textContent = item?.demo ? "예시 답안" : "등록 답안";
  $("#studentType").classList.toggle("empty", !item);
  if (!item) {
    $("#paperContent").innerHTML = '<div class="empty-state">목록에서 답안을 선택하거나 새로 등록하세요.</div>';
    $("#gradingContent").innerHTML = '<div class="empty-state">선택한 답안의 채점기준이 표시됩니다.</div>';
    $("#scoreTotal").textContent = "";
    return;
  }

  $("#paperContent").innerHTML = `<div class="panel"><div class="question"><strong>${escapeHtml(item.rubric.title)}</strong><p>${escapeHtml(item.rubric.prompt)}</p></div>${item.rubric.notes ? `<div class="question"><strong>등록 당시 채점 유의사항</strong><p>${escapeHtml(item.rubric.notes)}</p></div>` : ""}<div class="paper-label">답안 원문</div>${item.answer ? `<p class="answerbody">${escapeHtml(item.answer)}</p>` : ""}<div id="filePreview"></div></div>`;
  if (item.file) {
    const attachment = attachments.get(item.id);
    const preview = $("#filePreview");
    const label = document.createElement("p");
    label.className = "muted";
    label.textContent = attachment ? item.file.name : item.file.name + " · 새로고침 후 첨부 미리보기는 제공되지 않습니다.";
    preview.append(label);
    if (attachment) {
      const pdf = item.file.type === "application/pdf";
      const media = document.createElement(pdf ? "iframe" : "img");
      media.className = pdf ? "media pdf" : "media";
      media.src = attachment;
      if (pdf) {
        media.title = "학생 답안 PDF";
        const open = document.createElement("a");
        open.href = attachment;
        open.target = "_blank";
        open.rel = "noopener";
        open.textContent = "PDF 새 탭에서 열기";
        open.className = "muted";
        preview.append(open);
      } else {
        media.alt = "첨부된 학생 답안";
      }
      preview.append(media);
    }
  }
  const done = item.status === "confirmed";
  const rows = item.rubric.criteria.map((criterion, index) => {
    return `<div class="criterion"><div class="line"><label for="points-${index}">${escapeHtml(criterion.title)}</label><div class="pointControl"><input id="points-${index}" name="points" type="number" min="0" max="${criterion.max}" step="0.01" value="${item.scores[index] ?? ""}" required ${done ? "readonly" : ""}> / ${format(criterion.max)}</div></div><p class="description">${escapeHtml(criterion.description)}</p>${item.evidence[index] ? `<p class="proof">${escapeHtml(item.evidence[index])}</p>` : ""}</div>`;
  }).join("");
  $("#gradingContent").innerHTML = `<form class="reviewform" id="reviewForm"><p class="demo-note">${done ? "강사 채점 확정" : item.demo ? "예시로 준비된 첨삭 초안" : "강사 직접 채점 · 자동 첨삭 미연결"}</p>${rows}<label>학생에게 전달할 피드백<textarea name="feedback" rows="3" maxlength="5000" ${done ? "readonly" : ""}>${escapeHtml(item.feedback)}</textarea></label><div class="actions">${done ? '<button class="button secondary" type="button" id="reopen">채점 다시 열기</button>' : '<button class="button secondary" type="button" id="saveDraft">초안 저장</button><button class="button primary" type="submit">채점 확정</button>'}</div></form>`;
  const form = $("#reviewForm");
  const inputs = [...form.querySelectorAll("[name=points]")];
  function updateScore() {
    const values = inputs.map(({value}) => value);
    $("#scoreTotal").textContent = (values.some((value) => value === "") ? "—" : format(totalOf(values))) + " / " + format(maxOf(item.rubric));
  }
  updateScore();
  form.addEventListener("input", updateScore);
  function saveReview(confirm) {
    const invalid = inputs.find((input) => (confirm || input.value !== "" || input.validity.badInput) && !input.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    item.scores = inputs.map(({value}) => value === "" ? null : Number(value));
    item.feedback = form.elements.feedback.value.trim();
    if (confirm) item.status = "confirmed";
    persist(confirm ? "채점을 확정했습니다." : "채점 초안을 저장했습니다.");
    render();
  }
  form.addEventListener("submit", (event) => { event.preventDefault(); if (!done) saveReview(true); });
  $("#saveDraft")?.addEventListener("click", () => saveReview(false));
  $("#reopen")?.addEventListener("click", () => {
    item.status = "pending";
    filter = "all";
    persist("채점을 다시 열었습니다.");
    render();
  });
}

$("#list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-id]");
  if (!button) return;
  selectedId = button.dataset.id;
  render();
  all("[data-id]").find((entry) => entry.dataset.id === selectedId)?.focus();
});
all("[data-filter]").forEach((button) => button.addEventListener("click", () => {
  filter = button.dataset.filter;
  render();
}));

const addDialog = $("#addDialog");
const addForm = $("#addForm");
$("#add").addEventListener("click", () => {
  addForm.reset();
  $("#formError").textContent = "";
  $("#activeRubric").textContent = state.rubric.title + " · " + format(maxOf(state.rubric)) + "점 만점";
  addDialog.showModal();
});
["#closeAdd", "#cancelAdd"].forEach((selector) => $(selector).addEventListener("click", () => addDialog.close()));
addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const fields = new FormData(addForm);
  const student = fields.get("student").trim();
  const answer = fields.get("answer").trim();
  const file = fields.get("file");
  const hasFile = file.size > 0;
  let error = "";
  if (!student) error = "학생 식별 코드를 입력하세요.";
  else if (!answer && !hasFile) error = "풀이를 입력하거나 원본 파일을 첨부하세요.";
  else if (hasFile && !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) error = "JPG, PNG, WEBP 또는 PDF 파일을 첨부하세요.";
  else if (file.size > 15 * 1024 * 1024) error = "15 MB 이하의 파일을 첨부하세요.";
  $("#formError").textContent = error;
  if (error) return;

  const id = crypto.randomUUID();
  if (hasFile) attachments.set(id, URL.createObjectURL(file));
  state.items = [{ id, student, answer, file: hasFile ? { name: file.name, type: file.type } : null, status: "pending", rubric: structuredClone(state.rubric), scores: [], evidence: [], feedback: "" }, ...state.items];
  selectedId = id;
  filter = "all";
  addDialog.close();
  persist("답안을 등록했습니다.");
  render();
});

const rubricForm = $("#rubricForm");

function criterionRow(criterion = { title: "", max: 1, description: "" }) {
  $("#criteria").insertAdjacentHTML("beforeend", `<div class="criteria-row"><label>항목 이름<input name="criterionTitle" value="${escapeHtml(criterion.title)}" required maxlength="100"></label><label>배점<input name="maximum" type="number" min="0.01" max="1000" step="0.01" value="${criterion.max}" required></label><label>부분점수 기준<input name="description" value="${escapeHtml(criterion.description)}" maxlength="500"></label><button type="button" class="iconbtn remove" aria-label="채점 항목 삭제">×</button></div>`);
  updateRubricTotal();
}

function updateRubricTotal() {
  const rows = all("[name=maximum]");
  $("#rubricTotal").textContent = "총 배점 " + format(totalOf(rows.map(({value}) => value))) + "점";
  all(".remove").forEach((button) => { button.disabled = rows.length <= 1; });
}

function renderRubric() {
  for (const name of ["title", "prompt", "notes"]) rubricForm.elements[name].value = state.rubric[name];
  $("#criteria").replaceChildren();
  state.rubric.criteria.forEach(criterionRow);
}

$("#criterionAdd").addEventListener("click", () => criterionRow());
$("#criteria").addEventListener("input", updateRubricTotal);
$("#criteria").addEventListener("click", (event) => {
  if (event.target.matches(".remove") && all(".criteria-row").length > 1) {
    event.target.closest(".criteria-row").remove();
    updateRubricTotal();
  }
});
rubricForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const fields = new FormData(rubricForm);
  const title = fields.get("title").trim();
  const prompt = fields.get("prompt").trim();
  const descriptions = fields.getAll("description");
  const maxima = fields.getAll("maximum");
  const criteria = fields.getAll("criterionTitle").map((name, index) => ({title: name.trim(), max: Number(maxima[index]), description: descriptions[index].trim()}));
  if (!title || !prompt || !criteria.length || criteria.some((criterion) => !criterion.title)) {
    toast("문항 제목, 문제 본문, 각 항목 이름을 입력하세요.");
    return;
  }
  state.rubric = { title, prompt, notes: fields.get("notes").trim(), criteria };
  persist("채점기준을 저장했습니다.");
});

const views = {review:"첨삭 작업대", rubric:"문항 · 채점기준", api:"API 연결"};
all("[data-view]").forEach((button) => button.addEventListener("click", () => {
  const view = button.dataset.view;
  for (const name of Object.keys(views)) $("#" + name).hidden = name !== view;
  all("[data-view]").forEach((entry) => {
    const active = entry === button;
    entry.classList.toggle("active", active);
    if (active) entry.setAttribute("aria-current", "page");
    else entry.removeAttribute("aria-current");
  });
  $("#currentView").textContent = views[view];
}));

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

$("#export").addEventListener("click", () => {
  const confirmed = state.items.filter(({status}) => status === "confirmed");
  if (!confirmed.length) { toast("확정된 답안이 없습니다."); return; }
  const rows = [["학생 코드", "문항", "점수", "만점", "항목별 점수", "학생용 피드백", "답안 종류"]];
  for (const item of confirmed) {
    const criteria = item.rubric.criteria.map((criterion, index) => criterion.title + " " + item.scores[index] + "/" + criterion.max).join(" | ");
    rows.push([item.student, item.rubric.title, totalOf(item.scores), maxOf(item.rubric), criteria, item.feedback, item.demo ? "예시" : "등록"]);
  }
  const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "Q.E.D._확정결과.csv";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("확정된 답안을 CSV로 내보냈습니다.");
});

render();
renderRubric();
