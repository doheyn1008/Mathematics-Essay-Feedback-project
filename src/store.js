export const STORAGE_KEY = 'puleegyeol.demo.v1';
const VERSION = 1;

export function createInitialState() {
  return { version: VERSION, account: null, submissions: [], activePlan: null };
}

function defaultStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

function text(value, max = 20000) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function dateTime(value, fallback = new Date().toISOString()) {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, 20).map((item) => item.slice(0, 5000)) : [];
}

function normalizeReport(value) {
  if (!value || typeof value !== 'object' || value.isDemo !== true || value.source !== 'fixed-example') return null;
  if (!Number.isFinite(value.score) || value.score < 0 || value.score > 100) return null;
  const criteria = Array.isArray(value.criteria) ? value.criteria.filter((item) => item && typeof item === 'object' && Number.isFinite(item.score) && Number.isFinite(item.max) && item.max > 0 && item.score >= 0 && item.score <= item.max).slice(0, 10).map((item) => ({
    label: text(item.label, 100), max: item.max, score: item.score, comment: text(item.comment, 5000),
  })) : [];
  return {
    id: text(value.id, 100), problemId: text(value.problemId, 100), title: text(value.title, 200),
    score: value.score, maxScore: 100, isDemo: true, source: 'fixed-example',
    demoNotice: text(value.demoNotice, 1000), summary: text(value.summary, 5000), criteria,
    strengths: stringList(value.strengths), improvements: stringList(value.improvements), nextSteps: stringList(value.nextSteps),
    sampleAnswer: text(value.sampleAnswer), improvedAnswer: text(value.improvedAnswer),
    submittedAnswer: text(value.submittedAnswer), submittedFileName: text(value.submittedFileName, 255),
    createdAt: dateTime(value.createdAt),
  };
}

function normalizeSubmission(value) {
  if (!value || typeof value !== 'object' || !text(value.id, 100) || !text(value.problemId, 100)) return null;
  const problemId = text(value.problemId, 100);
  const candidateReport = normalizeReport(value.report);
  const report = candidateReport?.problemId === problemId ? candidateReport : null;
  const createdAt = dateTime(value.createdAt);
  return {
    id: text(value.id, 100), problemId, answer: text(value.answer),
    fileName: text(value.fileName, 255), status: value.status === 'completed' && report ? 'completed' : 'draft',
    createdAt, updatedAt: dateTime(value.updatedAt, createdAt), report,
  };
}

function normalizeState(value) {
  if (!value || typeof value !== 'object' || value.version !== VERSION) return createInitialState();
  return {
    version: VERSION,
    account: value.account && text(value.account.name, 40).trim() ? { name: text(value.account.name, 40).trim() } : null,
    submissions: Array.isArray(value.submissions) ? value.submissions.map(normalizeSubmission).filter(Boolean).slice(0, 100) : [],
    activePlan: typeof value.activePlan === 'string' ? value.activePlan.slice(0, 40) : null,
  };
}

export function loadState(storage = defaultStorage()) {
  try {
    if (!storage) return createInitialState();
    const stored = storage.getItem(STORAGE_KEY);
    return stored ? normalizeState(JSON.parse(stored)) : createInitialState();
  } catch { return createInitialState(); }
}

export function saveState(state, storage = defaultStorage()) {
  const normalized = normalizeState(state);
  try {
    if (!storage) return { ok: false, state: normalized, error: '이 브라우저에서는 저장 기능을 사용할 수 없어요.' };
    storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return { ok: true, state: normalized, error: null };
  } catch {
    return { ok: false, state: normalized, error: '브라우저 저장 공간을 사용할 수 없어 이번 변경은 현재 화면에서만 유지돼요.' };
  }
}

export function resetState(storage = defaultStorage()) {
  try { storage?.removeItem(STORAGE_KEY); } catch { /* The in-memory state can still be reset. */ }
  return createInitialState();
}

let sequence = 0;
export function createSubmission({ problemId, answer = '', fileName = '', report = null } = {}) {
  const now = new Date().toISOString();
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${++sequence}`;
  return normalizeSubmission({
    id, problemId, answer, fileName, report,
    status: report ? 'completed' : 'draft', createdAt: now, updatedAt: now,
  });
}

export function getSubmission(state, id) {
  return Array.isArray(state?.submissions) ? state.submissions.find((item) => item.id === id) || null : null;
}

export function updateSubmission(state, id, patch = {}) {
  const normalized = normalizeState(state);
  return {
    ...normalized,
    submissions: normalized.submissions.map((item) => item.id === id ? normalizeSubmission({
      ...item,
      problemId: patch.problemId === undefined ? item.problemId : text(patch.problemId, 100) || item.problemId,
      answer: patch.answer === undefined ? item.answer : patch.answer,
      fileName: patch.fileName === undefined ? item.fileName : patch.fileName,
      report: patch.report === undefined ? item.report : patch.report,
      status: patch.status === undefined ? item.status : patch.status,
      updatedAt: new Date().toISOString(),
    }) : item),
  };
}
