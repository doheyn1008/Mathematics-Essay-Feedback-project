import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ExamFile, FeedbackVersion, SubmissionDetail } from "./product-types";
import type { PdfOptions } from "./pdf";
import { drawVisiblePdfPage } from "./pdf-page";

export type ExamPdfOptions = PdfOptions & { generatedAt?: Date };
const PAGE = { width: 595.28, height: 841.89, margin: 43, bottom: 60 };
const INK = rgb(.14, .11, .23);
const MUTED = rgb(.38, .35, .44);
const PURPLE = rgb(.38, .28, .62);
const RULE = rgb(.88, .86, .93);
const PALE = rgb(.96, .94, .98);
type Glyph = { text: string; font: PDFFont; scale: number; offset: number };

async function fetchBytes(url: string) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("출력에 필요한 파일을 불러오지 못했습니다. 권한과 원본 파일을 확인하세요.");
  return new Uint8Array(await response.arrayBuffer());
}

function date(value: string | Date) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "일시 미기록";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(parsed);
}

function resultStatus(version: FeedbackVersion) {
  if (!version.published) return "비공개 검토 초안 · 학생 공개 전";
  return version.teacherReviewed ? "선생님 검토 완료" : "AI 첨삭 결과 · 선생님 검토 전";
}

function checkedVersion(detail: SubmissionDetail) {
  const version = detail.submission.latestVersion;
  if (!version) throw new Error("출력할 첨삭 결과가 없습니다. 첨삭 완료 후 다시 시도하세요.");
  if (version.submissionId !== detail.submission.id || !Number.isInteger(version.version) || version.version < 1) {
    throw new Error("시험과 첨삭 버전이 일치하지 않습니다. 기록을 새로고침하세요.");
  }
  if (version.teacherReviewed && version.authorType !== "teacher") throw new Error("검토자 정보가 올바르지 않습니다.");
  const result = version.result;
  if (!result.items.length || result.items.length > 100) throw new Error("문항별 첨삭 결과를 확인하세요.");
  const ids = new Set<string>();
  for (const item of result.items) {
    if (!item.itemId || ids.has(item.itemId) || !Number.isFinite(item.score) || !Number.isFinite(item.maxScore) || item.maxScore <= 0 || item.score < 0 || item.score > item.maxScore) {
      throw new Error("중복 문항 또는 배점 범위를 벗어난 점수가 있어 출력할 수 없습니다.");
    }
    ids.add(item.itemId);
  }
  // Match server totals: a parent row describes the item group, not an extra score.
  const parentIds = new Set(detail.submission.exam.items.map(item => item.parentId).filter(Boolean));
  const scoredItems = result.items.filter(item => !parentIds.has(item.itemId));
  const sum = scoredItems.reduce((total, item) => total + item.score, 0);
  const maximum = scoredItems.reduce((total, item) => total + item.maxScore, 0);
  if (!Number.isFinite(result.total) || !Number.isFinite(result.maximum) || Math.abs(sum - result.total) > .001 || Math.abs(maximum - result.maximum) > .001) {
    throw new Error("문항별 점수와 시험 총점이 일치하지 않습니다.");
  }
  return version;
}

/** Render only the version and files returned by the authorized report endpoint. */
export async function generateExamFeedbackPdf(detail: SubmissionDetail, options: ExamPdfOptions = {}): Promise<Uint8Array> {
  const version = checkedVersion(detail);
  const original=detail.materials?.find(m=>m.version===(version.materialVersion??1));
  const submission=original ? {...detail.submission,files:original.files,question:original.question,materialVersion:original.version} : detail.submission;
  const result = version.result;
  const generatedAt = options.generatedAt ?? new Date();
  if (!Number.isFinite(generatedAt.getTime())) throw new Error("출력 생성 일시를 확인하세요.");
  const [fontBytes, mathFontBytes] = await Promise.all([
    options.fontBytes ?? fetchBytes("/fonts/MathgradeKorean-Regular.ttf"),
    options.mathFontBytes ?? fetchBytes("/fonts/STIXGeneral.ttf"),
  ]);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const korean = await document.embedFont(fontBytes, { subset: false });
  const math = await document.embedFont(mathFontBytes, { subset: true });
  const koreanChars = new Set(korean.getCharacterSet());
  const mathChars = new Set(math.getCharacterSet());
  const unsupported = new Set<string>();
  const loadAttachment = options.loadAttachment ?? fetchBytes;
  const width = PAGE.width - PAGE.margin * 2;
  const pages: PDFPage[] = [];
  let page: PDFPage;
  let y = 0;
  let attachmentPages = 0;

  function glyphs(text: string): Glyph[] {
    const output: Glyph[] = [];
    for (const character of text.normalize("NFC").replace(/\t/g, "    ")) {
      const code = character.codePointAt(0)!;
      if (koreanChars.has(code)) output.push({ text: character, font: korean, scale: 1, offset: 0 });
      else if (mathChars.has(code)) output.push({ text: character, font: math, scale: 1, offset: 0 });
      else if ("₀₁₂₃₄₅₆₇₈₉".includes(character)) output.push({ text: String("₀₁₂₃₄₅₆₇₈₉".indexOf(character)), font: korean, scale: .7, offset: -.2 });
      else {
        const label = `U+${code.toString(16).toUpperCase()}`;
        unsupported.add(label);
        for (const c of `[${label}]`) output.push({ text: c, font: korean, scale: 1, offset: 0 });
      }
    }
    return output;
  }

  const measure = (line: Glyph[], size: number) => line.reduce((total, glyph) => total + glyph.font.widthOfTextAtSize(glyph.text, size * glyph.scale), 0);
  function draw(line: Glyph[], x: number, baseline: number, size: number, color = INK) {
    for (const glyph of line) {
      page.drawText(glyph.text, { x, y: baseline + glyph.offset * size, size: size * glyph.scale, font: glyph.font, color });
      x += glyph.font.widthOfTextAtSize(glyph.text, size * glyph.scale);
    }
  }
  function wrap(text: string, size: number, available = width) {
    const lines: Glyph[][] = [];
    for (const paragraph of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
      let line: Glyph[] = [];
      let currentWidth = 0;
      for (const glyph of glyphs(paragraph)) {
        const next = glyph.font.widthOfTextAtSize(glyph.text, size * glyph.scale);
        if (currentWidth + next > available && line.length) { lines.push(line); line = []; currentWidth = 0; }
        line.push(glyph); currentWidth += next;
      }
      lines.push(line);
    }
    return lines;
  }
  function label(text: string, x: number, baseline: number, size: number, available = width, color = MUTED) {
    const line = glyphs(text);
    const suffix = glyphs("…");
    if (measure(line, size) > available) {
      while (line.length && measure(line, size) + measure(suffix, size) > available) line.pop();
      line.push(...suffix);
    }
    draw(line, x, baseline, size, color);
  }
  function addPage(section = "시험 첨삭 리포트") {
    page = document.addPage([PAGE.width, PAGE.height]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: PAGE.height - 5, width: PAGE.width, height: 5, color: PURPLE });
    y = PAGE.height - PAGE.margin;
    label(`Q.E.D.  /  ${section}`, PAGE.margin, y - 8, 9, width, PURPLE);
    y -= 40;
  }
  function ensure(height: number) { if (y - height < PAGE.bottom) addPage("시험 첨삭 리포트 · 계속"); }
  function write(text: string, size = 10.5, color = INK, gap = 9) {
    const leading = size * 1.65;
    for (const line of wrap(text, size)) {
      ensure(leading);
      draw(line, PAGE.margin, y - size, size, color);
      y -= leading;
    }
    y -= gap;
  }
  function heading(text: string) { ensure(60); y -= 5; write(text, 13, PURPLE, 7); }
  function labeledText(title: string, text: string) { ensure(55); write(title, 10, PURPLE, 3); write(text); }

  function scoreRow(name: string, score: string, header = false) {
    const lines = wrap(name, 10, width - 130);
    const height = Math.max(31, lines.length * 16 + 15);
    ensure(height);
    if (header) page.drawRectangle({ x: PAGE.margin, y: y - height, width, height, color: PALE });
    lines.forEach((line, index) => draw(line, PAGE.margin + 10, y - 19 - index * 16, 10, header ? PURPLE : INK));
    const scoreGlyphs = glyphs(score);
    draw(scoreGlyphs, PAGE.width - PAGE.margin - 10 - measure(scoreGlyphs, 10), y - 19, 10, header ? PURPLE : INK);
    page.drawLine({ start: { x: PAGE.margin, y: y - height }, end: { x: PAGE.width - PAGE.margin, y: y - height }, color: RULE, thickness: .6 });
    y -= height;
  }

  async function append(file: ExamFile) {
    let bytes: Uint8Array;
    try { bytes = await loadAttachment(file.url); }
    catch { throw new Error(`${file.name} 답안 원본을 불러오지 못했습니다. 원본과 접근 권한을 확인하세요.`); }
    const itemLabel = file.itemId ? submission.exam.items.find(item => item.id === file.itemId)?.label : undefined;
    const fileLabel = `${file.name}${itemLabel ? ` · ${itemLabel}` : ""}`;
    const roleLabel = file.role === "mixed" ? "문제·답안 함께 제출" : "제출 답안";
    if (file.type === "application/pdf") {
      let source: PDFDocument;
      try { source = await PDFDocument.load(bytes); }
      catch { throw new Error(`${file.name} PDF를 열 수 없습니다. 암호와 파일 손상 여부를 확인하세요.`); }
      if (!source.getPageCount()) throw new Error(`${file.name} PDF에 출력할 페이지가 없습니다.`);
      attachmentPages += source.getPageCount();
      if (attachmentPages > 100) throw new Error("답안 원본은 합계 100쪽 이내로 나누어 출력하세요.");
      for (let index = 0; index < source.getPageCount(); index++) {
        addPage(`${roleLabel} · ${index + 1}/${source.getPageCount()}쪽`);
        label(fileLabel, PAGE.margin, y, 9, width);
        y -= 18;
        await drawVisiblePdfPage(document, source.getPage(index), page, { x: PAGE.margin, y: PAGE.bottom, width, height: y - PAGE.bottom });
      }
    } else {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error(`${file.name} 파일 형식은 PDF 출력에서 지원하지 않습니다.`);
      if (++attachmentPages > 100) throw new Error("답안 원본은 합계 100쪽 이내로 나누어 출력하세요.");
      if (file.type === "image/webp") bytes = await webpToPng(bytes);
      let image;
      try { image = file.type === "image/jpeg" ? await document.embedJpg(bytes) : await document.embedPng(bytes); }
      catch { throw new Error(`${file.name} 이미지를 열 수 없습니다. 파일 손상 여부를 확인하세요.`); }
      addPage(roleLabel);
      label(fileLabel, PAGE.margin, y, 9, width);
      y -= 18;
      const scale = Math.min(width / image.width, (y - PAGE.bottom) / image.height);
      page.drawImage(image, { x: PAGE.margin + (width - image.width * scale) / 2, y: y - image.height * scale, width: image.width * scale, height: image.height * scale });
    }
  }

  addPage();
  write(submission.exam.title, 23, INK, 7);
  write(`${submission.studentName} · 시험 첨삭 결과`, 13, INK, 12);
  write(`${resultStatus(version)}  /  결과 v${version.version}`, 10, PURPLE, 5);
  write(`작성: ${version.authorName || (version.authorType === "ai" ? "AI" : "선생님")} · ${date(version.createdAt)}`, 9, MUTED, 4);
  write(`출력 생성: ${date(generatedAt)}  /  제출: ${date(submission.createdAt)}`, 9, MUTED, 12);
  write(`${Number(result.total.toFixed(2))} / ${Number(result.maximum.toFixed(2))}점`, 26, PURPLE, 15);
  write(result.basis === "provided" ? "평가 기준: 시험에 등록된 자료와 채점기준" : "평가 기준: 일반 수리논술 평가 기준 · 대학 공식 채점 결과가 아닙니다.", 9, MUTED, 10);
  heading("문항별 성적");
  scoreRow("문항 / 소문항", "점수 / 배점", true);
  const parentIds = new Set(submission.exam.items.map(item => item.parentId).filter(Boolean));
  result.items.forEach(item => scoreRow(parentIds.has(item.itemId) ? `${item.label} (상위 문항 · 합계 제외)` : item.label, `${item.score} / ${item.maxScore}`));
  scoreRow("시험 전체", `${Number(result.total.toFixed(2))} / ${Number(result.maximum.toFixed(2))}`, true);
  y -= 12;
  heading("시험 총평");
  write(result.summary || "기록된 총평이 없습니다.");
  if (result.uncertainties.length) {
    heading("판독·평가 확인 사항");
    result.uncertainties.forEach((uncertainty, index) => write(`${index + 1}. ${uncertainty}`, 10, MUTED, 5));
  }
  if (submission.question.trim()) {
    heading("제출할 때 남긴 질문");
    write(submission.question);
    heading("질문에 대한 답변");
    write(result.questionResponse || "아직 답변이 기록되지 않았습니다.");
  }
  if (submission.exam.legacyPrompt?.trim()) {
    heading("이전 기록의 문제 본문");
    write(submission.exam.legacyPrompt);
  }
  if (submission.legacyAnswer?.trim()) {
    heading("이전 기록의 학생 풀이");
    write(submission.legacyAnswer);
  }

  for (const item of result.items) {
    heading(`${item.label} · ${item.score} / ${item.maxScore}점`);
    const registered = submission.exam.items.find(value => value.id === item.itemId);
    if (registered?.parentId) {
      const parent = submission.exam.items.find(value => value.id === registered.parentId);
      if (parent) write(`상위 문항: ${parent.label}`, 9, MUTED, 5);
    }
    if (registered?.criteria) write(`등록 기준: ${registered.criteria}`, 9, MUTED, 7);
    labeledText("평가 근거", item.evidence || "평가 근거가 기록되지 않았습니다.");
    labeledText("개선 방향과 첨삭", item.feedback || "추가 첨삭이 없습니다.");
    if (item.solution) labeledText("문제 풀이 검토", item.solution);
    if (item.uncertainty) write(`확인 필요: ${item.uncertainty}`, 10, MUTED, 8);
  }

  if (detail.messages.length) {
    heading("시험 관련 질의응답");
    write("이 시험 기록에 연결된 선생님과 학생의 대화입니다. 제출 시 질문과 구분해 기록합니다.", 9, MUTED, 10);
    for (const message of [...detail.messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const item = message.itemId ? submission.exam.items.find(value => value.id === message.itemId)?.label : "시험 전체";
      ensure(55);
      write(`${message.authorRole === "teacher" ? "선생님" : "학생"} ${message.authorName} · ${date(message.createdAt)}${item ? ` · ${item}` : ""}`, 9, PURPLE, 4);
      write(message.text, 10, INK, 12);
    }
  }

  heading("자료 연결과 출처");
  write(`이 첨삭의 기준 자료: v${version.materialVersion??1} · 현재 제출 자료: v${detail.submission.materialVersion??1}`,9,MUTED,4);
  write(submission.exam.sourceLabel || "사용자 제출 자료", 9, MUTED, 4);
  if (submission.exam.sourceUrl) write(submission.exam.sourceUrl, 8.5, MUTED, 5);
  const files = [...submission.exam.files, ...submission.files].filter((file, index, all) => all.findIndex(other => other.id === file.id) === index);
  const roles = { problem: "문제", answer: "답안", mixed: "문제·답안", solution: "답지·해설", rubric: "채점기준" };
  for (const file of files.sort((a, b) => a.order - b.order)) write(`${roles[file.role]} · ${file.name}${file.itemId ? ` · 연결 문항 ${submission.exam.items.find(item => item.id === file.itemId)?.label ?? file.itemId}` : ""}`, 9, MUTED, 3);
  const answerFiles = [...submission.files].filter(file => file.role === "answer" || file.role === "mixed").sort((a, b) => a.order - b.order);
  write(answerFiles.length ? "문제·해설 원본은 별도 첨부하지 않습니다. 학생이 제출한 답안 및 문제·답안 결합 파일만 다음 페이지에 포함합니다." : "이 기록에 연결된 학생 답안 원본 파일이 없습니다.", 8.5, MUTED, 7);
  heading("결과 이력");
  write(`이 출력물은 v${version.version}의 내용을 담습니다. 이후 수정된 내용은 웹 기록에서 확인할 수 있습니다.`, 9, MUTED, 7);
  for (const historic of [...detail.versions].sort((a, b) => a.version - b.version)) {
    write(`v${historic.version} · ${historic.authorType === "ai" ? "AI 최초·재첨삭" : "선생님 첨삭"} · ${historic.authorName} · ${date(historic.createdAt)} · ${resultStatus(historic)}`, 8.5, MUTED, 4);
  }
  for (const file of answerFiles) await append(file);

  if (unsupported.size) {
    addPage("문자 표기 안내");
    write("일부 문자의 코드 표기", 16);
    write("현재 글꼴로 표시할 수 없는 문자는 해당 위치에 유니코드 번호로 표기했습니다. 수식의 정확한 모양은 제출 원본에서 확인하세요.");
    write([...unsupported].join(", "));
  }
  pages.forEach((target, index) => {
    page = target;
    page.drawLine({ start: { x: PAGE.margin, y: 43 }, end: { x: PAGE.width - PAGE.margin, y: 43 }, color: RULE, thickness: .6 });
    label(`${submission.studentName} · v${version.version} · ${resultStatus(version)}`, PAGE.margin, 29, 7.5, width - 65);
    label(`생성 ${date(generatedAt)}`, PAGE.margin, 18, 6.5, width - 65);
    const numbering = `${index + 1} / ${pages.length}`;
    page.drawText(numbering, { x: PAGE.width - PAGE.margin - korean.widthOfTextAtSize(numbering, 8), y: 25, size: 8, font: korean, color: MUTED });
  });
  document.setTitle(`${submission.studentName} - ${submission.exam.title} - v${version.version}`);
  document.setAuthor("Q.E.D.");
  document.setSubject(resultStatus(version));
  document.setCreationDate(generatedAt);
  document.setModificationDate(generatedAt);
  document.setLanguage("ko-KR");
  return document.save();
}

async function webpToPng(bytes: Uint8Array) {
  if (typeof window === "undefined") throw new Error("WEBP 답안은 브라우저에서 PDF로 출력하세요.");
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/webp" }));
  const canvas = window.document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) { bitmap.close(); throw new Error("이미지 변환을 시작하지 못했습니다."); }
  context.drawImage(bitmap, 0, 0); bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("이미지 변환에 실패했습니다.")), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function downloadExamFeedbackPdf(detail: SubmissionDetail, filename = "Q.E.D._시험첨삭리포트.pdf") {
  const bytes = await generateExamFeedbackPdf(detail);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const link = window.document.createElement("a");
  link.href = url; link.download = filename;
  window.document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
