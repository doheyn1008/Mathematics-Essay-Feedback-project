import { problems, sampleReports } from './data.js';
import { loadState, saveState, resetState, createSubmission, getSubmission, updateSubmission } from './store.js';
import { validateSubmission, validateFile, createDemoReport } from './services.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#account-dialog');
let state = loadState();
let attachment = null;
let attachmentUrl = null;
let toastTimer;
let libraryTopic = '전체';
let historyTab = 'all';
let storageWarningShown = false;
let menuOpen = false;
const draft = () => state.submissions.find((item) => item.status === 'draft');
let draftProblem = draft()?.problemId || problems[0].id;
let draftAnswer = draft()?.answer || '';

const esc = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const iconPaths = {
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  pen: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15Z"/>',
  book: '<path d="M12 6v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2Z"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7m2-4v6l4 2"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  file: '<path d="M14 2H5v20h14V7Zm0 0v6h5M8 13h8M8 17h5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  logout: '<path d="M9 4H4v16h5m6-13 5 5-5 5m-7-5h12"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
};
const icon = (name, className = '') => `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.arrow}</svg>`;
const brand = () => `<a class="brand" href="#/" aria-label="풀이결 홈"><span class="brand-mark" aria-hidden="true">∑</span><span>풀이결<span class="brand-dot">.</span></span></a>`;
const problemById = (id) => problems.find((item) => item.id === id) || problems[0];
const date = (value) => new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date(value));
const button = (label, href, className = 'button primary') => `<a class="${className}" href="${href}">${label}${icon('arrow')}</a>`;

function toast(message) {
  const target = document.querySelector('#toast');
  target.textContent = message;
  target.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => target.classList.remove('visible'), 4000);
}

function persist() {
  const result = saveState(state);
  state = result.state;
  if (!result.ok && !storageWarningShown) {
    storageWarningShown = true;
    toast('브라우저 저장 공간을 사용할 수 없어 이번 화면에서만 기록을 유지해요.');
  }
}

function header() {
  return `<header class="site-header"><div class="header-inner">${brand()}<nav class="desktop-nav" aria-label="주 메뉴"><a href="#/" data-action="how">이용 방법</a><a href="#/library">문제 자료실</a><a href="#/pricing">이용권 안내</a></nav><div class="header-actions"><span class="demo-pill"><i></i>공개 체험</span><button class="text-button account-trigger" data-action="account">${state.account ? esc(state.account.name) + ' 님' : '로그인'}</button>${button('나의 학습실', '#/workspace', 'button small primary')}<button class="icon-button mobile-menu" aria-label="메뉴 ${menuOpen ? '닫기' : '열기'}" aria-expanded="${menuOpen}" data-action="menu">${icon(menuOpen ? 'close' : 'menu')}</button></div></div>${menuOpen ? '<nav class="mobile-nav" aria-label="모바일 메뉴"><a href="#/workspace">나의 학습실</a><a href="#/library">문제 자료실</a><a href="#/pricing">이용권 안내</a><button data-action="account">체험 계정</button></nav>' : ''}</header>`;
}

function footer() {
  return `<footer class="site-footer"><div>${brand()}<p>정답을 넘어, 풀이의 결을 읽다.</p></div><div class="footer-note"><span>API 연결 전 체험 사이트</span><p>문제와 리포트는 서비스를 설명하기 위한 자체 제작 예시입니다.</p><p>실제 AI 첨삭·회원 인증·결제는 제공하지 않습니다.</p></div><span class="copyright">© ${new Date().getFullYear()} 풀이결</span></footer>`;
}

function graph(className = '') {
  return `<svg class="function-graph ${className}" viewBox="0 0 420 270" role="img" aria-label="삼차함수 f(x)=x³−3x의 개형. 극댓값 2와 극솟값 −2를 표시한 예시 그래프"><defs><pattern id="grid-${className || 'hero'}" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="currentColor" stroke-opacity=".08"/></pattern></defs><rect width="420" height="270" fill="url(#grid-${className || 'hero'})"/><path class="graph-axis" d="M30 135h360M210 20v230"/><path class="graph-tick" d="M150 131v8M270 131v8M206 65h8M206 205h8"/><path class="graph-guides" d="M150 135V65h60m60 70v70h-60"/><path class="graph-line" d="M85 233C105 130 116 65 150 65S181 135 210 135 238 205 270 205 316 120 335 37"/><circle class="graph-point" cx="150" cy="65" r="5"/><circle class="graph-point" cx="270" cy="205" r="5"/><g class="graph-labels"><text x="390" y="154">x</text><text x="221" y="25">y</text><text x="192" y="154">O</text><text x="137" y="155">−1</text><text x="267" y="155">1</text><text x="220" y="69">2</text><text x="218" y="209">−2</text><text x="83" y="43" class="graph-equation">f(x) = x³ − 3x</text></g></svg>`;
}

function landing() {
  return `${header()}<main id="main" tabindex="-1"><section class="hero page-width"><div class="hero-copy"><div class="eyebrow"><span class="tiny-line"></span>수리논술, 생각의 과정을 읽다</div><h1>풀이의 다음 줄을<br/><em>함께 찾다.</em></h1><p class="hero-description">맞고 틀림 사이에는, 더 나은 풀이가 있어요.<br/>문제의 이해부터 논리의 완성까지<br class="desktop-break"/> 내 풀이를 돌아보는 새로운 첨삭 경험.</p><div class="hero-buttons">${button('내 풀이 첨삭 체험하기', '#/submit')}${button('예시 리포트 보기', '#/report/sample-cubic', 'button secondary')}</div><p class="hero-footnote">${icon('check')}가입 없이 체험할 수 있어요 <span>·</span> 실제 AI 채점 전 예시 화면</p><div class="hero-index"><span>01 — UNDERSTAND</span><span>02 — REASON</span><span>03 — REFINE</span></div></div><div class="hero-visual"><span class="visual-index">A CLOSER LOOK AT YOUR THINKING</span><div class="math-paper"><div class="paper-top"><span class="paper-label">풀이 노트 <span>01</span></span><span class="badge light">미분 · 자체 제작 예제</span></div><h2>답보다 중요한 건,<br/>답에 도달한 과정.</h2>${graph()}<div class="paper-answer"><span class="answer-number">01</span><div><span class="math">f′(x) = 3x² − 3 = 3(x − 1)(x + 1)</span><p>도함수의 부호로 증가·감소 구간을 나눈다.</p></div>${icon('check')}</div><div class="paper-answer marked"><span class="answer-number">02</span><div><span class="math">∴ 극값을 기준으로 실근의 개수를 판단한다.</span><p>경계값에서의 경우를 더 살펴볼까요?</p></div><span class="annotation-dot"></span></div></div><div class="feedback-float"><span class="feedback-symbol">${icon('pen')}</span><div><span class="micro-label">첨삭 리포트 미리보기</span><strong>논리의 연결을 한 번 더.</strong><p>결론 앞에, 빠진 근거를 채워보세요.</p></div><a href="#/report/sample-cubic" class="icon-button" aria-label="예시 리포트 열기">${icon('arrow')}</a></div><div class="score-float"><span class="score-orbit">78<small>/ 100</small></span><div><span class="micro-label">자체 제작 예시 답안</span><strong>과정에서 찾은 가능성</strong><span class="score-caption">채점 기준별 피드백 예시</span></div></div><span class="visual-footnote">ILLUSTRATIVE EXAMPLE · 실제 제출 답안의 채점 결과가 아닙니다.</span></div></section><section class="principles-strip"><div class="page-width principles-inner"><span>결과보다 과정에,<br/><strong>점수보다 근거에.</strong></span><p>${icon('book')}문항에 맞는 채점 기준</p><p>${icon('pen')}풀이 단계별 피드백</p><p>${icon('history')}쌓이는 나의 학습 기록</p></div></section><section id="how-it-works" class="how-section page-width"><div class="section-heading"><div><span class="eyebrow">HOW IT WORKS</span><h2>한 장의 풀이가<br/>다음 풀이의 힘이 되도록.</h2></div><p>복잡한 준비 없이, 내 풀이를 꺼내는 것부터.<br/>지금은 예시 리포트로 전체 흐름을 체험해보세요.</p></div><div class="steps-grid"><article><span class="step-number">01</span>${icon('book')}<h3>풀었던 문제를 고르고</h3><p>문제와 채점 기준을 먼저 확인해요.<br/>자료실의 자체 제작 예제로 시작해보세요.</p></article><article><span class="step-number">02</span>${icon('upload')}<h3>내 풀이를 담으면</h3><p>텍스트를 적거나 답안 파일을 선택해요.<br/>체험 중 파일은 서버로 전송되지 않아요.</p></article><article><span class="step-number">03</span>${icon('spark')}<h3>리포트로 돌아봐요</h3><p>강점, 보완점, 다음 학습 방향까지.<br/>현재는 고정된 예시 리포트를 보여드려요.</p></article></div></section><section class="feature-section page-width"><div class="feature-sheet"><span class="eyebrow">FEEDBACK WITH REASONS</span><h2>“왜”를 설명하는<br/>첨삭을 만들고 있어요.</h2><p>점수만 남기는 평가를 넘어,<br/>어떤 근거를 더하고 어떤 연결을 다듬어야 할지<br/>스스로 이해할 수 있도록.</p>${button('첨삭 리포트 살펴보기', '#/report/sample-cubic', 'button secondary')}</div><div class="criteria-preview"><span class="micro-label">예시 리포트 · 평가 항목</span><div class="criterion-preview"><span><i>01</i>도함수와 증감 분석</span><strong>28 <small>/ 30</small></strong></div><div class="criterion-preview"><span><i>02</i>극값 계산</span><strong>25 <small>/ 25</small></strong></div><div class="criterion-preview"><span><i>03</i>실근의 개수 분류</span><strong>13 <small>/ 25</small></strong></div><div class="criterion-preview"><span><i>04</i>논리와 서술</span><strong>12 <small>/ 20</small></strong></div><div class="preview-note">${icon('info')}위 점수는 자체 제작 예시 답안에 대한 표시입니다.</div></div></section><section class="closing-section page-width"><div><span class="eyebrow">YOUR NEXT LINE</span><h2>다음 풀이가 달라지는 시작.</h2><p>지금, 한 장의 풀이로 체험해보세요.</p></div>${button('첫 첨삭 체험하기', '#/submit')}</section></main>${footer()}`;
}

const navItems = [ ['workspace', 'home', '학습실 홈'], ['submit', 'pen', '새 첨삭 체험'], ['history', 'history', '첨삭 기록'], ['library', 'book', '문제 자료실'], ['pricing', 'card', '이용권 안내'] ];
function shell(view, content) {
  if (view === 'report') view = 'history';
  return `${header()}<div class="workspace-layout"><aside class="sidebar"><div class="sidebar-label">MY STUDY ROOM</div><nav aria-label="학습실 메뉴">${navItems.map(([path, symbol, label]) => `<a href="#/${path}" ${view === path ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span>${path === 'submit' ? '<span class="nav-plus">+</span>' : ''}</a>`).join('')}</nav><div class="sidebar-note"><span class="note-symbol">∴</span><strong>생각의 과정을<br/>차근차근.</strong><p>좋은 풀이는<br/>좋은 질문에서 시작해요.</p><a href="#/report/sample-cubic">예시 리포트 ${icon('arrow')}</a></div><button class="sidebar-account" data-action="account"><span class="avatar">${state.account ? esc(state.account.name.slice(0, 1)) : '체'}</span><span><strong>${state.account ? esc(state.account.name) : '체험 학습자'}</strong><small>브라우저 로컬 체험</small></span>${icon('chevron')}</button></aside><main id="main" class="workspace-main" tabindex="-1"><div class="workspace-topline"><span>나의 학습실 <span>/</span> ${esc(navItems.find(([path]) => path === view)?.[2] || '첨삭 리포트')}</span><span class="local-indicator"><i></i>이 브라우저에 저장</span></div>${content}</main></div>`;
}

function notice(text, className = '') { return `<div class="notice ${className}">${icon('info')}<p>${text}</p></div>`; }
function pageHeading(eyebrow, title, description, action = '') {
  return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}
function reportRow(report, isSample = false) {
  const problem = problemById(report.problemId);
  const linkId = report.report ? report.id : report.id;
  return `<a class="report-row" href="#/report/${encodeURIComponent(linkId)}"><span class="report-file">${icon('file')}</span><div class="report-row-title"><strong>${esc(problem.title)}</strong><span>${esc(problem.topic)} <i>·</i> ${isSample ? '자체 제작 예시' : date(report.createdAt) + ' 체험'}</span></div><span class="badge ${isSample ? 'light' : 'green'}">${isSample ? '예시 리포트' : '체험 완료'}</span><span class="row-score">${report.report?.score ?? report.score}<small>/100</small></span>${icon('chevron')}</a>`;
}
function dashboard() {
  const completed = state.submissions.filter((item) => item.status === 'completed');
  return shell('workspace', `${pageHeading('MY STUDY ROOM', '생각을 쌓는 나의 학습실', '한 번의 풀이에서 발견한 것을, 다음 풀이로 이어가세요.')}${notice('지금은 <strong>API 연결 전 체험 버전</strong>이에요. 실제 AI 채점 대신 자체 제작한 예시 리포트를 제공해요.')}<section class="workspace-welcome"><div><span class="eyebrow">ONE SOLUTION AT A TIME</span><h2>${draftAnswer ? '이어서 써볼까요?' : '오늘의 풀이를 시작해볼까요?'}</h2><p>${draftAnswer ? '저장해둔 풀이가 기다리고 있어요. 생각의 흐름을 이어가세요.' : '완벽하지 않아도 괜찮아요. 적어둔 풀이부터 꺼내보세요.'}</p>${button(draftAnswer ? '작성 중인 풀이 이어쓰기' : '새 첨삭 체험하기', '#/submit')}</div><div class="welcome-math" aria-hidden="true"><span>f′(x)</span><svg viewBox="0 0 220 130"><path d="M10 100h200M50 10v110"/><path class="welcome-curve" d="M20 110Q70-50 120 65T210 15"/></svg><small>Every line has a reason.</small></div></section><div class="stats-grid"><article><span>체험한 첨삭</span><strong>${completed.length}<small>회</small></strong><p>이 브라우저에 저장된 기록</p></article><article><span>작성 중인 풀이</span><strong>${draft() ? 1 : 0}<small>개</small></strong><p>텍스트만 자동 저장돼요</p></article><article><span>살펴볼 예시 리포트</span><strong>${sampleReports.length}<small>개</small></strong><p>첨삭 구성과 피드백 예시</p></article></div><section class="panel reports-panel"><div class="panel-heading"><h2>${completed.length ? '최근 첨삭 기록' : '먼저 살펴보는 첨삭 리포트'}</h2><a class="text-link" href="#/history">전체 보기 ${icon('arrow')}</a></div>${completed.length ? completed.slice(0, 3).map((report) => reportRow(report)).join('') : sampleReports.map((report) => reportRow(report, true)).join('')}</section><section class="next-step-card"><span class="round-icon">${icon('book')}</span><div><h3>어떤 문제로 시작할지 고민된다면</h3><p>자체 제작 예제와 채점 기준을 자료실에서 먼저 확인하세요.</p></div><a href="#/library" class="button secondary small">문제 자료실 ${icon('arrow')}</a></section>`);
}

function problemOptions() { return problems.map((problem) => `<option value="${esc(problem.id)}" ${problem.id === draftProblem ? 'selected' : ''}>${esc(problem.title)}</option>`).join(''); }
function selectedFileMarkup() {
  const remembered = draft()?.fileName;
  if (!attachment && !remembered) return '';
  return `<div class="selected-file">${attachmentUrl ? `<img src="${attachmentUrl}" alt="선택한 답안 이미지 미리보기" />` : `<span class="file-thumbnail">${icon('file')}</span>`}<div><strong>${esc(attachment?.name || remembered)}</strong><small>${attachment ? `${(attachment.size / 1024 / 1024).toFixed(2)} MB · 이 화면에서만 유지` : '파일은 보관되지 않았어요. 다시 선택해주세요.'}</small></div><button type="button" class="icon-button" data-action="remove-file" aria-label="선택한 파일 제거">${icon('close')}</button></div>`;
}
function submitView() {
  const problem = problemById(draftProblem);
  return shell('submit', `${pageHeading('NEW FEEDBACK', '한 장의 풀이, 새로운 발견', '문제를 고르고 내 풀이를 담아보세요. 텍스트는 자동으로 저장돼요.')}<ol class="submission-steps" aria-label="첨삭 체험 순서"><li class="active"><span>1</span>문제 선택</li><li><span>2</span>풀이 작성</li><li><span>3</span>예시 리포트 확인</li></ol><div class="submission-layout"><form id="submission-form" class="submission-form" novalidate><section class="panel form-panel"><div class="form-section-title"><span>01</span><h2>어떤 문제를 풀었나요?</h2></div><label class="field-label" for="problem-select">문제 선택</label><select id="problem-select" name="problemId">${problemOptions()}</select><div class="problem-statement"><span class="badge light">${esc(problem.topic)} · 자체 제작 예제</span><h3>${esc(problem.title)}</h3><p>${esc(problem.prompt)}</p></div></section><section class="panel form-panel"><div class="form-section-title"><span>02</span><h2>내 풀이를 담아주세요</h2></div><div class="input-heading"><label class="field-label" for="answer">풀이 작성</label><button type="button" class="text-link" data-action="fill-sample">예시 풀이 넣기 ${icon('plus')}</button></div><textarea id="answer" name="answer" rows="10" maxlength="20000" placeholder="문제를 어떻게 이해했는지, 어떤 순서로 풀었는지 적어주세요.\n완성하지 못한 풀이도 괜찮아요.\n\n수식은 f'(x), x^2, ∫ 같은 표현으로 입력할 수 있어요." aria-describedby="answer-help answer-count">${esc(draftAnswer)}</textarea><div class="input-meta"><span id="answer-help">텍스트 30자 이상 또는 답안 파일 선택</span><span id="answer-count">${draftAnswer.length.toLocaleString('ko-KR')} / 20,000자</span></div><div class="upload-divider"><span>또는 답안 파일 선택</span></div><label class="dropzone" id="dropzone" for="answer-file">${icon('upload')}<strong>답안 사진이나 PDF를 선택하세요</strong><span>클릭하거나 파일을 여기에 끌어다 놓으세요</span><small>JPG · PNG · WEBP · PDF / 최대 10 MB</small><input id="answer-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></label><div id="selected-file">${selectedFileMarkup()}</div><p class="file-privacy">${icon('check')}선택한 파일은 서버로 전송하거나 저장하지 않아요.</p></section><div class="form-errors" id="form-errors" role="alert" tabindex="-1"></div>${notice('<strong>체험 안내</strong> — 제출한 답안은 실제로 채점하지 않아요. 선택한 문제의 고정된 예시 리포트가 열리며, 내 풀이 텍스트는 이 브라우저에만 저장돼요.')}<div class="form-actions"><button type="button" class="button secondary" data-action="save-draft">임시 저장 ${icon('check')}</button><button type="submit" class="button primary">예시 첨삭 리포트 열기 ${icon('arrow')}</button></div></form><aside class="submission-aside"><section class="panel rubric-panel"><span class="eyebrow">GRADING GUIDE</span><h2>이 문제의 채점 기준</h2><p>무엇을 설명해야 하는지<br/>먼저 살펴보세요.</p>${problem.rubric.map((criterion, index) => `<div class="rubric-item"><span>${String(index + 1).padStart(2, '0')}</span><div><strong>${esc(criterion.label)}<small>${criterion.max}점</small></strong><p>${esc(criterion.description)}</p></div></div>`).join('')}<div class="rubric-total"><span>총 배점</span><strong>100점</strong></div></section><div class="writing-tip"><span>∴</span><h3>좋은 풀이를 위한 작은 힌트</h3><p>식을 쓰는 이유와 결론에 이르는 근거를 한 문장씩 연결해보세요.</p></div></aside></div>`);
}

function libraryCard(problem, index) {
  return `<article class="problem-card"><div class="problem-card-top"><span class="problem-index">P.${String(index + 1).padStart(2, '0')}</span><span class="badge light">${esc(problem.topic)}</span></div><h2>${esc(problem.title)}</h2><p>${esc(problem.prompt)}</p><div class="problem-card-bottom"><span>자체 제작 예제 <i>·</i> ${esc(problem.difficulty)}</span><a href="#/submit?problem=${encodeURIComponent(problem.id)}" class="text-link">이 문제로 체험 ${icon('arrow')}</a></div></article>`;
}
function library() {
  const topics = ['전체', ...new Set(problems.map((problem) => problem.topic))];
  return shell('library', `${pageHeading('PROBLEM LIBRARY', '생각을 여는 문제 자료실', '문제와 채점 기준을 함께 읽고, 풀이를 시작해보세요.')}${notice('자료실의 문제는 모두 <strong>서비스 체험을 위한 자체 제작 예제</strong>예요. 대학 기출·공식 채점 기준은 아직 등록되지 않았어요.')}<div class="library-toolbar"><div class="filter-chips" aria-label="문제 주제">${topics.map((topic) => `<button class="filter-chip ${libraryTopic === topic ? 'active' : ''}" data-action="filter-topic" data-topic="${esc(topic)}" aria-pressed="${libraryTopic === topic}">${esc(topic)}</button>`).join('')}</div><label class="search-field">${icon('search')}<span class="sr-only">문제 검색</span><input id="problem-search" type="search" placeholder="문제 이름, 주제 검색" /></label></div><div class="library-results-label" id="library-count" role="status">총 ${problems.filter((problem) => libraryTopic === '전체' || problem.topic === libraryTopic).length}개의 예제</div><div id="problem-grid" class="problem-grid">${problems.filter((problem) => libraryTopic === '전체' || problem.topic === libraryTopic).map((problem) => libraryCard(problem, problems.indexOf(problem))).join('')}</div><div class="library-future"><span class="round-icon">${icon('book')}</span><div><h3>더 많은 문제를 준비하고 있어요</h3><p>대학·연도·문항별 자료와 채점 기준을 차례로 연결할 예정이에요.</p></div></div>`);
}

function historyView() {
  const completed = state.submissions.filter((item) => item.status === 'completed');
  const rows = [...(historyTab === 'sample' ? [] : completed.map((item) => reportRow(item))), ...(historyTab === 'mine' ? [] : sampleReports.map((item) => reportRow(item, true)))].join('');
  return shell('history', `${pageHeading('FEEDBACK ARCHIVE', '한 줄씩 쌓이는 첨삭 기록', '지난 리포트를 다시 읽으며, 다음 풀이의 실마리를 찾아보세요.', button('새 첨삭 체험', '#/submit', 'button primary small'))}<div class="history-toolbar"><div class="filter-chips" aria-label="첨삭 기록 종류">${[['all', '전체'], ['mine', `내 체험 기록 ${completed.length}`], ['sample', '예시 리포트']].map(([id, label]) => `<button class="filter-chip ${id === historyTab ? 'active' : ''}" data-action="history-tab" data-tab="${id}" aria-pressed="${id === historyTab}">${label}</button>`).join('')}</div><span>이 브라우저의 기록만 표시돼요</span></div><section class="panel">${rows || `<div class="empty-state">${icon('history')}<h2>첫 번째 풀이를 기다리고 있어요</h2><p>첨삭 체험을 마치면 이곳에 기록이 남아요.</p>${button('첨삭 체험 시작하기', '#/submit', 'button primary small')}</div>`}</section>${draft() ? `<a class="draft-card" href="#/submit"><span class="badge light">작성 중</span><div><strong>${esc(problemById(draft().problemId).title)}</strong><span>작성하던 풀이를 이어갈 수 있어요.</span></div>${icon('arrow')}</a>` : ''}<p class="storage-note">브라우저 데이터를 지우면 체험 기록도 삭제돼요. 실제 계정 동기화는 추후 제공 예정입니다.</p>`);
}

function getReport(id) {
  const sample = sampleReports.find((item) => item.id === id);
  if (sample) return { report: sample, submission: null };
  const submission = getSubmission(state, id);
  return submission?.report ? { report: submission.report, submission } : null;
}
function reportView(id) {
  const found = getReport(id);
  if (!found) return shell('history', `<div class="empty-state">${icon('file')}<h1>리포트를 찾을 수 없어요</h1><p>이 브라우저의 기록이 삭제됐거나, 다른 브라우저에서 만든 링크일 수 있어요.</p>${button('첨삭 기록으로', '#/history', 'button primary small')}</div>`);
  const { report, submission } = found;
  const problem = problemById(report.problemId);
  return shell('report', `<a href="#/history" class="back-link">← 첨삭 기록으로</a>${pageHeading('FEEDBACK REPORT', esc(problem.title), `${esc(problem.topic)} · 자체 제작 예제 · ${submission ? date(submission.createdAt) + ' 체험' : '예시 리포트'}`, `<button class="button secondary small" data-action="download-report" data-report-id="${esc(id)}">리포트 저장 ${icon('download')}</button>`)}${notice('<strong>고정된 예시 리포트</strong>입니다. 아래 점수와 피드백은 자체 제작한 예시 답안에 관한 내용이며, 제출하신 답안의 실제 AI 채점 결과가 아닙니다.', 'report-notice')}<div class="report-overview"><section class="report-score-card"><span class="eyebrow">EXAMPLE SCORE</span><div class="large-score">${report.score}<small>/ ${report.maxScore || 100}</small></div><span class="badge green">예시 답안 평가</span><p>${esc(report.summary)}</p></section><section class="panel score-breakdown"><div class="panel-heading"><h2>채점 기준별로 살펴보기</h2><span class="micro-label">총 100점</span></div>${report.criteria.map((criterion) => `<div class="score-criterion"><div><strong>${esc(criterion.label)}</strong><span>${criterion.score}<small> / ${criterion.max}점</small></span></div><progress value="${criterion.score}" max="${criterion.max}" aria-label="${esc(criterion.label)} ${criterion.max}점 중 ${criterion.score}점"></progress><p>${esc(criterion.comment)}</p></div>`).join('')}</section></div><div class="feedback-columns"><section class="panel feedback-panel positive"><div class="feedback-panel-title"><span class="round-icon">${icon('check')}</span><h2>잘 이어간 생각</h2></div><ul>${report.strengths.map((text) => `<li>${esc(text)}</li>`).join('')}</ul></section><section class="panel feedback-panel improve"><div class="feedback-panel-title"><span class="round-icon">${icon('pen')}</span><h2>한 번 더 다듬을 부분</h2></div><ul>${report.improvements.map((text) => `<li>${esc(text)}</li>`).join('')}</ul></section></div><section class="panel answer-review"><div class="panel-heading"><h2>예시 답안에서 배워보기</h2><span class="badge light">학습용 예시</span></div><div class="answer-comparison"><div><span class="micro-label">예시 풀이</span><p>${esc(report.sampleAnswer)}</p></div><div class="improved-answer"><span class="micro-label">근거를 보완한 풀이</span><p>${esc(report.improvedAnswer || problem.sampleAnswer)}</p></div></div></section><section class="panel next-steps"><span class="eyebrow">YOUR NEXT STEP</span><h2>다음 풀이에서는 이렇게 해보세요</h2><ol>${report.nextSteps.map((text, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span>${esc(text)}</li>`).join('')}</ol></section>${submission ? `<section class="panel submitted-answer"><h2>내가 남긴 풀이</h2><p class="subtle">아래 텍스트와 위 예시 채점은 연결되어 있지 않아요.</p>${submission.answer ? `<pre>${esc(submission.answer)}</pre>` : '<p class="subtle">작성한 텍스트가 없어요.</p>'}${submission.fileName ? `<p class="file-caption">${icon('file')}${esc(submission.fileName)} — 파일 내용은 저장하지 않았어요.</p>` : ''}</section>` : ''}<div class="report-bottom"><p>발견한 것을 다음 풀이로 이어가볼까요?</p>${button('다른 문제로 체험하기', '#/library')}</div>`);
}

function pricing() {
  const plans = [
    { label: '체험', description: '풀이결을 먼저 만나보세요.', price: '무료', features: ['자체 제작 문제 3개', '예시 첨삭 리포트 살펴보기', '브라우저에 풀이 텍스트 저장', '실제 AI 채점 미제공'], active: true },
    { label: '꾸준한 풀이', description: '나만의 학습 루틴을 위해.', price: '준비 중', features: ['월 제공 횟수형 이용권 예정', 'AI 첨삭 및 기준별 피드백 예정', '계정별 첨삭 기록 저장 예정', '가격·제공량은 출시 전 안내'] },
    { label: '집중하는 풀이', description: '더 깊이, 더 자주 돌아보도록.', price: '준비 중', features: ['추가 첨삭 이용권 예정', '답안 사진·PDF 분석 예정', '확장된 문제 자료실 예정', '가격·제공량은 출시 전 안내'] },
  ];
  return shell('pricing', `${pageHeading('MEMBERSHIP', '내 속도에 맞는 학습을 위해', '지금은 무료 체험만 제공해요. 유료 이용권은 준비 중입니다.')}<div class="pricing-grid">${plans.map((plan) => `<article class="plan-card ${plan.active ? 'featured' : ''}">${plan.active ? '<span class="plan-tag">지금 체험 가능</span>' : '<span class="plan-tag muted">출시 예정</span>'}<h2>${plan.label}</h2><p>${plan.description}</p><div class="plan-price">${plan.price}</div><ul>${plan.features.map((feature) => `<li>${icon('check')}${feature}</li>`).join('')}</ul>${plan.active ? button('무료로 체험하기', '#/submit', 'button primary full') : '<button class="button secondary full" disabled>결제 준비 중</button>'}</article>`).join('')}</div>${notice('실제 결제·정기 구독·자동 청구는 연결되어 있지 않아요. 카드 정보나 결제 정보를 입력받지 않습니다.')}<section class="faq-section"><h2>궁금한 점이 있나요?</h2><details open><summary>지금 체험하면 비용이 발생하나요?</summary><p>아니요. 현재는 무료 화면 체험만 제공하며, AI API 호출과 실제 결제는 발생하지 않아요.</p></details><details><summary>내가 쓴 풀이를 실제로 채점하나요?</summary><p>아직은 아니에요. 선택한 문제에 맞는 고정 예시 리포트가 열려요. 실제 AI 첨삭은 API와 채점 자료를 연결한 후 제공할 예정입니다.</p></details><details><summary>내 답안 파일은 어디에 보관되나요?</summary><p>파일은 이 화면에서만 선택·미리보기하고 서버로 보내지 않아요. 새로고침하면 다시 선택해야 해요. 풀이 텍스트와 체험 기록은 이 브라우저에만 저장돼요.</p></details><details><summary>어떤 기출 문제를 지원하나요?</summary><p>현재 자료실에는 자체 제작한 체험 예제만 있어요. 대학 기출과 공식 채점 기준은 아직 등록되지 않았어요.</p></details></section>`);
}

function route() {
  const raw = location.hash.slice(1) || '/';
  const [path, query] = raw.split('?');
  const params = new URLSearchParams(query || '');
  const requestedProblem = params.get('problem');
  if (path === '/submit' && requestedProblem && problems.some((problem) => problem.id === requestedProblem)) {
    draftProblem = requestedProblem;
  }
  return { path, params };
}

function render(moveFocus = false) {
  const { path } = route();
  const views = { '/': landing, '/workspace': dashboard, '/submit': submitView, '/library': library, '/history': historyView, '/pricing': pricing };
  let reportId;
  try { reportId = path.startsWith('/report/') ? decodeURIComponent(path.slice(8)) : null; } catch { reportId = ''; }
  app.innerHTML = reportId !== null && reportId !== undefined ? reportView(reportId) : views[path] ? views[path]() : `${header()}<main id="main" class="not-found page-width" tabindex="-1"><span class="eyebrow">404</span><h1>잠시 다른 길로 들어왔네요.</h1><p>홈에서 다시 풀이를 이어가세요.</p>${button('홈으로 돌아가기', '#/')}</main>${footer()}`;
  const title = path === '/' ? '풀이의 다음 줄을 함께' : path.startsWith('/report/') ? '예시 첨삭 리포트' : navItems.find(([id]) => path === '/' + id)?.[2] || '페이지를 찾을 수 없어요';
  document.title = `${title} | 풀이결`;
  if (moveFocus) { window.scrollTo(0, 0); document.querySelector('#main')?.focus({ preventScroll: true }); }
  wireDropzone();
}

function saveDraft() {
  const current = draft();
  if (!draftAnswer.trim() && !attachment && !current?.fileName) {
    if (current) { state.submissions = state.submissions.filter((item) => item.id !== current.id); persist(); }
    return;
  }
  const input = { problemId: draftProblem, answer: draftAnswer, fileName: attachment?.name || current?.fileName || '', status: 'draft' };
  if (current) state = updateSubmission(state, current.id, input);
  else state.submissions.unshift(createSubmission(input));
  persist();
}

function clearAttachment() {
  if (attachmentUrl) URL.revokeObjectURL(attachmentUrl);
  attachmentUrl = null;
  attachment = null;
  if (draft()) state = updateSubmission(state, draft().id, { fileName: '' });
}

function handleFile(file) {
  if (!file) return;
  const result = validateFile(file);
  if (!result.valid) {
    showErrors(result.errors);
    const input = document.querySelector('#answer-file');
    if (input) input.value = '';
    return;
  }
  clearAttachment();
  attachment = file;
  if (file.type.startsWith('image/')) attachmentUrl = URL.createObjectURL(file);
  saveDraft();
  document.querySelector('#selected-file').innerHTML = selectedFileMarkup();
  document.querySelector('#form-errors').innerHTML = '';
}

function wireDropzone() {
  const zone = document.querySelector('#dropzone');
  if (!zone) return;
  zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault(); zone.classList.remove('dragover');
    if (event.dataTransfer.files.length > 1) return showErrors(['답안 파일은 한 번에 하나만 선택해주세요.']);
    handleFile(event.dataTransfer.files[0]);
  });
}

function showErrors(errors) {
  const box = document.querySelector('#form-errors');
  if (!box) return toast(errors.join(' '));
  box.innerHTML = `<ul>${errors.map((error) => `<li>${esc(error)}</li>`).join('')}</ul>`;
  box.focus();
}

function openAccount() {
  dialog.innerHTML = `<button class="dialog-close icon-button" data-action="close-dialog" aria-label="닫기">${icon('close')}</button><span class="dialog-mark">∑</span><span class="eyebrow">YOUR STUDY ROOM</span><h2 id="account-dialog-title">${state.account ? '나의 체험 계정' : '풀이를 이어갈 작은 공간'}</h2><p class="dialog-description">실제 회원가입 전, 닉네임만으로<br/>이 브라우저에서 학습실을 체험해보세요.</p><form id="account-form"><label class="field-label" for="display-name">체험 닉네임</label><input id="display-name" name="name" maxlength="20" required placeholder="예: 차근차근" value="${esc(state.account?.name || '')}" aria-describedby="nickname-help" /><p class="field-hint" id="nickname-help">실명·이메일·비밀번호는 입력하지 마세요.</p><button class="button primary full" type="submit">${state.account ? '닉네임 저장' : '체험 계정으로 시작'} ${icon('arrow')}</button></form><p class="dialog-disclaimer">이 기능은 실제 로그인이나 본인 인증이 아니에요.<br/>데이터는 기기 간 동기화되지 않아요.</p>${state.account ? `<button class="text-button dialog-logout" data-action="logout">체험 계정 나가기 ${icon('logout')}</button>` : ''}<details class="reset-details"><summary>이 브라우저의 체험 데이터 관리</summary><p>닉네임, 풀이 텍스트와 첨삭 체험 기록을 모두 삭제합니다.</p><button class="danger-button" data-action="reset-data">체험 데이터 모두 삭제</button></details>`;
  dialog.showModal();
}

function downloadReport(id) {
  const found = getReport(id);
  if (!found) return;
  const { report, submission } = found;
  const lines = ['풀이결 · 고정 예시 첨삭 리포트', problemById(report.problemId).title, '', '주의: 제출한 답안을 실제로 채점한 결과가 아닙니다.', `예시 점수: ${report.score}/${report.maxScore}`, '', report.summary, '', ...report.criteria.map((item) => `${item.label}: ${item.score}/${item.max}\n${item.comment}`), '', '잘 이어간 생각', ...report.strengths, '', '보완할 부분', ...report.improvements, '', '다음 학습', ...report.nextSteps, ...(submission?.answer ? ['', '내가 남긴 풀이 (위 채점과 별개)', submission.answer] : [])];
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = '풀이결-예시-리포트.txt'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('예시 리포트를 텍스트 파일로 저장했어요.');
}

document.addEventListener('click', (event) => {
  if (event.target.closest('.skip-link')) {
    event.preventDefault();
    document.querySelector('#main')?.focus();
    document.querySelector('#main')?.scrollIntoView();
    return;
  }
  const trigger = event.target.closest('[data-action]');
  if (!trigger) {
    if (menuOpen && event.target.closest('a[href^="#/"]')) { menuOpen = false; }
    return;
  }
  const action = trigger.dataset.action;
  if (action === 'account') openAccount();
  if (action === 'close-dialog') dialog.close();
  if (action === 'menu') { menuOpen = !menuOpen; render(); }
  if (action === 'how') {
    event.preventDefault(); menuOpen = false;
    if (route().path !== '/') { location.hash = '/'; setTimeout(() => document.querySelector('#how-it-works')?.scrollIntoView({ behavior: 'smooth' }), 50); }
    else document.querySelector('#how-it-works')?.scrollIntoView({ behavior: 'smooth' });
  }
  if (action === 'fill-sample') {
    draftAnswer = problemById(draftProblem).sampleAnswer;
    saveDraft(); render(); toast('자체 제작 예시 풀이를 넣었어요. 자유롭게 수정해보세요.');
  }
  if (action === 'remove-file') { clearAttachment(); saveDraft(); persist(); render(); }
  if (action === 'save-draft') {
    if (!draftAnswer.trim() && !attachment) return toast('풀이를 적거나 파일을 선택한 뒤 저장해주세요.');
    saveDraft(); toast('풀이 텍스트를 이 브라우저에 저장했어요. 파일은 보관하지 않아요.');
  }
  if (action === 'filter-topic') { libraryTopic = trigger.dataset.topic; render(); }
  if (action === 'history-tab') { historyTab = trigger.dataset.tab; render(); }
  if (action === 'download-report') downloadReport(trigger.dataset.reportId);
  if (action === 'logout') { state.account = null; persist(); dialog.close(); render(); toast('체험 계정에서 나왔어요. 학습 기록은 이 브라우저에 남아 있어요.'); }
  if (action === 'reset-data') {
    dialog.innerHTML = `<span class="eyebrow">RESET DEMO DATA</span><h2 id="account-dialog-title">체험 기록을 모두 지울까요?</h2><p class="dialog-description">닉네임과 풀이 텍스트, 체험 기록이 삭제돼요.<br/>삭제한 기록은 되돌릴 수 없어요.</p><div class="reset-actions"><button class="button secondary" data-action="close-dialog">취소</button><button class="button danger" data-action="confirm-reset">모두 삭제</button></div>`;
    dialog.querySelector('button').focus();
  }
  if (action === 'confirm-reset') {
    state = resetState(); draftProblem = problems[0].id; draftAnswer = ''; clearAttachment(); dialog.close(); render(); toast('이 브라우저의 체험 데이터를 삭제했어요.');
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'display-name') event.target.setCustomValidity('');
  if (event.target.id === 'answer') {
    draftAnswer = event.target.value; saveDraft();
    document.querySelector('#answer-count').textContent = `${draftAnswer.length.toLocaleString('ko-KR')} / 20,000자`;
  }
  if (event.target.id === 'problem-search') {
    const query = event.target.value.trim().toLowerCase();
    const visible = problems.filter((problem) => (libraryTopic === '전체' || libraryTopic === problem.topic) && `${problem.title} ${problem.topic} ${problem.prompt}`.toLowerCase().includes(query));
    document.querySelector('#library-count').textContent = `총 ${visible.length}개의 예제`;
    document.querySelector('#problem-grid').innerHTML = visible.map((problem) => libraryCard(problem, problems.indexOf(problem))).join('') || `<div class="empty-state search-empty">${icon('search')}<h2>검색 결과가 없어요</h2><p>다른 문제 이름이나 주제로 검색해보세요.</p></div>`;
  }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'problem-select') {
    draftProblem = event.target.value;
    window.history.replaceState(null, '', `#/submit?problem=${encodeURIComponent(draftProblem)}`);
    saveDraft(); render();
  }
  if (event.target.id === 'answer-file') handleFile(event.target.files[0]);
});

document.addEventListener('submit', (event) => {
  if (event.target.id === 'account-form') {
    event.preventDefault();
    const name = new FormData(event.target).get('name').trim();
    if (!name) { document.querySelector('#display-name').setCustomValidity('닉네임을 입력해주세요.'); document.querySelector('#display-name').reportValidity(); return; }
    state.account = { name: name.slice(0, 20) }; persist(); dialog.close(); render(); toast('체험 닉네임을 저장했어요.');
  }
  if (event.target.id === 'submission-form') {
    event.preventDefault();
    const result = validateSubmission({ problemId: draftProblem, answer: draftAnswer, file: attachment });
    if (!result.valid) return showErrors(result.errors);
    const report = createDemoReport({ problemId: draftProblem, answer: draftAnswer, fileName: attachment?.name || '' });
    const currentDraft = draft();
    const submission = createSubmission({ problemId: draftProblem, answer: draftAnswer, fileName: attachment?.name || '', status: 'completed', report });
    state.submissions = state.submissions.filter((item) => item.id !== currentDraft?.id);
    state.submissions.unshift(submission); persist();
    draftAnswer = ''; clearAttachment();
    location.hash = `/report/${encodeURIComponent(submission.id)}`;
  }
});

dialog.addEventListener('click', (event) => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } });
window.addEventListener('hashchange', () => { menuOpen = false; render(true); });
window.addEventListener('pagehide', () => { if (attachmentUrl) URL.revokeObjectURL(attachmentUrl); });
render();
