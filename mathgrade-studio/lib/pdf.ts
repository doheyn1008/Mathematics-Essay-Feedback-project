import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Submission } from "./types";
import { drawVisiblePdfPage } from "./pdf-page";

export type PdfOptions = {
  fontBytes?: Uint8Array;
  mathFontBytes?: Uint8Array;
  loadAttachment?: (url: string) => Promise<Uint8Array>;
};

const PAGE = { width: 595.28, height: 841.89, margin: 43, bottom: 55 };
const INK = rgb(0.14, 0.11, 0.23);
const MUTED = rgb(0.37, 0.35, 0.44);
const PURPLE = rgb(0.34, 0.27, 0.76);
const RULE = rgb(0.88, 0.86, 0.93);
const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";
type Glyph = { text: string; font: PDFFont; scale: number; offset: number };

async function fetchBytes(url: string) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("PDF에 필요한 파일을 불러오지 못했습니다. 다시 시도해 주세요.");
  return new Uint8Array(await response.arrayBuffer());
}

function checkApproved(submission: Submission) {
  const review = submission.final;
  if (submission.status !== "approved" || !review) {
    throw new Error("선생님이 확정한 답안만 PDF로 내보낼 수 있습니다.");
  }
  if (submission.rubricPending || !submission.question.criteria.length) {
    throw new Error("채점기준을 등록하고 첨삭을 확정한 뒤 PDF로 내보내 주세요.");
  }
  if (submission.studentQuestion?.trim() && !review.questionResponse?.trim()) {
    throw new Error("학생의 추가 질문에 대한 확정 답변이 없습니다.");
  }
  if (review.scores.length !== submission.question.criteria.length) {
    throw new Error("채점 항목과 확정 점수가 일치하지 않습니다.");
  }
  review.scores.forEach((score, index) => {
    if (!Number.isFinite(score) || score < 0 || score > submission.question.criteria[index].max) {
      throw new Error("배점 범위를 벗어난 점수가 있어 PDF를 생성할 수 없습니다.");
    }
  });
  return review;
}

function displayDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "일시 미기록";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

/** Creates a print-ready A4 PDF from authorized, teacher-approved reports. */
export async function generateFeedbackPdf(submissions: Submission[], options: PdfOptions = {}) {
  if (submissions.length === 0) throw new Error("내보낼 확정 답안을 선택하세요.");
  if (submissions.length > 50) throw new Error("한 번에 최대 50개의 답안을 내보낼 수 있습니다.");
  submissions.forEach(checkApproved);

  const [fontBytes, mathFontBytes] = await Promise.all([
    options.fontBytes ?? fetchBytes("/fonts/MathgradeKorean-Regular.ttf"),
    options.mathFontBytes ?? fetchBytes("/fonts/STIXGeneral.ttf"),
  ]);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  // Re-subsetting this converted Korean font can drop glyph outlines; embed the prepared subset intact.
  const korean = await document.embedFont(fontBytes, { subset: false });
  const math = await document.embedFont(mathFontBytes, { subset: true });
  const koreanChars = new Set(korean.getCharacterSet());
  const mathChars = new Set(math.getCharacterSet());
  const unsupported = new Set<string>();
  const loadAttachment = options.loadAttachment ?? fetchBytes;
  const width = PAGE.width - PAGE.margin * 2;
  const pages: { page: PDFPage; student: string }[] = [];
  let page: PDFPage;
  let y = 0;
  let student = "";

  function glyphs(text: string): Glyph[] {
    const result: Glyph[] = [];
    for (const character of text.normalize("NFC").replace(/\t/g, "    ")) {
      const code = character.codePointAt(0)!;
      if (koreanChars.has(code)) result.push({ text: character, font: korean, scale: 1, offset: 0 });
      else if (mathChars.has(code)) result.push({ text: character, font: math, scale: 1, offset: 0 });
      else if (SUBSCRIPTS.includes(character)) {
        result.push({ text: String(SUBSCRIPTS.indexOf(character)), font: korean, scale: 0.7, offset: -0.2 });
      } else {
        unsupported.add(`U+${code.toString(16).toUpperCase()}`);
        for (const item of `[U+${code.toString(16).toUpperCase()}]`) {
          result.push({ text: item, font: korean, scale: 1, offset: 0 });
        }
      }
    }
    return result;
  }

  function drawGlyphs(line: Glyph[], x: number, baseline: number, size: number, color = INK) {
    for (const glyph of line) {
      page.drawText(glyph.text, {
        x, y: baseline + glyph.offset * size, size: size * glyph.scale, font: glyph.font, color,
      });
      x += glyph.font.widthOfTextAtSize(glyph.text, size * glyph.scale);
    }
  }

  function drawLabel(text: string, x: number, baseline: number, size: number, maxWidth: number, color = MUTED) {
    const line = glyphs(text);
    const measure = (items: Glyph[]) => items.reduce((sum, glyph) => sum + glyph.font.widthOfTextAtSize(glyph.text, size * glyph.scale), 0);
    if (measure(line) > maxWidth) {
      const suffix = glyphs("…");
      while (line.length && measure(line) + measure(suffix) > maxWidth) line.pop();
      line.push(...suffix);
    }
    drawGlyphs(line, x, baseline, size, color);
  }

  function addPage(label = "첨삭 리포트") {
    page = document.addPage([PAGE.width, PAGE.height]);
    pages.push({ page, student });
    y = PAGE.height - PAGE.margin;
    page.drawRectangle({ x: 0, y: PAGE.height - 5, width: PAGE.width, height: 5, color: PURPLE });
    drawLabel(`Q.E.D.  /  ${label}`, PAGE.margin, y - 8, 9, width, PURPLE);
    y -= 39;
  }

  function ensureSpace(height: number) {
    if (y - height < PAGE.bottom) addPage("첨삭 리포트 · 계속");
  }

  function write(text: string, size = 10.5, color = INK, gap = 9) {
    const leading = size * 1.65;
    for (const paragraph of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
      let line: Glyph[] = [];
      let lineWidth = 0;
      const characters = glyphs(paragraph);
      if (!characters.length) {
        ensureSpace(leading);
        y -= leading;
      }
      for (const glyph of characters) {
        const glyphWidth = glyph.font.widthOfTextAtSize(glyph.text, size * glyph.scale);
        if (lineWidth + glyphWidth > width && line.length) {
          ensureSpace(leading);
          drawGlyphs(line, PAGE.margin, y - size, size, color);
          y -= leading;
          line = [];
          lineWidth = 0;
        }
        line.push(glyph);
        lineWidth += glyphWidth;
      }
      if (line.length) {
        ensureSpace(leading);
        drawGlyphs(line, PAGE.margin, y - size, size, color);
        y -= leading;
      }
    }
    y -= gap;
  }

  function heading(title: string) {
    ensureSpace(65);
    y -= 5;
    write(title, 13, PURPLE, 6);
  }

  async function appendAttachment(submission: Submission) {
    const attachment = submission.attachment;
    if (!attachment) return;
    let bytes: Uint8Array;
    try { bytes = await loadAttachment(attachment.url); }
    catch { throw new Error(`${submission.studentCode} 답안 원본을 불러오지 못했습니다. 원본을 확인하고 다시 시도하세요.`); }
    if (attachment.type === "application/pdf") {
      let source: PDFDocument;
      try { source = await PDFDocument.load(bytes); }
      catch { throw new Error(`${attachment.name} PDF를 열 수 없습니다. 암호와 파일 손상 여부를 확인하세요.`); }
      if (source.getPageCount() === 0) throw new Error("첨부 PDF에 출력할 페이지가 없습니다.");
      if (source.getPageCount() > 100) throw new Error("첨부 PDF는 100쪽 이내로 나누어 내보내 주세요.");
      for (let index = 0; index < source.getPageCount(); index++) {
        addPage(`${student} · 제출 답안 ${index + 1}쪽`);
        await drawVisiblePdfPage(document, source.getPage(index), page, {
          x: PAGE.margin, y: PAGE.bottom, width, height: y - PAGE.bottom,
        });
      }
    } else {
      if (attachment.type === "image/webp") bytes = await webpToPng(bytes);
      let image;
      try {
        image = attachment.type === "image/jpeg" ? await document.embedJpg(bytes) : await document.embedPng(bytes);
      } catch { throw new Error(`${attachment.name} 이미지를 열 수 없습니다. 원본 파일을 확인하세요.`); }
      addPage(`${student} · 제출 답안 이미지`);
      const scale = Math.min(width / image.width, (y - PAGE.bottom) / image.height);
      page.drawImage(image, {
        x: PAGE.margin + (width - image.width * scale) / 2, y: y - image.height * scale,
        width: image.width * scale, height: image.height * scale,
      });
    }
  }

  for (const submission of submissions) {
    student = submission.studentCode;
    const review = checkApproved(submission);
    const question = submission.question;
    const total = review.scores.reduce((sum, score) => sum + score, 0);
    const maximum = question.criteria.reduce((sum, criterion) => sum + criterion.max, 0);
    addPage();
    write(`${student} 첨삭 리포트`, 23, INK, 8);
    write(question.title, 13, INK, 5);
    write(`선생님 확정  ·  ${displayDate(review.reviewedAt)}  ·  ${Number(total.toFixed(2))} / ${Number(maximum.toFixed(2))}점`, 10, MUTED, 17);
    heading("학생 풀이");
    write(submission.answer || "제출한 원본 답안은 이 리포트 뒤에 첨부되어 있습니다.");
    if (submission.studentQuestion?.trim()) {
      heading("학생의 추가 질문");
      write(submission.studentQuestion);
      heading("질문에 대한 답변");
      write(review.questionResponse!);
    }
    heading("항목별 평가");
    question.criteria.forEach((criterion, index) => {
      ensureSpace(65);
      write(`${criterion.title}  ·  ${review.scores[index]} / ${criterion.max}점`, 11.5, INK, 4);
      if (criterion.description) write(`채점기준  ${criterion.description}`, 9.5, MUTED, 4);
      write(review.evidence[index] || "항목별 근거가 기록되지 않았습니다.", 10, INK, 12);
    });
    heading("선생님 피드백");
    write(review.feedback || "추가 피드백이 없습니다.");
    heading("문항 출처");
    const source = [question.university, question.academicYear ? `${question.academicYear}학년도` : "", question.sourceLabel].filter(Boolean).join(" · ");
    write(source || "자체 등록 문항", 9, MUTED, 4);
    if (question.sourceUrl) write(question.sourceUrl, 8.5, MUTED, 4);
    // A submitted problem original is a private reference, not an output attachment.
    // Only the student's answer attachment is appended to this report.
    await appendAttachment(submission);
  }

  if (unsupported.size) {
    addPage("문자 표기 안내");
    write("일부 문자의 코드 표기", 16);
    write("현재 글꼴로 표시할 수 없는 문자는 해당 위치에 유니코드 번호로 표기했습니다. 수식의 정확한 모양은 제출 원본에서 확인하세요.");
    write([...unsupported].join(", "));
  }
  pages.forEach(({ page: target, student: name }, index) => {
    page = target;
    target.drawLine({ start: { x: PAGE.margin, y: 38 }, end: { x: PAGE.width - PAGE.margin, y: 38 }, color: RULE, thickness: 0.6 });
    drawLabel(`${name} · 선생님 확정`, PAGE.margin, 24, 8, width - 65, MUTED);
    const numbering = `${index + 1} / ${pages.length}`;
    target.drawText(numbering, { x: PAGE.width - PAGE.margin - korean.widthOfTextAtSize(numbering, 8), y: 24, size: 8, font: korean, color: MUTED });
  });
  document.setTitle(submissions.length === 1 ? `${student} 첨삭 리포트` : "Q.E.D. 첨삭 리포트 모음");
  document.setAuthor("Q.E.D.");
  document.setLanguage("ko-KR");
  return document.save();
}

async function webpToPng(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof window === "undefined") throw new Error("WEBP 답안은 브라우저에서 PDF로 내보내 주세요.");
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/webp" }));
  const canvas = window.document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) { bitmap.close(); throw new Error("이미지 변환을 시작하지 못했습니다."); }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const result = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob); else reject(new Error("이미지 변환에 실패했습니다."));
  }, "image/png"));
  return new Uint8Array(await result.arrayBuffer());
}

export async function downloadFeedbackPdf(submissions: Submission[], filename = "Q.E.D._첨삭리포트.pdf") {
  const bytes = await generateFeedbackPdf(submissions);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename;
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
