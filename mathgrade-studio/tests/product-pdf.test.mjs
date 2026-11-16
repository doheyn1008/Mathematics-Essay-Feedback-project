import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PDFDocument, degrees, rgb, PDFName, PDFDict, PDFRawStream } from 'pdf-lib';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(join(root, '.sites-runtime'), { recursive: true });
const temp = await mkdtemp(join(root, '.sites-runtime/pdf-tests-'));
after(() => rm(temp, { recursive: true, force: true }));
for (const name of ['pdf-page', 'product-pdf', 'pdf']) {
  const source = await readFile(join(root, 'lib', `${name}.ts`), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replaceAll('"./pdf-page"', '"./pdf-page.mjs"');
  await writeFile(join(temp, `${name}.mjs`), output);
}
const { generateExamFeedbackPdf } = await import(pathToFileURL(join(temp, 'product-pdf.mjs')));
const { drawVisiblePdfPage } = await import(pathToFileURL(join(temp, 'pdf-page.mjs')));
const { generateFeedbackPdf } = await import(pathToFileURL(join(temp, 'pdf.mjs')));
const fonts = {
  fontBytes: await readFile(join(root, 'public/fonts/MathgradeKorean-Regular.ttf')),
  mathFontBytes: await readFile(join(root, 'public/fonts/STIXGeneral.ttf')),
  generatedAt: new Date('2026-11-15T10:20:00Z'),
};
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCCsAAAAASUVORK5CYII=', 'base64'));
const timestamp = '2026-11-15T09:00:00Z';
const file = (id, role, order, type = 'application/pdf') => ({ id, role, order, type, url: `/api/product/files/${id}`, name: `${id}.${type === 'application/pdf' ? 'pdf' : 'png'}`, size: 100 });
function detailFixture() {
  const items = [
    { itemId: 'a', label: '1-(1) 극한과 연속', score: 35, maxScore: 40, evidence: '극한값을 올바르게 구했습니다.', feedback: '좌극한과 우극한이 같은 이유를 설명하세요.', solution: 'lim f(x) = 2, x² + α = 4', uncertainty: '' },
    { itemId: 'b', label: '1-(2) 미분과 활용', score: 45, maxScore: 60, evidence: '부호 변화를 일부 빠뜨렸습니다.', feedback: '선생님이 추가한 최신 피드백: 경계값을 함께 확인하세요.', solution: 'f′(x) = 3x² - 3', uncertainty: '답안 2쪽의 마지막 부호를 확인해야 합니다.' },
  ];
  const ai = { id: 'v1', submissionId: 's1', version: 1, authorId: 'ai', authorName: 'AI 예시', authorType: 'ai', createdAt: timestamp, teacherReviewed: false, published: true, result: { items, total: 80, maximum: 100, summary: '최초 AI 결과', questionResponse: '양끝 값을 비교합니다.', basis: 'general', uncertainties: [] } };
  const latest = structuredClone(ai);
  Object.assign(latest, { id: 'v2', version: 2, authorId: 'teacher1', authorName: '김선생', authorType: 'teacher', teacherReviewed: true, createdAt: '2026-11-15T10:00:00Z' });
  latest.result.summary = '최신 선생님 총평: 논리의 연결은 좋습니다. 누락한 조건을 보완하세요.';
  return { submission: { id: 's1', studentId: 'student1', studentName: '예시 학생', submittedBy: 'teacher1', classId: 'class1', assignmentId: 'assignment1', billingUserId: 'teacher1', exam: { id: 'exam1', ownerId: 'teacher1', classId: 'class1', title: '11월 수리논술 진단평가', sourceLabel: '검증용 자체 제작 시험', sourceUrl: '', items: items.map(i => ({ id: i.itemId, label: i.label, maxScore: i.maxScore, criteria: '논리 전개와 계산 과정을 평가합니다.' })), files: [file('problem-only', 'problem', 0)], releaseMode: 'ai_immediate', revision: 1, createdAt: timestamp }, files: [], question: '경계값을 왜 확인하나요?', processing: 'completed', visibility: 'visible', reviewStatus: 'reviewed', releaseMode: 'ai_immediate', latestVersion: latest, revision: 3, createdAt: timestamp, updatedAt: latest.createdAt }, versions: [ai, latest], messages: [{ id: 'chat1', submissionId: 's1', authorId: 'student1', authorName: '예시 학생', authorRole: 'student', itemId: 'b', text: '이 문항의 감점 이유를 더 설명해 주세요.', createdAt: timestamp }] };
}

async function sourcePdf(rotation = 0) {
  const document = await PDFDocument.create();
  const page = document.addPage([600, 800]);
  page.setMediaBox(100, 100, 600, 800);
  page.setCropBox(120, 130, 400, 600);
  page.drawRectangle({ x: 130, y: 140, width: 40, height: 40, color: rgb(1, 0, 0) });
  page.drawRectangle({ x: 470, y: 680, width: 40, height: 40, color: rgb(0, 1, 0) });
  page.drawRectangle({ x: 130, y: 680, width: 40, height: 40, color: rgb(0, 0, 1) });
  page.drawRectangle({ x: 470, y: 140, width: 40, height: 40, color: rgb(1, 0, 1) });
  page.setRotation(degrees(rotation));
  return document;
}

test('exam PDF uses the latest authorized version and ordered answer/mixed files only', async () => {
  const detail = detailFixture();
  const source = await sourcePdf(180);
  const sourceBytes = await source.save();
  detail.submission.files = [file('second', 'answer', 2, 'image/png'), file('not-an-answer', 'problem', 0), file('first', 'mixed', 1)];
  const loaded = [];
  const bytes = await generateExamFeedbackPdf(detail, { ...fonts, loadAttachment: async url => { loaded.push(url); return url.endsWith('/second') ? png : sourceBytes; } });
  const pdf = await PDFDocument.load(bytes);
  assert.deepEqual(loaded, ['/api/product/files/first', '/api/product/files/second']);
  assert.equal(pdf.getTitle(), '예시 학생 - 11월 수리논술 진단평가 - v2');
  assert.equal(pdf.getSubject(), '선생님 검토 완료');
  assert.equal(pdf.getCreationDate().toISOString(), fonts.generatedAt.toISOString());
  assert.ok(pdf.getPageCount() >= 4);
});

test('PDF rejects missing results, inconsistent totals, duplicated items and forged review status', async () => {
  const bad = detailFixture();
  bad.submission.latestVersion = null;
  await assert.rejects(() => generateExamFeedbackPdf(bad, fonts), /출력할 첨삭 결과/);
  for (const change of [
    d => { d.submission.latestVersion.result.total = 90; },
    d => { d.submission.latestVersion.result.items[1].itemId = 'a'; },
    d => { d.submission.latestVersion.result.items[0].score = 41; },
    d => { d.submission.latestVersion.authorType = 'ai'; },
    d => { d.submission.latestVersion.submissionId = 'someone-else'; },
  ]) {
    const detail = detailFixture(); change(detail);
    await assert.rejects(() => generateExamFeedbackPdf(detail, fonts));
  }
});

test('nested exam scores count leaf items once rather than double-counting parent rows', async () => {
  const detail = detailFixture();
  const parent = { id: 'parent', label: '1번 전체', maxScore: 100, criteria: '소문항을 묶은 상위 문항' };
  detail.submission.exam.items = [parent, ...detail.submission.exam.items.map(item => ({ ...item, parentId: parent.id }))];
  detail.submission.latestVersion.result.items.unshift({ itemId: parent.id, label: parent.label, score: 80, maxScore: 100, evidence: '소문항 결과의 요약', feedback: '소문항 피드백을 확인하세요.', solution: '', uncertainty: '' });
  const bytes = await generateExamFeedbackPdf(detail, fonts);
  assert.equal((await PDFDocument.load(bytes)).getSubject(), '선생님 검토 완료');
  detail.submission.latestVersion.result.total = 160;
  detail.submission.latestVersion.result.maximum = 200;
  await assert.rejects(() => generateExamFeedbackPdf(detail, fonts), /문항별 점수와 시험 총점/);
});

const extractor = spawnSync('pdftotext', ['-v']);
test('migrated text-only records retain their original problem and student answer', { skip: extractor.error?.code === 'ENOENT' }, async () => {
  const detail = detailFixture();
  detail.submission.exam.legacyPrompt = '이전 문제 원문: 함수 f(x)의 극한을 구하시오.';
  detail.submission.legacyAnswer = '이전 학생 풀이: 좌극한과 우극한을 각각 계산했습니다.';
  const path = join(temp, 'legacy-text.pdf');
  await writeFile(path, await generateExamFeedbackPdf(detail, fonts));
  const extract = spawnSync('pdftotext', [path, '-'], { encoding: 'utf8' });
  assert.equal(extract.status, 0, extract.stderr);
  assert.ok(extract.stdout.includes(detail.submission.exam.legacyPrompt));
  assert.ok(extract.stdout.includes(detail.submission.legacyAnswer));
  assert.ok(extract.stdout.includes('최신 선생님 총평'));
});

test('AI results and private teacher drafts remain visibly distinct in the report', async () => {
  const ai = detailFixture(); ai.submission.latestVersion = ai.versions[0];
  assert.equal((await PDFDocument.load(await generateExamFeedbackPdf(ai, fonts))).getSubject(), 'AI 첨삭 결과 · 선생님 검토 전');
  const draft = detailFixture(); draft.submission.latestVersion.published = false;
  assert.equal((await PDFDocument.load(await generateExamFeedbackPdf(draft, fonts))).getSubject(), '비공개 검토 초안 · 학생 공개 전');
});

test('embedding preserves a non-zero visible bounding box and its origin transform', async () => {
  const source = await sourcePdf();
  const target = await PDFDocument.create();
  const page = target.addPage([400, 600]);
  await drawVisiblePdfPage(target, source.getPage(0), page, { x: 0, y: 0, width: 400, height: 600 });
  const saved = await PDFDocument.load(await target.save());
  const resources = saved.getPage(0).node.Resources();
  const xObjects = resources.lookup(PDFName.of('XObject'), PDFDict);
  const object = xObjects.lookup(xObjects.keys()[0], PDFRawStream);
  assert.equal(object.dict.get(PDFName.of('BBox')).toString(), '[ 120 130 520 730 ]');
  assert.equal(object.dict.get(PDFName.of('Matrix')).toString(), '[ 1 0 0 1 -120 -130 ]');
});

const renderer = spawnSync('pdftoppm', ['-v']);
function coloredCorners(bytes) {
  const headerEnd = bytes.indexOf(Buffer.from('\n255\n')) + 5;
  const [width, height] = bytes.subarray(0, headerEnd).toString().split('\n')[1].split(' ').map(Number);
  const bounds = Array.from({ length: 4 }, () => [width, height, -1, -1]);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = headerEnd + (y * width + x) * 3;
    const [r, g, b] = bytes.subarray(offset, offset + 3);
    const color = r > 200 && g < 50 && b < 50 ? 0 : r < 50 && g > 200 && b < 50 ? 1 : r < 50 && g < 50 && b > 200 ? 2 : r > 200 && g < 50 && b > 200 ? 3 : -1;
    if (color >= 0) bounds[color] = [Math.min(bounds[color][0], x), Math.min(bounds[color][1], y), Math.max(bounds[color][2], x), Math.max(bounds[color][3], y)];
  }
  return { width, height, bounds };
}
test('all four source rotations render the same colored corners after embedding', { skip: renderer.error?.code === 'ENOENT' }, async () => {
  for (const rotation of [0, 90, 180, 270]) {
    const source = await sourcePdf(rotation);
    const target = await PDFDocument.create();
    const sideways = rotation === 90 || rotation === 270;
    const page = target.addPage(sideways ? [600, 400] : [400, 600]);
    await drawVisiblePdfPage(target, source.getPage(0), page, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
    for (const [name, document] of [['source', source], ['target', target]]) {
      const path = join(temp, `${name}-${rotation}`);
      await writeFile(`${path}.pdf`, await document.save());
      const render = spawnSync('pdftoppm', ['-r', '72', '-cropbox', '-singlefile', `${path}.pdf`, path]);
      assert.equal(render.status, 0, render.stderr?.toString());
    }
    const sourcePixels = await readFile(join(temp, `source-${rotation}.ppm`));
    const targetPixels = await readFile(join(temp, `target-${rotation}.ppm`));
    assert.deepEqual(coloredCorners(targetPixels), coloredCorners(sourcePixels), `rotation ${rotation} must preserve the visible orientation and crop`);
  }
});

test('legacy PDF still exports approved records through the corrected page embedding', async () => {
  const input = { id: 'legacy1', studentId: 's', studentCode: '기존 학생', academyId: 'c', assignmentId: 'a', mode: 'academy', question: { id: 'q', title: '기존 문항', prompt: '', criteria: [{ id: '1', title: '논리', max: 100, description: '' }], sourceLabel: '자체 제작' }, answer: '기존 풀이', attachment: file('legacy-answer', 'answer', 0), status: 'approved', draft: null, final: { scores: [90], feedback: '기존 첨삭', evidence: ['근거'], reviewedAt: timestamp, reviewerId: 't' }, revision: 1, createdAt: timestamp, updatedAt: timestamp };
  const source = await sourcePdf(90);
  const bytes = await generateFeedbackPdf([input], { ...fonts, loadAttachment: async () => source.save() });
  assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 2);
});

// For manual visual QA only; a fixture remains inside ignored runtime storage.
if (process.env.MATHGRADE_PDF_QA_PATH) {
  const path = process.env.MATHGRADE_PDF_QA_PATH;
  await mkdir(dirname(path), { recursive: true });
  const detail = detailFixture();
  detail.submission.exam.legacyPrompt = '이전 문제 원문: 함수 f(x)의 극한을 구하시오.';
  detail.submission.legacyAnswer = '이전 학생 풀이: 좌극한과 우극한을 각각 계산했습니다.';
  await writeFile(path, await generateExamFeedbackPdf(detail, fonts));
}
