import { getFixedReport, problems } from './data.js';

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MIN_ANSWER_LENGTH = 30;
export const MAX_ANSWER_LENGTH = 20000;
export const ALLOWED_FILE_TYPES = Object.freeze({
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
});

export function validateFile(file) {
  if (!file) return { valid: true, errors: [], kind: null };
  const errors = [];
  const extension = String(file.name || '').split('.').pop().toLowerCase();
  const mimeType = String(file.type || '').toLowerCase();
  const matchingType = Object.entries(ALLOWED_FILE_TYPES).find(([type, extensions]) => (
    extensions.includes(extension) && (!mimeType || mimeType === type)
  ));
  if (!matchingType) errors.push('JPG, PNG, WEBP 이미지 또는 PDF 파일을 선택해 주세요.');
  if (!Number.isFinite(file.size) || file.size <= 0) errors.push('비어 있거나 크기를 확인할 수 없는 파일이에요.');
  else if (file.size > MAX_FILE_SIZE) errors.push('파일 크기는 10MB 이하여야 해요.');
  return { valid: errors.length === 0, errors, kind: matchingType?.[0].startsWith('image/') ? 'image' : matchingType ? 'pdf' : null };
}

export function validateSubmission({ problemId, answer = '', file = null } = {}) {
  const errors = [];
  if (!problems.some((problem) => problem.id === problemId)) errors.push('첨삭할 예제 문제를 선택해 주세요.');
  const text = typeof answer === 'string' ? answer.trim() : '';
  if (!file && text.length < MIN_ANSWER_LENGTH) errors.push('풀이를 30자 이상 입력하거나 답안 파일을 선택해 주세요.');
  if (text.length > MAX_ANSWER_LENGTH) errors.push('풀이는 20,000자 이내로 입력해 주세요.');
  const fileValidation = validateFile(file);
  errors.push(...fileValidation.errors);
  return { valid: errors.length === 0, errors };
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// This adapter never sends an answer or file to an external service.
// Scores and comments belong to the fixed example answer, not the user's input.
// Replace this adapter with an authenticated server endpoint when the backend is ready.
export function createDemoReport({ problemId, answer = '', fileName = '' } = {}) {
  const template = getFixedReport(problemId);
  if (!template) throw new Error('선택한 문제를 찾을 수 없어요.');
  const report = JSON.parse(JSON.stringify(template));
  return {
    ...report,
    id: `demo-${makeId()}`,
    createdAt: new Date().toISOString(),
    submittedAnswer: typeof answer === 'string' ? answer.slice(0, MAX_ANSWER_LENGTH) : '',
    submittedFileName: typeof fileName === 'string' ? fileName.slice(0, 255) : '',
  };
}
