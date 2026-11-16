import { degrees, PDFDocument, PDFPage } from "pdf-lib";

/** Embed the visible source area, preserving its non-zero origin and viewer rotation. */
export async function drawVisiblePdfPage(document: PDFDocument, source: PDFPage, target: PDFPage, box: { x: number; y: number; width: number; height: number }) {
  const media = source.getMediaBox();
  const crop = source.getCropBox();
  const left = Math.max(media.x, crop.x);
  const bottom = Math.max(media.y, crop.y);
  const right = Math.min(media.x + media.width, crop.x + crop.width);
  const top = Math.min(media.y + media.height, crop.y + crop.height);
  if (right <= left || top <= bottom) throw new Error("첨부 PDF의 표시 영역을 확인할 수 없습니다.");
  const rotation = ((source.getRotation().angle % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(rotation)) throw new Error("첨부 PDF의 페이지 회전값이 올바르지 않습니다.");
  const embedded = await document.embedPage(source, { left, bottom, right, top });
  const width = right - left;
  const height = top - bottom;
  const sideways = rotation === 90 || rotation === 270;
  const visibleWidth = sideways ? height : width;
  const visibleHeight = sideways ? width : height;
  const scale = Math.min(box.width / visibleWidth, box.height / visibleHeight);
  const x = box.x + (box.width - visibleWidth * scale) / 2;
  const y = box.y + (box.height - visibleHeight * scale) / 2;
  // PDF /Rotate is clockwise; drawPage uses a counter-clockwise transform.
  const dx = rotation === 180 ? width : rotation === 270 ? height : 0;
  const dy = rotation === 90 ? width : rotation === 180 ? height : 0;
  target.drawPage(embedded, {
    x: x + dx * scale, y: y + dy * scale,
    width: width * scale, height: height * scale, rotate: degrees(-rotation),
  });
}
