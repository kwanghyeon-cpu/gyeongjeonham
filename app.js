/*
 * 경전함 웹 버전.
 * 안드로이드 앱의 assets/sutras/*.json 을 그대로 읽는다 (scripts/build-web.sh 가 복사).
 * 서버·광고·분석 없이 모든 기록은 브라우저 localStorage 에만 저장한다.
 */
'use strict';

// ───────────────────────── 언어 (영어판) ─────────────────────────
// 화면 글자는 코드에 한국어 원문을 쓰고 tr()로 감싼다 (scripts/i18n-web.mjs).
// 영어면 i18n-en.js 의 번역으로 바꾼다. {0} {1}… 자리에 값을 차례로 넣는다.
/** 고른 언어 ('ko' | 'en'), 없으면 브라우저 언어 */
const LANG_CHOSEN = (() => { try { return JSON.parse(localStorage.getItem('gj.language')); } catch { return null; } })();
const LANG = (LANG_CHOSEN || navigator.language || 'ko').toLowerCase().startsWith('ko') ? 'ko' : 'en';
const EN = LANG === 'en';
document.documentElement.lang = LANG;
if (EN) { // index.html의 고정 글자 (app.js는 defer라 이때 문서가 다 읽혀 있다)
  document.title = 'Sutra Box - read and chant Buddhist sutras';
  document.getElementById('side')?.setAttribute('aria-label', 'Sutra Box menu');
  const l = document.querySelector('.loading'); if (l) l.textContent = 'Loading sutras…';
}
function tr(ko, ...args) {
  let t = EN ? (self.I18N_EN?.[ko] ?? ko) : ko;
  args.forEach((a, i) => { t = t.split(`{${i}}`).join(String(a)); });
  return t;
}
/** 언어를 바꾸고 처음부터 다시 연다 (null이면 브라우저 언어) */
function setLanguage(lang) {
  try { if (lang) localStorage.setItem('gj.language', JSON.stringify(lang)); else localStorage.removeItem('gj.language'); } catch { /* 무시 */ }
  location.reload();
}
const weekdayName = (d) => (EN ? d.toLocaleDateString('en', { weekday: 'long' }) : '일월화수목금토'[d.getDay()]); // i18n: skip
const WEEK_SHORT = EN ? ['S', 'M', 'T', 'W', 'T', 'F', 'S'] : ['일', '월', '화', '수', '목', '금', '토']; // i18n: skip
const notBackup = () => tr('경전함 백업 파일이 아니에요');

// ───────────────────────── 데이터 ─────────────────────────

const VIEW_MODES = [
  { id: 'Read', label: tr('읽기') },
  { id: 'Recite', label: tr('독송') },
  { id: 'Study', label: tr('공부') },
  { id: 'Memorize', label: tr('외우기') },
];
const MASK_LEVELS = [tr('보기'), tr('첫 글자만'), tr('모두 가리기')];
const SLEEP_STEPS = [[0, tr('이 경전이 끝나면')], [15, tr('15분')], [30, tr('30분')], [45, tr('45분')], [60, tr('1시간')]];
const REPEAT_SECTION_STEPS = [3, 7, 21, 0];
const BOW_PAUSES = [3, 5, 8];
const DEDICATION = '#dedication';
const DEDICATION_PRESETS = [tr('부모님의 건강을 위해'), tr('돌아가신 분의 극락왕생을 위해'), tr('가족의 평안을 위해'), tr('모든 중생이 행복하기를')];
// 미리 넣어 둔 독송 묶음 (앱과 같다)
const PRESET_PLAYLISTS = [
  { id: 'morning', name: tr('아침 예불'), sutras: ['yebul-mun', 'heart-sutra', 'cheonsu-gyeong'] },
  { id: 'evening', name: tr('저녁 독송'), sutras: ['heart-sutra', 'beopseong-ge', 'isan-balwon'] },
  { id: 'memorial', name: tr('49재 독송'), sutras: ['musang-gye', 'heart-sutra', 'amitabha-sutra', 'jijang-gyeong'] },
  { id: 'parents', name: tr('부모님을 위해'), sutras: ['bumo-eunjung', 'uranbun-gyeong', 'jijang-gyeong'] },
  { id: 'healing', name: tr('건강을 비는 독송'), sutras: ['heart-sutra', 'yaksa-gyeong', 'gwaneum-gyeong'] },
  { id: 'seon', name: tr('선의 노래'), sutras: ['sinsim-myeong', 'jeungdo-ga', 'beopseong-ge'] },
];

/** 외우기: 낱말의 첫 글자만 남기거나(1) 모두(2) ○로 가린다 */
const maskText = (text, level) => (level <= 0 ? text
  : text.replace(/\S+/g, (w) => [...w].map((c, i) => (/\p{L}/u.test(c) && (level >= 2 || i > 0) ? '○' : c)).join('')));

/** 49재: 돌아가신 날을 첫날로 쳐서 이레마다, 일곱째가 49재 */
const jaeDate = (m, n) => { const d = new Date(m.date + 'T00:00:00'); d.setDate(d.getDate() + 7 * n - 1); return ymd(d); };
/** 받침에 따라 을/를을 붙인다 (예: 건강을, 평안을, 행복을) */
const eulReul = (w) => { const c = w.charCodeAt(w.length - 1); return c >= 0xAC00 && c <= 0xD7A3 ? w + ((c - 0xAC00) % 28 ? '을' : '를') : w + '을(를)'; }; // i18n: skip (한국어 조사)
/** 'YYYY-MM-DD'에 n일을 더한다 */
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return ymd(x); };
const jaeName = (n) => (n === 1 ? tr('초재') : n === 7 ? tr('49재(막재)') : `${tr('{0}재', n)}`);
/** 달력 칸에 넣는 짧은 이름 */
const jaeShort = (n) => (n === 7 ? tr('막재') : jaeName(n));
const HOLY_SHORT = { 출가재일: tr('출가재'), 열반재일: tr('열반재'), 부처님오신날: tr('오신날'), '백중 (우란분절)': tr('백중'), 성도재일: tr('성도재'), 약사재일: tr('약사재'), 지장재일: tr('지장재'), 관음재일: tr('관음재') };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
const FONT_STEPS = [[0.9, tr('작게')], [1, tr('보통')], [1.15, tr('크게')], [1.3, tr('더 크게')], [1.5, tr('아주 크게')]];
// 듣기 배속 (음원 원래 속도 = 1). 독송은 천천히 듣는 게 좋아 기본은 '조금 느리게'(0.85배)
const RATE_STEPS = [[0.6, tr('아주 느리게')], [0.7, tr('느리게')], [0.85, tr('조금 느리게')], [1, tr('원래 속도')]];
const REPEAT_STEPS = [1, 3, 7, 21];
const BEAD_TARGETS = [108, 1080, 3000];
const BEADS = '#beads';
const SIT = '#sit';
const SIT_STEPS = [5, 10, 20, 30, 60];
const SIT_INTERVALS = [[0, tr('없음')], [5, tr('5분마다')], [10, tr('10분마다')]];
const DAILY_MAX = 100;

let sutras = [];

const isMantra = (sec) => sec.repeat > 1 || sec.sanskrit != null;
const isHan = (c) => (c >= '㐀' && c <= '鿿') || (c >= '豈' && c <= '﫿');
const headingKo = (sec) => {
  if (!sec.heading) return null;
  const s = [...sec.heading].filter((c) => !isHan(c)).join('').replace(/\s+/g, ' ').trim();
  return s || null;
};

function parseSutra(j) {
  return {
    id: j.id,
    order: j.order ?? 99,
    group: j.group || "sutra",
    title: j.title,
    source: j.source || {},
    glossary: j.glossary || {},
    reviewChecklist: (j.reviewChecklist || []).map((r) => ({ sectionId: r.section, issue: r.issue, priority: r.priority ?? 9 })),
    videos: j.videos || [],
    sections: j.sections.map((s) => ({
      id: s.id,
      heading: s.heading ?? null,
      repeat: Math.max(1, s.repeat ?? 1),
      hanja: s.hanja,
      eumdok: s.eumdok,
      plain: s.plain,
      plainKo: s.plain, // 사경용 한국어 풀이 (영어판에서 plain이 영어로 바뀌어도 그대로)
      recitation: s.recitation || [],
      commentary: s.commentary || '',
      terms: s.terms || [],
      sanskrit: s.sanskrit ?? null,
      meaning: s.meaning ?? null,
      dailyVerse: s.dailyVerse !== false,
      bow: s.bow ?? null,
    })),
  };
}
const canBowSutra = (s) => s.sections.some((x) => x.bow);
const bowCount = (s) => s.sections.reduce((n, x) => n + (x.bow === 'lines' ? x.recitation.length : x.bow === 'one' ? 1 : 0), 0);

/**
 * 영어 풀이(sutras-en/같은 이름.json)를 겹친다. 안드로이드 SutraParser.parse(ko, en)와 같은 규칙:
 * 제목·출처 안내·소제목(뒤에 원래 한자)·풀이·해설·진언 뜻·용어만 바꾸고, 한문·음독·독송본은 그대로.
 */
function applyEnglish(s, e) {
  const text = (o, k) => (o && typeof o[k] === 'string' && o[k].trim() ? o[k] : null);
  if (text(e, 'title')) s.title = { ...s.title, ko: e.title, short: text(e, 'short') };
  if (e.source) s.source = { ...s.source, ...Object.fromEntries(['text', 'license', 'translationLicense'].filter((k) => text(e.source, k)).map((k) => [k, e.source[k]])) };
  for (const sec of s.sections) {
    const x = e.sections?.[sec.id];
    if (!x) continue;
    const hanja = sec.heading ? [...sec.heading].filter((c) => isHan(c) || c === ' ').join('').trim().replace(/\s+/g, ' ') : '';
    if (text(x, 'heading')) sec.heading = [x.heading, hanja].filter(Boolean).join(' ');
    for (const k of ['plain', 'commentary', 'meaning']) if (text(x, k)) sec[k] = x[k];
  }
  for (const [id, t] of Object.entries(s.glossary)) {
    const x = e.glossary?.[id];
    if (x) s.glossary[id] = { ...t, term: text(x, 'term') || t.term, definition: text(x, 'definition') || t.definition };
  }
  return s;
}

async function loadSutras() {
  const files = await (await fetch('sutras/index.json')).json();
  const list = await Promise.all(files.map(async (f) => {
    const s = parseSutra(await (await fetch('sutras/' + f)).json());
    if (!EN) return s;
    try { const r = await fetch('sutras-en/' + f); return r.ok ? applyEnglish(s, await r.json()) : s; } catch { return s; }
  }));
  return list.sort((a, b) => a.order - b.order);
}

// 안드로이드와 같은 규칙: 날짜마다 정해진 순서로 돌려 모든 기기에서 같은 '오늘의 말씀'
function dailyCandidates() {
  const out = [];
  for (const s of sutras) {
    s.sections.forEach((sec, i) => {
      if (sec.dailyVerse && !isMantra(sec) && sec.plain.length <= DAILY_MAX) out.push({ sutra: s, sec, number: i + 1 });
    });
  }
  return out;
}
const epochDay = (d) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
function dailyVerse(date = new Date()) {
  const all = dailyCandidates();
  if (!all.length) return null;
  const n = all.length;
  return all[((epochDay(date) % n) + n) % n];
}

// ───────────────────────── 검색 (SutraSearch.kt 와 같음) ─────────────────────────

const VARIANTS = {
  '即': '卽', '真': '眞', '顛': '顚', '咒': '呪', '説': '說', '礙': '碍',
  'ā': 'a', 'ī': 'i', 'ū': 'u', 'ṛ': 'r', 'ṃ': 'm', 'ṅ': 'n', 'ṇ': 'n',
  'ñ': 'n', 'ś': 's', 'ṣ': 's', 'ṭ': 't', 'ḍ': 'd', 'ḥ': 'h',
};
const IGNORED = new Set(['·', ',', '.', '(', ')', '-', '—']);
function normalize(text) {
  let out = '';
  for (const c of text || '') {
    if (/\s/.test(c) || IGNORED.has(c)) continue;
    const lower = c.toLowerCase();
    out += VARIANTS[lower] || lower;
  }
  return out;
}
function search(query) {
  const q = normalize(query);
  if (!q) return [];
  const terms = [];
  const secs = [];
  for (const s of sutras) {
    for (const t of Object.values(s.glossary)) {
      if ([t.term, t.hanja, t.sanskrit].some((x) => normalize(x).includes(q))) {
        terms.push({ sutra: s, field: tr('용어'), text: `${t.term} (${t.hanja}) — ${t.definition}` });
      }
    }
    s.sections.forEach((sec, i) => {
      const fields = [
        [tr('소제목'), sec.heading || ''], [tr('원문'), sec.hanja], [tr('음독'), sec.eumdok], [tr('풀이'), sec.plain],
        [tr('독송본'), sec.recitation.join(' ')], [tr('해설'), sec.commentary],
      ];
      const hit = fields.find(([, v]) => normalize(v).includes(q));
      if (hit) secs.push({ sutra: s, number: i + 1, sec, field: hit[0], text: hit[1] });
    });
  }
  return terms.concat(secs);
}

// ───────────────────────── 기기 안 저장 ─────────────────────────

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('gj.' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('gj.' + key, JSON.stringify(value)); } catch { /* 사생활 보호 모드 등 */ }
  },
};
const prefs = {
  get fontScale() { return store.get('fontScale', 1); },
  set fontScale(v) { store.set('fontScale', v); },
  get viewMode() { return store.get('viewMode', 'Read'); },
  set viewMode(v) { store.set('viewMode', v); },
  get rate() { return store.get('listenSpeed', 0.85); },
  set rate(v) { store.set('listenSpeed', v); },
  get repeat() { return store.get('repeat', 3); },
  set repeat(v) { store.set('repeat', v); },
  get loop() { return store.get('loop', false); },
  set loop(v) { store.set('loop', v); },
  // 독송 목소리: monk(스님, 기본) 또는 woman(여성, voices/jessi)
  get voice() { return store.get('voice', 'monk'); },
  set voice(v) { store.set('voice', v); },
  // 영어 화면에서 독송을 영어로 (voices/en 에 있는 구절만, 진언은 한국어)
  get chantEnglish() { return store.get('chantEnglish', true); },
  set chantEnglish(v) { store.set('chantEnglish', v); },
  get bookmarks() { return store.get('bookmarks', []); },
  isBookmarked(ref) { return this.bookmarks.includes(ref); },
  toggleBookmark(ref) {
    const b = this.bookmarks;
    store.set('bookmarks', b.includes(ref) ? b.filter((x) => x !== ref) : b.concat(ref));
  },
  position(id) { return store.get('positions', {})[id] || 0; },
  savePosition(id, index) {
    const p = store.get('positions', {});
    if (p[id] === index && store.get('lastSutra') === id) return;
    p[id] = index;
    store.set('positions', p);
    store.set('lastSutra', id);
  },
  get lastSutra() { return store.get('lastSutra', null); },
  get log() { return store.get('log', []); },
  markPractice(what, date = today()) {
    const entry = `${date}|${what}`;
    const log = this.log;
    if (!log.includes(entry)) store.set('log', log.concat(entry));
  },
  practicedDays() { return new Set(this.log.map((e) => e.split('|')[0])); },
  practiceOn(date) { return this.log.filter((e) => e.startsWith(date + '|')).map((e) => e.split('|')[1]); },
  streak() {
    const days = this.practicedDays();
    const d = new Date();
    if (!days.has(ymd(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days.has(ymd(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  },
  get bead() { return store.get('bead', { count: 0, target: 108 }); },
  set bead(v) { store.set('bead', v); },
  beadsOn(date) { return store.get('beads', {})[date] || 0; },
  addBead() {
    const b = this.bead;
    b.count++;
    this.bead = b;
    const all = store.get('beads', {});
    all[today()] = (all[today()] || 0) + 1;
    store.set('beads', all);
    this.markPractice(BEADS);
    return b;
  },
  get beadSound() { return store.get('beadSound', true); },
  set beadSound(v) { store.set('beadSound', v); },
  get sitMinutes() { return store.get('sitMinutes', 10); },
  set sitMinutes(v) { store.set('sitMinutes', v); },
  get sitInterval() { return store.get('sitInterval', 0); },
  set sitInterval(v) { store.set('sitInterval', v); },
  sitOn(date) { return store.get('sits', {})[date] || 0; },
  addSit(minutes) {
    const all = store.get('sits', {});
    all[today()] = (all[today()] || 0) + minutes;
    store.set('sits', all);
    this.markPractice(SIT);
  },
  // 독송 묶음 (내가 만든 것)
  get playlists() { return store.get('playlists', []); },
  addPlaylist(name, ids) { store.set('playlists', this.playlists.concat({ id: 'my-' + Date.now(), name, sutras: ids })); },
  removePlaylist(id) { store.set('playlists', this.playlists.filter((p) => p.id !== id)); },
  // 즐겨찾기 메모
  get notes() { return store.get('notes', {}); },
  noteOf(ref) { return this.notes[ref] || ''; },
  setNote(ref, text) {
    const n = this.notes;
    if (text.trim()) n[ref] = text; else delete n[ref];
    store.set('notes', n);
  },
  // 회향
  get dedications() { return store.get('dedications', []); },
  addDedication(text, date = today()) {
    if (!text.trim()) return;
    store.set('dedications', this.dedications.concat({ date, text: text.trim(), at: Date.now() }));
    this.markPractice(DEDICATION, date);
  },
  removeDedication(at) { store.set('dedications', this.dedications.filter((d) => d.at !== at)); },
  dedicationsOn(date) { return this.dedications.filter((d) => d.date === date); },
  // 49재 일정
  // 기도 정진 (21일·100일 기도): 정한 경전(없으면 무엇이든)을 한 날을 센다
  get prayers() { return store.get('prayers', []); },
  addPrayer(title, days, start, sutra, wish) {
    if (!title.trim()) return;
    store.set('prayers', this.prayers.concat({ id: 'p-' + Date.now(), title: title.trim(), days, start, ...(sutra ? { sutra } : {}), wish: wish.trim() }));
  },
  removePrayer(id) { store.set('prayers', this.prayers.filter((p) => p.id !== id)); },
  finishPrayer(id) { store.set('prayers', this.prayers.map((p) => (p.id === id ? { ...p, finishedOn: today() } : p))); },
  prayedOn(p, date) { const done = this.practiceOn(date); return p.sutra ? done.includes(p.sutra) : done.length > 0; },
  prayerProgress(p, t = today()) {
    const end = addDays(p.start, p.days - 1);
    const day = daysBetween(p.start, t) + 1;
    let done = 0, missed = 0;
    for (let d = p.start; d <= t && d <= end; d = addDays(d, 1)) {
      if (this.prayedOn(p, d)) done++; else if (d < t) missed++;
    }
    return { day, done, missed, end, todayDone: this.prayedOn(p, t) };
  },
  // 나의 발원문과 축원
  get myVow() { return store.get('myVow', ''); },
  set myVow(v) { store.set('myVow', v); },
  get blessings() { return store.get('blessings', []); },
  addBlessing(name, wish) { if (name.trim()) store.set('blessings', this.blessings.concat({ id: 'b-' + Date.now(), name: name.trim(), wish: wish.trim() })); },
  removeBlessing(id) { store.set('blessings', this.blessings.filter((b) => b.id !== id)); },
  // 사경 진도: 다 쓴 구절
  get traced() { return store.get('traced', []); },
  markTraced(sutraId, secId) { const k = sutraId + '/' + secId; if (!this.traced.includes(k)) store.set('traced', this.traced.concat(k)); },
  tracedCount(sutra) { const t = new Set(this.traced); return sutra.sections.filter((x) => t.has(sutra.id + '/' + x.id)).length; },
  bowsOn(date) { return store.get('bows', {})[date] || 0; },
  get memorials() { return store.get('memorials', []).slice().sort((a, b) => a.date.localeCompare(b.date)); },
  addMemorial(name, date) { if (name.trim()) store.set('memorials', store.get('memorials', []).concat({ id: 'm-' + Date.now(), name: name.trim(), date })); },
  removeMemorial(id) { store.set('memorials', store.get('memorials', []).filter((m) => m.id !== id)); },
  jaeOn(date) {
    return this.memorials.flatMap((m) => { const n = [1, 2, 3, 4, 5, 6, 7].find((k) => jaeDate(m, k) === date); return n ? [{ m, n }] : []; });
  },
  monthSummary(y, m) {
    const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;
    const entries = this.log.filter((e) => e.startsWith(prefix));
    const reads = entries.map((e) => e.split('|')[1]).filter((w) => !w.startsWith('#'));
    const count = {};
    reads.forEach((r) => { count[r] = (count[r] || 0) + 1; });
    const sum = (key) => Object.entries(store.get(key, {})).filter(([d]) => d.startsWith(prefix)).reduce((n, [, v]) => n + v, 0);
    return {
      days: new Set(entries.map((e) => e.split('|')[0])).size,
      sutraTimes: reads.length,
      top: Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 3),
      beads: sum('beads'), sits: sum('sits'),
      dedications: this.dedications.filter((d) => d.date.startsWith(prefix)).length,
    };
  },
};

// ───────────────────────── 수행 소리 (목탁·작은 종·큰 종, 공유마당 김용배 작 CC BY) ─────────────────────────

const sounds = {
  ctx: null,
  buffers: {},
  // 브라우저는 사용자가 누른 뒤에야 소리를 낼 수 있어서, 처음 누를 때 준비한다.
  async load(name) {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (!this.buffers[name]) {
      const data = await (await fetch(`sounds/${name}.mp3`)).arrayBuffer();
      this.buffers[name] = await this.ctx.decodeAudioData(data);
    }
    return this.buffers[name];
  },
  async play(name) {
    try {
      const buf = await this.load(name);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      src.start();
    } catch { /* 소리를 못 내도 세기와 타이머는 그대로 */ }
  },
};

// ───────────────────────── 좌선 타이머 ─────────────────────────
// 시작과 끝에 큰 종, 정한 간격마다 작은 종. 도는 동안 화면이 꺼지지 않게 한다(지원하는 브라우저만).

const sit = {
  running: false, total: 0, end: 0, interval: 0, nextBell: 0, minutes: 0, tick: null, lock: null,
  left() { return Math.max(0, Math.ceil((this.end - Date.now()) / 1000)); },
  async start(minutes, interval) {
    this.stop(false);
    Object.assign(this, { running: true, minutes, total: minutes * 60, end: Date.now() + minutes * 60000, interval, nextBell: interval * 60 });
    sounds.play('bell_big');
    try { this.lock = await navigator.wakeLock?.request('screen'); } catch { this.lock = null; }
    this.tick = setInterval(() => this.update(), 250);
  },
  update() {
    const left = this.left();
    const elapsed = this.total - left;
    if (this.interval && left > 0 && elapsed >= this.nextBell) { sounds.play('bell_small'); this.nextBell += this.interval * 60; }
    const el = $('#sit-left');
    if (el) el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const bar = $('#sit-bar');
    if (bar) bar.style.width = `${(elapsed / this.total) * 100}%`;
    if (left === 0) {
      sounds.play('bell_big');
      prefs.addSit(this.minutes);
      this.stop(false);
      if (location.hash.startsWith('#/practice')) renderPracticeKeepScroll();
    }
  },
  // 중간에 그만두면 앉아 있던 만큼(1분 이상)만 기록한다.
  stop(record = true) {
    if (!this.running) return;
    clearInterval(this.tick);
    if (record) { const sat = Math.floor((this.total - this.left()) / 60); if (sat >= 1) prefs.addSit(sat); }
    this.running = false;
    this.lock?.release?.();
    this.lock = null;
  },
};
// 화면이 다시 보이면 화면 켜 둠을 다시 요청한다 (탭을 잠깐 떠나면 풀리기 때문)
document.addEventListener('visibilitychange', async () => {
  if (sit.running && document.visibilityState === 'visible' && !sit.lock) {
    try { sit.lock = await navigator.wakeLock?.request('screen'); } catch { /* 무시 */ }
  }
});
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ymd(new Date());

// ───────────────────────── 도우미 ─────────────────────────

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const app = () => $('#app');
const sutraById = (id) => sutras.find((s) => s.id === id);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2200);
}

// 구절 카드 바탕 (앱의 화면 테마와 같은 색)
const CARD_THEMES = [
  [tr('고요한 밤'), '#15171C', '#D4AE6A', '#E9E4D8', '#9A958A'],
  [tr('한지'), '#F1E7D2', '#A23B2A', '#2A2318', '#6E6250'],
  [tr('연꽃'), '#FBF3F5', '#B0476F', '#2B1D23', '#75636A'],
  [tr('먹'), '#101010', '#E08A6A', '#E6E6E3', '#9C9C98'],
  [tr('산사'), '#111A15', '#D9B864', '#E3E8DF', '#93A397'],
];
/** 구절을 1080×1350 카드 그림으로 그린다 */
async function verseCard(sutra, index, k = 0) {
  await document.fonts.load('64px "Gowun Batang"');
  const [, bg, accent, ink, muted] = CARD_THEMES[k];
  const sec = sutra.sections[index];
  const body = isMantra(sec) ? sec.eumdok : sec.plain;
  const where = `${tr('{0} {1}구절', sutra.title.ko, index + 1)}` + (headingKo(sec) ? ` · ${headingKo(sec)}` : '');
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 1350;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 1080, 1350);
  g.fillStyle = accent; g.beginPath(); g.arc(120, 180, 10, 0, 7); g.fill(); g.fillRect(144, 178, 106, 4);
  // 낱말 단위로 줄을 나누고, 길면 글자를 줄인다
  const wrap = (size) => {
    g.font = `${size}px "Gowun Batang", serif`;
    const lines = [];
    for (const para of body.split('\n')) {
      let line = '';
      for (const w of para.split(' ')) {
        const t = line ? line + ' ' + w : w;
        if (g.measureText(t).width > 860 && line) { lines.push(line); line = w; } else line = t;
      }
      lines.push(line);
    }
    return lines;
  };
  let size = 64, lines = wrap(size);
  while (lines.length * size * 1.55 > 790 && size > 30) { size -= 4; lines = wrap(size); }
  g.fillStyle = ink;
  const top = 260 + Math.max(0, (790 - lines.length * size * 1.55) / 2);
  lines.forEach((l, n) => g.fillText(l, 110, top + size + n * size * 1.55));
  g.fillStyle = muted; g.font = '34px "Gowun Batang", serif'; g.fillText('— ' + where, 110, 1160);
  g.fillStyle = accent; g.font = 'bold 36px "Gowun Batang", serif'; g.fillText(tr('경전함'), 110, 1230);
  return c;
}
/** 구절 공유 창: 카드 바탕을 골라 그림으로, 또는 글로 */
function openShareVerse(sutra, index) {
  let k = 0;
  const draw = async () => {
    const c = await verseCard(sutra, index, k);
    openSheet(`<h2 style="font-size:19px;margin:0 0 14px">${tr('구절 공유')}</h2>
      <img src="${c.toDataURL('image/png')}" alt="${tr('구절 카드 미리 보기')}" style="width:100%;max-width:360px;display:block;margin:0 auto;border-radius:12px">
      <div class="chips" style="justify-content:center;margin-top:12px">${CARD_THEMES.map(([n, bg, ac], j) => `<button class="chip ${j === k ? 'on' : ''}" data-card="${j}"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${bg};box-shadow:inset 0 0 0 3px ${ac};vertical-align:-1px"></span> ${n}</button>`).join('')}</div>
      <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn text" id="sh-text">${tr('글로 공유')}</button><button class="btn filled" id="sh-img">${tr('그림으로 공유')}</button></div>`, (el) => {
      el.querySelectorAll('[data-card]').forEach((b) => { b.onclick = () => { k = Number(b.dataset.card); draw(); }; });
      $('#sh-text', el).onclick = () => { closeSheet(); shareVerse(sutra, index); };
      $('#sh-img', el).onclick = () => c.toBlob(async (blob) => {
        const file = new File([blob], `${tr('경전함-{0}-{1}.png', sutra.id, index + 1)}`, { type: 'image/png' });
        try {
          if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); closeSheet(); return; }
        } catch (e) { if (e.name === 'AbortError') return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast(tr('그림을 내려받았어요'));
        closeSheet();
      }, 'image/png');
    });
  };
  draw();
}
async function shareVerse(sutra, index) {
  const sec = sutra.sections[index];
  const body = isMantra(sec) ? sec.eumdok : sec.plain;
  const where = `${tr('{0} {1}구절', sutra.title.ko, index + 1)}` + (headingKo(sec) ? ` · ${headingKo(sec)}` : '');
  const text = `${tr('{0}\n\n— {1}\n경전함', body, where)}`;
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast(tr('구절을 복사했어요')); } catch { toast(tr('공유할 수 없어요')); }
}

// ───────────────────────── 독송 듣기 (미리 만든 AI 음성 음원) ─────────────────────────
// audio/<경전>/<구절>.ko.mp3 (진언은 .eumdok.mp3). 경전 전체 음원이 있을 때만 들을 수 있다.
// 보기 방식과 상관없이 우리말 독송본을 읽고, 진언은 소리(음독)로 읽는다. 기기 음성은 쓰지 않는다.

// 듣는 방법: 경전 하나 / 독송 묶음(여러 경전 이어서) / 구간 반복 / 108배 맞춰 듣기(명호마다 쉬기).
// 어느 방법이든 취침 타이머로 정한 시간 뒤(또는 이 경전이 끝나면) 소리를 줄이며 멈출 수 있다.
const reciter = {
  playing: null, // { sutraId, index, total, playlist, pos, size, repeat, repeatTotal, bow, bowTotal, line, bowing }
  token: 0,
  recorded: new Set(),
  lines: new Set(),
  womanFiles: new Set(), // 여성 목소리로 만들어 둔 음원 (없는 구절은 스님 목소리)
  enFiles: new Set(), // 영어 독송 음원 (영어 화면에서, 없는 구절은 한국어)
  seconds: {},
  audio: null,
  mode: 'normal', // normal | repeat | bow
  queue: [], queuePos: 0, playlist: null,
  sleepEnd: 0, sleepAfter: false, sleepTimer: null,
  lastFinished: null,
  async loadRecorded() {
    try {
      const j = await (await fetch('audio/index.json')).json();
      this.recorded = new Set(j.files || []);
      this.lines = new Set(j.lines || []);
      this.seconds = j.seconds || {};
    } catch { this.recorded = new Set(); }
    try {
      const w = await (await fetch('voices/jessi/index.json')).json();
      this.womanFiles = new Set([...(w.files || []), ...(w.lines || [])]);
    } catch { this.womanFiles = new Set(); }
    if (EN) {
      try {
        const e = await (await fetch('voices/en/index.json')).json();
        this.enFiles = new Set(e.files || []);
      } catch { this.enFiles = new Set(); }
    }
  },
  /** 잠금 화면·알림의 미디어 정보: 제목에 경전과 구절, 내용에 지금 읽는 글 */
  lyric(sutra, item) {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const sec = sutra.sections[item.i];
    const line = item.line != null ? sec.recitation[item.line] : isMantra(sec) ? sec.eumdok : (sec.recitation.length ? sec.recitation.join(' ') : sec.plain);
    const where = [headingKo(sec), `${item.i + 1}/${sutra.sections.length}`].filter(Boolean).join(' ');
    navigator.mediaSession.metadata = new MediaMetadata({
      title: [this.playlist?.name, sutra.title.ko, where].filter(Boolean).join(' · '),
      artist: String(line || '').replace(/\n/g, ' ').slice(0, 160),
      album: tr('경전함 독송'),
    });
  },
  /** 고른 목소리의 음원 주소 */
  srcOf(file) {
    if (EN && prefs.chantEnglish && this.enFiles.has(file)) return 'voices/en/' + file;
    return prefs.voice === 'woman' && this.womanFiles.has(file) ? 'voices/jessi/' + file : 'audio/' + file;
  },
  fileFor(sutra, sec) {
    return `${sutra.id}/${sec.id}.${isMantra(sec) ? 'eumdok' : 'ko'}.mp3`;
  },
  lineFor(sutra, sec, n) {
    return `${sutra.id}/lines/${sec.id}-${String(n + 1).padStart(2, '0')}.ko.mp3`;
  },
  canPlay(sutra) {
    return this.recorded.size > 0 && sutra.sections.every((sec) => this.recorded.has(this.fileFor(sutra, sec)));
  },
  canBow(sutra) {
    return canBowSutra(sutra) && this.canPlay(sutra) &&
      sutra.sections.filter((s) => s.bow === 'lines').every((s) => s.recitation.every((_, n) => this.lines.has(this.lineFor(sutra, s, n))));
  },
  /** 듣기 속도를 반영한 들을 시간(분), 음원이 없으면 null */
  minutes(sutraId) {
    const sec = this.seconds[sutraId];
    return sec ? Math.max(1, Math.round(sec / 60 / prefs.rate)) : null;
  },
  /** 경전 하나를 [start]번째 구절부터 */
  play(sutra, start = 0) {
    if (!this.canPlay(sutra)) return;
    this.mode = 'normal'; this.playlist = null; this.queue = [sutra]; this.queuePos = 0;
    this.startSutra(sutra, start);
  },
  /** 독송 묶음: 음원이 있는 경전만 차례로 */
  playPlaylist(p) {
    const list = p.sutras.map(sutraById).filter((s) => s && this.canPlay(s));
    if (!list.length) return null;
    this.mode = 'normal'; this.playlist = p; this.queue = list; this.queuePos = 0;
    this.startSutra(list[0], 0);
    return list[0];
  },
  /** 구절 하나를 times번 (0이면 멈출 때까지) */
  playSection(sutra, i, times) {
    if (!this.canPlay(sutra)) return;
    this.mode = 'repeat'; this.playlist = null; this.queue = [sutra]; this.queuePos = 0; this.repeatTotal = times;
    this.run(sutra, [{ i, src: this.fileFor(sutra, sutra.sections[i]), times: times > 0 ? times : Infinity }]);
  },
  /** 108배 맞춰 듣기: 명호 한 줄을 읽고 pause초 쉰다 */
  playBows(sutra, pause) {
    if (!this.canBow(sutra)) return;
    this.mode = 'bow'; this.playlist = null; this.queue = [sutra]; this.queuePos = 0; this.bowPause = pause;
    this.bowDone = 0; this.bowTotal = bowCount(sutra);
    const items = sutra.sections.flatMap((sec, i) => {
      if (sec.bow === 'lines') return sec.recitation.map((_, n) => ({ i, src: this.lineFor(sutra, sec, n), times: 1, pause: pause * 1000, line: n, bow: true }));
      if (sec.bow === 'one') return [{ i, src: this.fileFor(sutra, sec), times: 1, pause: pause * 1000, bow: true }];
      return [{ i, src: this.fileFor(sutra, sec), times: sec.repeat > 1 ? prefs.repeat : 1, pause: 1500 }];
    });
    this.run(sutra, items);
  },
  startSutra(sutra, start) {
    const total = sutra.sections.length;
    const items = [];
    for (let i = Math.min(Math.max(start, 0), total - 1); i < total; i++) {
      const sec = sutra.sections[i];
      items.push({ i, src: this.fileFor(sutra, sec), times: sec.repeat > 1 ? prefs.repeat : 1 });
    }
    this.run(sutra, items);
  },
  run(sutra, items) {
    const token = ++this.token;
    this.lastFinished = null;
    const total = sutra.sections.length;
    const audio = this.audio || (this.audio = new Audio());
    audio.preservesPitch = true; // 느리게 들어도 목소리 높이는 그대로
    if (!this.sleepEnd) audio.volume = 1;
    let pos = 0;
    let rep = 0;
    let wait = null; // 절하며 쉬는 동안의 타이머
    const next = () => {
      if (token !== this.token) return;
      const item = items[pos];
      if (!item) return this.finishOne(sutra);
      rep++;
      this.set({
        sutraId: sutra.id, index: item.i, total,
        playlist: this.playlist?.name, pos: this.queuePos, size: this.queue.length,
        repeat: this.mode === 'repeat' ? rep : 0, repeatTotal: this.repeatTotal,
        // 몇 번째 절인지는 건너뛰어도 맞도록 앞의 항목을 세어서 정한다
        bow: this.mode === 'bow' ? items.slice(0, pos + 1).filter((x) => x.bow).length : 0,
        bowTotal: this.bowTotal, line: item.line ?? null, bowing: false, paused: false,
      });
      this.lyric(sutra, item);
      audio.src = this.srcOf(item.src);
      audio.playbackRate = prefs.rate;
      audio.play().catch(() => { if (token === this.token && !this.playing?.paused) this.stop(); });
    };
    audio.onended = () => {
      if (token !== this.token) return;
      const item = items[pos];
      if (rep < item.times) return next();
      pos++;
      rep = 0;
      if (item.pause) {
        this.set({ ...this.playing, bowing: true });
        wait = setTimeout(() => { wait = null; next(); }, item.pause);
      } else next();
    };
    audio.onerror = () => { if (token === this.token) this.stop(); };
    // 일시정지·이어 듣기·건너뛰기 (이 재생에만 해당)
    this.ctl = {
      pause: () => {
        if (!this.playing || this.playing.paused) return;
        audio.pause();
        if (wait) { clearTimeout(wait); wait = null; this.ctl.resumeByNext = true; }
        this.set({ ...this.playing, paused: true });
      },
      resume: () => {
        if (!this.playing?.paused) return;
        if (this.ctl.resumeByNext) { this.ctl.resumeByNext = false; next(); return; }
        this.set({ ...this.playing, paused: false });
        audio.play().catch(() => {});
      },
      skip: (to) => {
        if (to < 0 || to >= items.length) return false;
        if (wait) { clearTimeout(wait); wait = null; }
        pos = to;
        rep = 0;
        next();
        return true;
      },
      pos: () => pos,
      size: items.length,
    };
    // 잠금 화면·알림·이어폰 버튼 (지원하는 브라우저만)
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: (this.playlist ? this.playlist.name + ' · ' : '') + sutra.title.ko, artist: tr('경전함 독송') });
      navigator.mediaSession.setActionHandler('play', () => this.resume());
      navigator.mediaSession.setActionHandler('pause', () => this.pause());
      navigator.mediaSession.setActionHandler('stop', () => this.stop());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
    }
    next();
  },
  pause() { this.ctl?.pause(); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; },
  resume() { this.ctl?.resume(); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; },
  togglePause() { this.playing?.paused ? this.resume() : this.pause(); },
  /** 다음 구절 (마지막이면 묶음의 다음 경전) */
  next() {
    if (!this.playing || !this.ctl) return;
    if (this.ctl.skip(this.ctl.pos() + 1)) return;
    if (this.mode === 'normal' && this.queuePos < this.queue.length - 1) {
      this.queuePos++;
      const s = this.queue[this.queuePos];
      this.startSutra(s, 0);
      go('/read/' + s.id);
    }
  },
  /** 이전 구절 (첫 구절이면 묶음의 앞 경전, 그것도 없으면 처음부터) */
  previous() {
    if (!this.playing || !this.ctl) return;
    const p = this.ctl.pos();
    if (p > 0) { this.ctl.skip(p - 1); return; }
    if (this.mode === 'normal' && this.queuePos > 0) {
      this.queuePos--;
      const s = this.queue[this.queuePos];
      this.startSutra(s, 0);
      go('/read/' + s.id);
      return;
    }
    this.ctl.skip(0);
  },
  finishOne(sutra) {
    prefs.markPractice(sutra.id);
    if (this.sleepAfter) return this.finishAll(sutra);
    if (this.mode === 'normal' && this.queuePos < this.queue.length - 1) {
      this.queuePos++;
      const nextSutra = this.queue[this.queuePos];
      this.startSutra(nextSutra, 0);
      go('/read/' + nextSutra.id); // 화면도 다음 경전으로
      return;
    }
    if (prefs.loop && this.mode === 'normal') { this.queuePos = 0; this.startSutra(this.queue[0], 0); if (this.queue.length > 1) go('/read/' + this.queue[0].id); return; }
    if (prefs.loop && this.mode === 'bow') return this.playBows(sutra, this.bowPause);
    this.finishAll(sutra);
  },
  finishAll(sutra) {
    const wasRepeat = this.mode === 'repeat';
    this.stop();
    if (!wasRepeat) { this.lastFinished = sutra.id; onPlaybackChange(); }
  },
  /** 취침 타이머: null 끄기, 0 이 경전이 끝나면, 그 밖에는 분 (마지막 15초 동안 소리를 줄인다) */
  setSleep(minutes) {
    clearInterval(this.sleepTimer);
    this.sleepAfter = false;
    this.sleepEnd = 0;
    if (this.audio) this.audio.volume = 1;
    if (minutes === 0) this.sleepAfter = true;
    else if (minutes) {
      this.sleepEnd = Date.now() + minutes * 60000;
      this.sleepTimer = setInterval(() => {
        const left = Math.round((this.sleepEnd - Date.now()) / 1000);
        if (left <= 0) return this.stop();
        if (this.audio) this.audio.volume = Math.min(1, Math.max(0.05, left / 15));
        const el = $('#sleep');
        if (el) el.textContent = sleepLabel();
      }, 1000);
    }
    onPlaybackChange();
  },
  sleepLeft() {
    if (this.sleepAfter) return -1;
    return this.sleepEnd ? Math.max(0, Math.round((this.sleepEnd - Date.now()) / 1000)) : null;
  },
  stop() {
    this.token++;
    if (this.audio) { this.audio.pause(); this.audio.volume = 1; }
    clearInterval(this.sleepTimer);
    this.sleepEnd = 0;
    this.sleepAfter = false;
    this.playlist = null;
    this.ctl = null;
    this.set(null);
  },
  set(p) {
    this.playing = p;
    onPlaybackChange();
  },
};
const sleepLabel = () => {
  const l = reciter.sleepLeft();
  return l == null ? tr('취침') : l < 0 ? tr('끝나면') : l >= 60 ? `${tr('{0}분', Math.ceil(l / 60))}` : `${tr('{0}초', l)}`;
};

// ───────────────────────── 아이콘 (앱과 같은 선 아이콘, 색은 글자색을 따른다) ─────────────────────────

const svg = (body) => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
const dot = (x, y, r) => '<circle cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="' + r + '" fill="currentColor" stroke="none"/>';
const ICON = {
  home: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2"/><path d="M12 3.5v6.5M12 14v6.5M3.5 12H10M14 12h6.5"/>'),
  search: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l4.5 4.5"/>'),
  // 염주: 둥글게 꿴 구슬 열 개와 아래 술
  practice: svg(Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5; return dot(12 + 7 * Math.cos(a), 11 + 7 * Math.sin(a), 1.45); }).join('') + '<path d="M12 18v3.5"/>'),
  about: svg(dot(5.5, 12, 1.7) + dot(12, 12, 1.7) + dot(18.5, 12, 1.7)),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  play: svg('<path d="M8 5.2c0-.8.9-1.3 1.6-.8l9.4 6.4c.6.4.6 1.3 0 1.7l-9.4 6.4c-.7.5-1.6 0-1.6-.8z" fill="currentColor" stroke="none"/>'),
  stop: svg('<rect x="7" y="6" width="10" height="12" rx=".5" fill="currentColor" stroke="none"/>'),
  settings: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  video: svg('<rect x="4.5" y="5.5" width="11" height="13" rx="2"/><path d="M15.5 10L20 7.5v9L15.5 14"/>'),
  // Material Symbols (Google, Apache 2.0), Iconify에서 받음
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 19q-.825 0-1.412-.587T14 17V7q0-.825.588-1.412T16 5t1.413.588T18 7v10q0 .825-.587 1.413T16 19m-8 0q-.825 0-1.412-.587T6 17V7q0-.825.588-1.412T8 5t1.413.588T10 7v10q0 .825-.587 1.413T8 19"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.5 17V7q0-.425.288-.712T17.5 6t.713.288T18.5 7v10q0 .425-.288.713T17.5 18t-.712-.288T16.5 17m-11-.875v-8.25q0-.45.3-.725t.7-.275q.125 0 .275.025t.275.125l6.2 4.15q.225.15.338.363T13.7 12t-.112.463t-.338.362l-6.2 4.15q-.125.1-.275.125t-.275.025q-.4 0-.7-.275t-.3-.725"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5.5 17V7q0-.425.288-.712T6.5 6t.713.288T7.5 7v10q0 .425-.288.713T6.5 18t-.712-.288T5.5 17m11.45-.025l-6.2-4.15q-.225-.15-.337-.362T10.3 12t.113-.462t.337-.363l6.2-4.15q.125-.1.275-.125t.275-.025q.4 0 .7.275t.3.725v8.25q0 .45-.3.725t-.7.275q-.125 0-.275-.025t-.275-.125"/></svg>',
};

// ───────────────────────── 화면 이동 (주소 #/...) ─────────────────────────

function route() {
  const [path, query] = location.hash.slice(1).split('?');
  const parts = (path || '/').split('/').filter(Boolean);
  const params = new URLSearchParams(query || '');
  return { name: parts[0] || 'home', arg: parts[1], arg2: parts[2], params };
}
const go = (hash) => { location.hash = hash; };

let cleanup = [];
function render() {
  cleanup.forEach((f) => f());
  cleanup = [];
  closeSheet();
  const r = route();
  const tabs = { home: tr('홈'), search: tr('검색'), practice: tr('수행'), about: tr('더보기') };
  renderSide(r);
  const nav = $('#tabs');
  if (r.name in tabs) {
    nav.hidden = false;
    nav.innerHTML = Object.entries(tabs).map(([k, v]) =>
      `<a href="#/${k === 'home' ? '' : k}" class="${r.name === k ? 'on' : ''}"><span class="ico">${ICON[k]}</span>${v}</a>`).join('');
  } else {
    nav.hidden = true;
  }
  window.scrollTo(0, 0);
  if (r.name === 'read') return renderReader(r.arg, r.params.get('s'));
  if (r.name === 'trace') return renderTracing(r.arg, Number(r.arg2) || 0);
  if (r.name === 'search') return renderSearch(r.params.get('q') || '');
  if (r.name === 'practice') return renderPractice();
  if (r.name === 'about') return renderAbout();
  return renderHome();
}

// ───────────────────────── 넓은 화면 (데스크톱) ─────────────────────────
// 1024px 넘으면 아래 탭 대신 왼쪽 사이드바, 1280px 넘으면 읽기 화면 오른쪽에 구절 자세히,
// 1400px 넘으면 왼쪽에 목차를 늘 펴 둔다. 휴대폰 화면은 그대로.
const WIDE = matchMedia('(min-width: 1024px)');
const DETAIL_PANE = matchMedia('(min-width: 1280px)');
WIDE.addEventListener('change', () => render());
DETAIL_PANE.addEventListener('change', () => { if (route().name === 'read') render(); });

function renderSide(r) {
  const side = $('#side');
  if (!side) return;
  if (!WIDE.matches) { side.innerHTML = ''; return; }
  const cur = r.name === 'read' || r.name === 'trace' ? r.arg : null;
  const tabs = { home: tr('홈'), search: tr('검색'), practice: tr('수행'), about: tr('더보기') };
  const groups = [['daily', tr('매일 독송')], ['sutra', tr('경전')], ['verse', tr('게송·수행문')]];
  side.innerHTML = `
    <a class="side-logo" href="#/">${tr('경전함')}</a>
    ${r.name === 'search' ? '' : `<input class="side-q" id="side-q" type="search" placeholder="${tr('검색  /')}" aria-label="${tr('경전 검색')}" autocomplete="off">`}
    <nav class="side-nav">${Object.entries(tabs).map(([k, v]) =>
      `<a href="#/${k === 'home' ? '' : k}" class="${r.name === k ? 'on' : ''}"><span class="ico">${ICON[k]}</span>${v}</a>`).join('')}</nav>
    ${groups.map(([g, name]) => {
      const list = sutras.filter((s) => s.group === g);
      return list.length ? `<div class="side-group">${name}</div>${list.map((s) =>
        `<a class="side-sutra ${s.id === cur ? 'on' : ''}" href="#/read/${s.id}" ${s.id === cur ? 'aria-current="page"' : ''}>${esc(s.title.short || s.title.ko)}</a>`).join('')}` : '';
    }).join('')}`;
  const q = $('#side-q');
  if (q) q.onkeydown = (e) => { if (e.key === 'Enter' && q.value.trim()) go('/search?q=' + encodeURIComponent(q.value.trim())); };
  side.querySelector('.side-sutra.on')?.scrollIntoView({ block: 'nearest' });
}

/** 글자 크기를 한 단계 키우거나 줄인다 (두 손가락, + / - 키) */
function stepFont(d) {
  const i = Math.max(0, FONT_STEPS.findIndex(([v]) => v === prefs.fontScale));
  const step = FONT_STEPS[i + d];
  if (!step) return false;
  prefs.fontScale = step[0];
  document.documentElement.style.setProperty('--fs', prefs.fontScale);
  toast(tr('글자 {0}', step[1]));
  return true;
}

/** 지금 화면 맨 위에 보이는 구절 번호 */
function topPassage() {
  const top = WIDE.matches ? 70 : 80;
  const ps = [...document.querySelectorAll('.passage')];
  const first = ps.find((p) => p.getBoundingClientRect().bottom > top);
  return first ? Number(first.dataset.i) : 0;
}

// 키보드: Space 재생·일시정지, ←/→ 이전·다음 구절, / 검색, + / - 글자 크기
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t.closest?.('input, textarea, select, [contenteditable]')) return;
  if ($('#sheet-root')?.children.length) return;
  if (e.key === '/') {
    e.preventDefault();
    const q = $('#side-q') || $('#q');
    if (q) q.focus(); else go('/search');
    return;
  }
  if (!reader) return;
  const sutra = reader.sutra;
  const p = reciter.playing && reciter.playing.sutraId === sutra.id ? reciter.playing : null;
  if (e.key === ' ' && !t.closest?.('button, a, [role=button]')) {
    e.preventDefault();
    if (p) reciter.togglePause();
    else if (reciter.canPlay(sutra)) listen(reader.cursor ?? topPassage());
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const d = e.key === 'ArrowRight' ? 1 : -1;
    if (p) d > 0 ? reciter.next() : reciter.previous();
    else {
      const i = Math.min(sutra.sections.length - 1, Math.max(0, (reader.cursor ?? topPassage()) + d));
      reader.cursor = i;
      reader.navAt = Date.now(); // 부드럽게 넘기는 동안 스크롤 위치로 덮어쓰지 않게
      $('#p-' + i)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (DETAIL_PANE.matches) openDetail(sutra, i);
    }
  } else if (e.key === '+' || e.key === '=') { e.preventDefault(); stepFont(1); }
  else if (e.key === '-' || e.key === '_') { e.preventDefault(); stepFont(-1); }
});

// ───────────────────────── 홈 ─────────────────────────

function renderHome() {
  const v = dailyVerse();
  const now = new Date();
  const last = sutraById(prefs.lastSutra);
  // 들을 시간(음원이 있으면 'N분'), 없으면 구절 수
  const length = (s) => (reciter.minutes(s.id) ? `${tr('{0}분', reciter.minutes(s.id))}` : (EN ? `${s.sections.length} verses` : `${s.sections.length}구절`) /* i18n: skip (분량) */);
  const label = (s) => s.title.short || s.title.ko;
  const group = (g) => sutras.filter((s) => s.group === g);

  const dow = weekdayName(now); // 한국어 '목', 영어 'Thursday'
  app().innerHTML = `<div class="page home">
    <div class="home-head"><h1>${tr('경전함')}</h1><div class="muted">${tr('{0}월 {1}일 {2}요일{3}', now.getMonth() + 1, now.getDate(), dow, lunar.of(today()) ? ' · ' + lunar.of(today()).label : '')}</div>
      ${(() => { const h = lunar.next(today()); if (!h) return ''; const [, hm, hd] = h.date.split('-').map(Number);
        return `<div class="holy-next">${h.days === 0 ? `${tr('오늘은 {0}입니다', h.name)}` : `${tr('{0} {1}일 뒤 ({2}월 {3}일)', h.name, h.days, hm, hd)}`}</div>`; })()}</div>
    <div class="home-top"><div class="col">${v ? `<div class="card verse">
      <div class="label">${tr('오늘의 말씀 · {0}', esc(v.sutra.title.ko))}</div>
      <a href="#/read/${v.sutra.id}?s=${v.sec.id}" style="color:inherit;text-decoration:none"><div class="text" style="margin-top:10px">${esc(v.sec.plain)}</div></a>
      <div class="row" style="justify-content:flex-end"><button class="btn text" id="share-daily">${tr('공유')}</button></div>
    </div>` : ''}</div><div class="col">
    ${last ? `<a class="resume" href="#/read/${last.id}">${ICON.play}<span class="grow">${tr('이어 읽기 · {0}', esc(last.title.ko))}</span><span class="at">${tr('{0}구절', prefs.position(last.id) + 1)}</span></a>` : ''}
    ${group('daily').length ? `<h2 class="group">${tr('매일 독송')}</h2><div class="daily">${group('daily').map((s) =>
      `<a class="card" href="#/read/${s.id}"><b>${esc(label(s))}</b><span class="small muted">${length(s)}</span></a>`).join('')}</div>` : ''}
    <h2 class="group">${tr('묶음 듣기')}</h2><div class="chips">${PRESET_PLAYLISTS.concat(prefs.playlists).map((p) => {
      const mine = p.id.startsWith('my-');
      const mins = p.sutras.reduce((n, id) => n + (reciter.minutes(id) || 0), 0);
      return `<span class="pill playlist ${mine ? 'mine' : ''}"><button data-pl="${esc(p.id)}" aria-label="${tr('{0} 이어서 듣기', esc(p.name))}">${ICON.play} ${esc(p.name)}${mins ? ` <span class="small muted">${tr('{0}분', mins)}</span>` : ''}</button>${mine ? `<button class="x" data-del="${esc(p.id)}" aria-label="${tr('{0} 묶음 지우기', esc(p.name))}">×</button>` : ''}</span>`;
    }).join('')}<button class="pill outline" id="pl-new">${tr('+ 묶음 만들기')}</button></div></div></div>
    ${group('sutra').length ? `<h2 class="group">${tr('경전')}</h2><div class="rows">${group('sutra').map((s) =>
      `<a href="#/read/${s.id}"><span class="grow">${esc(s.title.ko)}</span><span class="small muted">${length(s)}</span></a>`).join('')}</div>` : ''}
    ${group('verse').length ? `<h2 class="group">${tr('게송·수행문')}</h2><div class="chips">${group('verse').map((s) =>
      `<a class="pill" href="#/read/${s.id}">${esc(label(s))}</a>`).join('')}</div>` : ''}
  </div>`;
  if (v) $('#share-daily').onclick = () => openShareVerse(v.sutra, v.number - 1);
  const all = PRESET_PLAYLISTS.concat(prefs.playlists);
  app().querySelectorAll('[data-pl]').forEach((b) => {
    b.onclick = () => {
      const first = reciter.playPlaylist(all.find((p) => p.id === b.dataset.pl));
      if (first) go('/read/' + first.id); else toast(tr('들을 수 있는 경전이 없어요'));
    };
  });
  app().querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = () => { const p = all.find((x) => x.id === b.dataset.del); if (confirm(`${tr('\'{0}\' 묶음을 지울까요?', p.name)}`)) { prefs.removePlaylist(p.id); renderHome(); } };
  });
  $('#pl-new').onclick = openPlaylistEditor;
}

/** 독송 묶음 만들기: 이름을 짓고 들을 차례대로 누른다 */
function openPlaylistEditor() {
  let picked = [];
  const playable = sutras.filter((s) => reciter.canPlay(s));
  const draw = (name = '') => openSheet(`
    <h2 style="font-size:19px;margin:0 0 14px">${tr('묶음 만들기')}</h2>
    <input class="search-box" id="pl-name" placeholder="${tr('묶음 이름 (예: 나의 저녁 기도)')}" value="${esc(name)}" aria-label="${tr('묶음 이름')}">
    <p class="small muted">${tr('들을 차례대로 누르세요')}</p>
    <div class="chips">${playable.map((s) => { const n = picked.indexOf(s.id);
      return `<button class="chip ${n >= 0 ? 'on' : ''}" data-pick="${s.id}" aria-pressed="${n >= 0}">${n >= 0 ? n + 1 + '. ' : ''}${esc(s.title.short || s.title.ko)}</button>`; }).join('')}</div>
    <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn text" id="pl-cancel">${tr('취소')}</button><button class="btn filled" id="pl-save">${tr('만들기')}</button></div>`, (el) => {
    el.querySelectorAll('[data-pick]').forEach((b) => {
      b.onclick = () => { const id = b.dataset.pick; picked = picked.includes(id) ? picked.filter((x) => x !== id) : picked.concat(id); draw($('#pl-name', el).value); };
    });
    $('#pl-cancel', el).onclick = closeSheet;
    $('#pl-save', el).onclick = () => {
      const n = $('#pl-name', el).value.trim();
      if (!n || !picked.length) return toast(tr('이름을 짓고 경전을 하나 이상 골라 주세요'));
      prefs.addPlaylist(n, picked);
      closeSheet();
      renderHome();
    };
  });
  draw();
}

// ───────────────────────── 읽기 ─────────────────────────

function passageHtml(sutra, sec, i, mode) {
  const head = mode === 'Study' ? sec.heading : headingKo(sec);
  const label = [head, sec.repeat > 1 ? `×${sec.repeat}` : null].filter(Boolean).join('  ');
  let body;
  if (mode === 'Memorize') {
    // 외우기: 음독(또는 우리말 독송본)을 가려 두고 떠올려 본다. 누르면 잠깐 펼친다.
    const text = reader?.memEumdok !== false || isMantra(sec) ? sec.eumdok : (sec.recitation.length ? sec.recitation : [sec.plain]).join('\n');
    const level = reader?.revealed?.has(i) ? 0 : reader?.mask ?? 1;
    body = `<div class="recite pre ${level ? 'masked' : ''}" ${level ? ('aria-label="' + tr('가려진 구절. 눌러서 펼쳐 보세요') + '"') : ''}>${esc(maskText(text, level))}</div>`;
  } else if (isMantra(sec) && mode !== 'Study') body = `<div class="mantra">${esc(sec.eumdok)}</div>`;
  else if (mode === 'Read') body = `<div class="plain">${esc(sec.plain)}</div>`;
  else if (mode === 'Recite') body = `<div class="recite pre">${esc((sec.recitation.length ? sec.recitation : [sec.plain]).join('\n'))}</div>`;
  else body = `<div class="study"><div><div class="hanja pre">${esc(sec.hanja)}</div><div class="eumdok">${esc(sec.eumdok)}</div></div>
    <div class="plain">${esc(isMantra(sec) ? sec.meaning || '' : sec.plain)}</div></div>`;
  const marked = prefs.isBookmarked(`${sutra.id}/${sec.id}`);
  const star = marked ? '<span class="star" aria-hidden="true">★</span>' : '';
  return `<div class="passage" id="p-${i}" data-i="${i}" role="button" tabindex="0">
    <div class="num" aria-label="${tr('{0}구절{1}', i + 1, marked ? tr(', 즐겨찾기') : '')}">${i + 1}${star}</div>
    <div class="body">${label ? `<div class="head">${esc(label)}</div>` : ''}${body}</div></div>`;
}

let reader = null; // 지금 열린 경전 상태
// 읽기 보기는 현대어 풀이를 보여 주지만 한국어 음원은 독송본(진언은 소리)을 읽는다.
// 그래서 듣는 동안에는 독송 보기로 바꿔 보여 주고, 멈추면 돌아온다 (앱 Reader.kt와 같다).
// 영어 음원은 읽기 보기의 영어 풀이를 그대로 읽으므로 바꾸지 않는다. 듣는 중에 읽기를 다시 고르면 그대로 둔다.
let keepRead = false;
function shownMode(sutra) {
  const chosen = prefs.viewMode;
  const p = reciter.playing && reciter.playing.sutraId === sutra.id ? reciter.playing : null;
  if (!p) { keepRead = false; return chosen; }
  const first = sutra.sections.find((x) => !isMantra(x));
  const english = EN && prefs.chantEnglish && first && reciter.enFiles.has(reciter.fileFor(sutra, first));
  return chosen === 'Read' && !english && !keepRead ? 'Recite' : chosen;
}

function renderReader(id, focusId) {
  const sutra = sutraById(id);
  if (!sutra) return go('/');
  const mode = VIEW_MODES.find((m) => m.id === shownMode(sutra)) || VIEW_MODES[0];
  const autoRecite = mode.id !== prefs.viewMode;
  reader = { sutra, mode, mask: store.get('maskLevel', 1), memEumdok: store.get('memEumdok', true), revealed: new Set(), bowPause: store.get('bowPause', 5) };
  document.documentElement.style.setProperty('--fs', prefs.fontScale);
  const toc = sutra.sections.some((s) => s.heading);

  const tocLabel = (s) => headingKo(s) || (isMantra(s) ? s.eumdok : s.plain).replace(/\s+/g, ' ').slice(0, 18);
  app().innerHTML = `<div class="reader-grid">
    <nav class="toc-pane" aria-label="${tr('목차')}"><div class="toc-title">${esc(sutra.title.ko)}</div>
      ${sutra.sections.map((s, i) => `<a href="#" data-toc="${i}"><span class="n">${i + 1}</span><span class="t">${esc(tocLabel(s))}</span></a>`).join('')}</nav>
    <div class="reader-main">
    <div class="topbar">
      <button class="icon" id="back" aria-label="${tr('뒤로')}">${ICON.back}</button>
      <h1 title="${esc(sutra.title.ko)}">${esc(EN ? sutra.title.short || sutra.title.ko : sutra.title.ko)}</h1>
      ${toc ? `<select id="toc" aria-label="${tr('목차')}"><option value="">${tr('목차 ▾')}</option>
        ${sutra.sections.map((s, i) => headingKo(s) ? `<option value="${i}">${i + 1}  ${esc(headingKo(s))}</option>` : '').join('')}</select>` : ''}
      <span style="flex:1"></span>
      ${sutra.videos.length ? `<button class="btn text" id="video-toggle">${tr('{0} 영상', ICON.video)}</button>` : ''}
      <button class="icon" id="settings" aria-label="${tr('보기·듣기 설정')}">${ICON.settings}</button>
    </div>
    <div id="video"></div>
    <div class="page reader" style="padding-top:0">
      <div class="segment">${VIEW_MODES.map((m) => `<button data-mode="${m.id}" class="${m.id === mode.id ? 'on' : ''}">${m.id === mode.id ? '✓ ' : ''}${m.label}</button>`).join('')}</div>
      ${mode.id === 'Memorize' ? `<div class="chips choice">${MASK_LEVELS.map((n, k) => `<button class="chip ${k === reader.mask ? 'on' : ''}" data-mask="${k}">${n}</button>`).join('')}</div>
        <div class="chips choice" style="margin-top:8px"><button class="chip ${reader.memEumdok ? 'on' : ''}" data-mem="1">${tr('음독으로')}</button><button class="chip ${reader.memEumdok ? '' : 'on'}" data-mem="0">${tr('우리말로')}</button></div>
        <p class="small muted">${tr('구절을 누르면 잠깐 펼쳐 보고, 길게 누르면 자세히 볼 수 있어요')}</p>`
        : autoRecite ? `<p class="small" style="color:var(--primary)">${tr('듣는 동안에는 소리와 같은 독송본을 보여 드려요. 멈추면 읽기로 돌아가요.')}</p>`
        : reciter.canPlay(sutra) ? `<p class="small muted">${tr('듣기: AI 음성 독송 · {0}', WIDE.matches ? tr('Space 듣기 · ←/→ 구절 · +/- 글자 크기') : tr('두 손가락으로 글자 크기 조절'))}</p>` : ''}
      ${reciter.canBow(sutra) ? `<div class="card bowbox" id="bowbox"><b>${tr('108배 맞춰 듣기')}</b>
        <p class="small muted" style="margin:4px 0 10px">${tr('명호를 한 줄 읽고, 절할 시간만큼 쉬었다가 다음으로 넘어가요. 몇 번째 절인지 아래에 크게 보여 드려요. (모두 {0}번)', bowCount(sutra))}</p>
        <div class="chips choice">${BOW_PAUSES.map((s) => `<button class="chip ${s === reader.bowPause ? 'on' : ''}" data-pause="${s}">${tr('{0}초', s)}</button>`).join('')}</div>
        <button class="btn filled" id="bow-start" style="width:100%;margin-top:12px;font-weight:700">${tr('절하며 듣기 시작')}</button></div>` : ''}
      <div id="passages">${sutra.sections.map((s, i) => passageHtml(sutra, s, i, mode.id)).join('')}</div>
      ${vowReadingHtml()}
    </div>
    <div id="player"></div>
    </div>
    <aside class="detail-pane" id="detail-pane" aria-label="${tr('구절 자세히')}"><p class="muted small hint">${tr('구절을 누르면 원문·음독·해설이 여기에 나와요.')}<br>${tr('←/→ 구절 이동 · Space 듣기 · +/- 글자 크기')}</p></aside>
  </div>`;
  app().querySelectorAll('[data-toc]').forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      a.blur(); // Space·화살표가 곧바로 읽기 화면에 들게
      const i = Number(a.dataset.toc);
      $('#p-' + i)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      markToc(i);
      if (DETAIL_PANE.matches) openDetail(sutra, i);
    };
  });

  $('#back').onclick = () => { reciter.stop(); history.length > 1 ? history.back() : go('/'); };
  $('#settings').onclick = openSettings;
  $('#video-toggle')?.addEventListener('click', () => (reader.video == null ? openVideo(0) : closeVideo()));
  if (toc) $('#toc').onchange = (e) => { if (e.target.value !== '') $('#p-' + e.target.value).scrollIntoView(); e.target.value = ''; };
  app().querySelectorAll('[data-mode]').forEach((b) => {
    b.onclick = () => { if (reciter.playing && b.dataset.mode === 'Read') keepRead = true; prefs.viewMode = b.dataset.mode; renderReader(id); onPlaybackChange(); };
  });
  // 구절 누르기: 외우기에서는 펼쳐 보기, 그 밖에는 자세히. 길게 누르면(또는 Shift+Enter) 언제나 자세히.
  const repaint = (i) => { const el = $('#p-' + i); if (el) el.outerHTML = passageHtml(sutra, sutra.sections[i], i, mode.id); };
  const tap = (i) => {
    if (mode.id === 'Memorize') {
      reader.revealed.has(i) ? reader.revealed.delete(i) : reader.revealed.add(i);
      repaint(i);
      $('#p-' + i)?.focus();
    } else openDetail(sutra, i);
  };
  let pressTimer = null;
  let longPressed = false;
  $('#passages').addEventListener('pointerdown', (e) => {
    const p = e.target.closest('.passage');
    longPressed = false;
    if (p) pressTimer = setTimeout(() => { longPressed = true; openDetail(sutra, Number(p.dataset.i)); }, 550);
  });
  ['pointerup', 'pointercancel', 'pointermove'].forEach((t) => $('#passages').addEventListener(t, (e) => {
    if (t !== 'pointermove' || Math.abs(e.movementY) > 2) clearTimeout(pressTimer);
  }));
  $('#passages').onclick = (e) => {
    const p = e.target.closest('.passage');
    if (p && !longPressed) tap(Number(p.dataset.i));
  };
  $('#passages').onkeydown = (e) => {
    const p = e.target.closest('.passage');
    if (!p || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    if (e.shiftKey) openDetail(sutra, Number(p.dataset.i)); else tap(Number(p.dataset.i));
  };
  app().querySelectorAll('[data-mask]').forEach((b) => { b.onclick = () => { store.set('maskLevel', Number(b.dataset.mask)); renderReader(id); }; });
  app().querySelectorAll('[data-mem]').forEach((b) => { b.onclick = () => { store.set('memEumdok', b.dataset.mem === '1'); renderReader(id); }; });
  app().querySelectorAll('[data-pause]').forEach((b) => { b.onclick = () => { store.set('bowPause', Number(b.dataset.pause)); renderReader(id); onPlaybackChange(); }; });
  $('#bow-start')?.addEventListener('click', () => reciter.playBows(sutra, reader.bowPause));

  // 두 손가락으로 벌리거나 오므리면 글자 크기를 한 단계씩 (브라우저 확대 대신)
  let pinch = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onTouchStart = (e) => { if (e.touches.length === 2) pinch = dist(e.touches); };
  const onTouchMove = (e) => {
    if (e.touches.length !== 2 || !pinch) return;
    e.preventDefault();
    const ratio = dist(e.touches) / pinch;
    const d = ratio > 1.25 ? 1 : ratio < 0.8 ? -1 : 0;
    if (d && stepFont(d)) pinch = dist(e.touches);
  };
  const onTouchEnd = (e) => { if (e.touches.length < 2) pinch = null; };
  const area = $('.page.reader');
  area.addEventListener('touchstart', onTouchStart, { passive: true });
  area.addEventListener('touchmove', onTouchMove, { passive: false });
  area.addEventListener('touchend', onTouchEnd);

  // 처음 열 때 위치: 알림·검색에서 온 구절, 아니면 지난번 읽던 곳
  const focus = sutra.sections.findIndex((s) => s.id === focusId);
  const startAt = focus >= 0 ? focus : prefs.position(sutra.id);
  requestAnimationFrame(() => { if (startAt > 0) $('#p-' + startAt)?.scrollIntoView(); markToc(startAt); });
  if (DETAIL_PANE.matches && focus >= 0) openDetail(sutra, focus);

  // 읽던 위치 저장
  let scrollTimer;
  const onScroll = () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      if (!document.querySelector('.passage')) return;
      const i = topPassage();
      if (reader && Date.now() - (reader.navAt || 0) > 1500) reader.cursor = i;
      prefs.savePosition(sutra.id, i);
      markToc(i);
    }, 150);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  prefs.savePosition(sutra.id, startAt);
  // 1분 넘게 펴 두면 그날 읽은 것으로 기록
  const readTimer = setTimeout(() => prefs.markPractice(sutra.id), 60000);
  cleanup.push(() => {
    window.removeEventListener('scroll', onScroll);
    clearTimeout(readTimer);
    reader = null;
  });
  onPlaybackChange();
}

/** 왼쪽 목차에서 지금 읽는 구절을 표시하고 보이게 한다 */
function markToc(i) {
  const pane = $('.toc-pane');
  if (!pane) return;
  pane.querySelectorAll('a.on').forEach((a) => a.classList.remove('on'));
  const a = pane.querySelector(`[data-toc="${i}"]`);
  if (!a) return;
  a.classList.add('on');
  if (pane.offsetParent) {
    const r = a.getBoundingClientRect(), pr = pane.getBoundingClientRect();
    if (r.top < pr.top + 40 || r.bottom > pr.bottom - 20) pane.scrollTop += r.top - pr.top - pr.height / 3;
  }
}

// 공식 채널 독송 영상: 유튜브 플레이어를 그대로 위에 고정해 두고 아래에서 경문을 따라 읽는다.
// 개인정보 보호 모드(youtube-nocookie.com)로 연결하고, 영상을 숨기거나 소리만 뽑지 않는다.
function openVideo(i) {
  if (!reader) return;
  reciter.stop();
  reader.video = i;
  const v = reader.sutra.videos[i];
  $('#video').innerHTML = `<div class="video">
    <div class="frame"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.youtubeId)}?playsinline=1&rel=0"
      title="${esc(v.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
    <div class="row" style="padding:6px 8px 0 16px">
      <span class="grow"><b>${esc(v.title)}</b><br><span class="small muted">${tr('{0} 공식 채널 · YouTube', esc(v.channel))}</span></span>
      <a class="btn text" href="https://www.youtube.com/watch?v=${encodeURIComponent(v.youtubeId)}" target="_blank" rel="noopener">YouTube</a>
      <button class="btn text" id="video-close">${tr('닫기')}</button>
    </div>
    ${reader.sutra.videos.length > 1 ? `<div class="chips" style="padding:8px 16px 0">${reader.sutra.videos.map((x, k) =>
      `<button class="chip ${k === i ? 'on' : ''}" data-video="${k}">${esc(x.title)}</button>`).join('')}</div>` : ''}
  </div>`;
  $('#video-close').onclick = closeVideo;
  document.querySelectorAll('[data-video]').forEach((b) => { b.onclick = () => openVideo(Number(b.dataset.video)); });
  $('#video-toggle').innerHTML = ICON.video + tr(' 닫기');
  onPlaybackChange();
}
function closeVideo() {
  if (!reader) return;
  reader.video = null;
  $('#video').innerHTML = '';
  $('#video-toggle').innerHTML = ICON.video + tr(' 영상');
  onPlaybackChange();
}

function listen(start = 0) {
  if (!reader) return;
  reciter.play(reader.sutra, start);
}

function onPlaybackChange() {
  if (!reader) return;
  const p = reciter.playing && reciter.playing.sutraId === reader.sutra.id ? reciter.playing : null;
  // 듣기를 시작하거나 멈춰서 보여 줄 보기가 바뀌면 다시 그리고, 읽던 구절로 돌아간다
  if (shownMode(reader.sutra) !== reader.mode.id) {
    const at = p ? p.index : reader.lastIndex;
    renderReader(reader.sutra.id);
    if (at != null) $('#p-' + at)?.scrollIntoView({ block: 'start' });
  }
  if (p) reader.lastIndex = p.index;
  document.querySelectorAll('.passage.playing').forEach((el) => el.classList.remove('playing'));
  const player = $('#player');
  if (!player) return;
  $('#bowbox')?.toggleAttribute('hidden', !!p);
  if (p) {
    const el = $('#p-' + p.index);
    if (el) { el.classList.add('playing'); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    markToc(p.index);
    const sec = reader.sutra.sections[p.index];
    const name = headingKo(sec);
    const progress = p.bow ? p.bow / Math.max(1, p.bowTotal) : (p.index + 1) / p.total;
    const info = p.bow ? '' : [
      p.playlist ? `${p.playlist} ${p.pos + 1}/${p.size}` : null,
      p.repeat ? (p.repeatTotal ? `${tr('반복 {0}/{1}번', p.repeat, p.repeatTotal)}` : `${tr('반복 {0}번째', p.repeat)}`) : `${tr('{0} / {1} 구절', p.index + 1, p.total)}`,
    ].filter(Boolean).join(' · ');
    player.innerHTML = `<div class="playbar"><div class="progress"><i style="width:${progress * 100}%"></i></div><div class="inner">
      ${p.bow ? `<div class="bow-n" aria-label="${tr('{0}번째 절', p.bow)}">${p.bow}</div>
        <div class="grow" style="min-width:0" aria-live="polite"><div class="now">${esc(p.bowing ? tr('절하세요') : (p.line != null ? sec.recitation[p.line] : name || reader.sutra.title.ko))}</div>
        <div class="small muted">${tr('{0}번 가운데 · 108배 맞춰 듣기', p.bowTotal)}</div></div>`
      : `<div class="grow" style="min-width:0"><div class="now">${esc(name || reader.sutra.title.ko)}</div>
        <div class="small muted">${p.paused ? tr('일시정지 · ') : ''}${esc(info)}</div></div>`}
      <button class="btn text" id="sleep" aria-label="${tr('취침 타이머')}">${sleepLabel()}</button></div>
      <div class="inner controls">
        <button class="icon-btn" id="prev-sec" aria-label="${tr('이전 구절')}">${ICON.prev}</button>
        <button class="icon-btn main" id="toggle" aria-label="${p.paused ? tr('이어 듣기') : tr('일시정지')}">${p.paused ? ICON.play : ICON.pause}</button>
        <button class="icon-btn" id="next-sec" aria-label="${tr('다음 구절')}">${ICON.next}</button>
        <span class="grow"></span>
        <button class="btn tonal" id="stop">${tr('{0} 정지', ICON.stop)}</button></div></div>`;
    $('#stop').onclick = () => reciter.stop();
    $('#toggle').onclick = () => reciter.togglePause();
    $('#prev-sec').onclick = () => reciter.previous();
    $('#next-sec').onclick = () => reciter.next();
    $('#sleep').onclick = () => openSheet(`<h2 style="font-size:19px;margin:0 0 14px">${tr('취침 타이머')}</h2>
      <p class="small muted">${tr('정한 시간이 되면 소리를 서서히 줄이며 멈춰요.')}</p>
      <div class="chips">${SLEEP_STEPS.map(([m, n]) => `<button class="chip" data-sleep="${m}">${n}</button>`).join('')}
        ${reciter.sleepLeft() != null ? ('<button class="chip" data-sleep="off">' + tr('끄기') + '</button>') : ''}</div>`, (el) => {
      el.querySelectorAll('[data-sleep]').forEach((b) => {
        b.onclick = () => { reciter.setSleep(b.dataset.sleep === 'off' ? null : Number(b.dataset.sleep)); closeSheet(); };
      });
    });
  } else if (reciter.lastFinished === reader.sutra.id) {
    // 끝까지 들었으면 회향을 적을지 가볍게 묻는다
    player.innerHTML = `<div class="playbar"><div class="inner"><div class="grow now">${tr('끝까지 들었어요')}</div>
      <button class="btn text" id="dedicate">${tr('회향 적기')}</button><button class="btn text" id="fin-close">${tr('닫기')}</button></div></div>`;
    $('#dedicate').onclick = () => openDedication(tr('{0} 독송', reader.sutra.title.ko), today(), () => { reciter.lastFinished = null; onPlaybackChange(); });
    $('#fin-close').onclick = () => { reciter.lastFinished = null; onPlaybackChange(); };
  } else if (reciter.canPlay(reader.sutra) && reader.video == null) {
    player.innerHTML = `<button class="fab" id="play">${tr('{0} 독송 듣기', ICON.play)}</button>`;
    $('#play').onclick = () => listen(0);
  } else {
    player.innerHTML = '';
  }
}

// ───────────────────────── 아래 창 (구절 자세히, 설정) ─────────────────────────

function openSheet(html, onMount) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="scrim"></div><div class="sheet" role="dialog"><div class="grip"></div>${html}</div>`;
  $('.scrim', root).onclick = closeSheet;
  onMount?.($('.sheet', root));
}
function closeSheet() {
  const root = $('#sheet-root');
  if (root) root.innerHTML = '';
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

function openDetail(sutra, i) {
  const sec = sutra.sections[i];
  const ref = `${sutra.id}/${sec.id}`;
  const terms = sec.terms.map((t) => sutra.glossary[t]).filter(Boolean);
  // 넓은 화면의 읽기 화면에서는 아래 창 대신 오른쪽 칸에 펼친다
  const pane = DETAIL_PANE.matches ? $('#detail-pane') : null;
  if (reader) reader.cursor = i;
  const show = pane ? (html, mount) => {
    pane.innerHTML = `<div class="panel">${html}</div>`;
    pane.scrollTop = 0;
    document.querySelectorAll('.passage.selected').forEach((x) => x.classList.remove('selected'));
    $('#p-' + i)?.classList.add('selected');
    mount($('.panel', pane));
  } : openSheet;
  show(`
    <div class="muted small">${i + 1}  ${esc(sec.heading || '')}</div>
    <div class="actions">
      ${reciter.canPlay(sutra) ? ('<button class="act" id="d-listen"><span class="sym">▶</span>' + tr('여기서 듣기') + '</button>') : ''}
      <button class="act" id="d-bm">${bmLabel(ref)}</button>
      <button class="act" id="d-share"><span class="sym">↗</span>${tr('공유')}</button>
      <button class="act" id="d-trace"><span class="sym">✎</span>${tr('사경')}</button>
    </div>
    <div class="stack reader">
      <div class="hanja pre">${esc(sec.hanja)}</div>
      <div class="eumdok">${esc(sec.eumdok)}</div>
      ${isMantra(sec) ? '' : `<div class="plain">${esc(sec.plain)}</div>`}
      ${sec.meaning ? `<div>${tr('뜻: {0}', esc(sec.meaning))}</div>` : ''}
      ${sec.sanskrit ? `<div class="muted small"><i>${esc(sec.sanskrit)}</i></div>` : ''}
    </div>
    ${reciter.canPlay(sutra) ? `<div class="row" style="margin-top:16px;flex-wrap:wrap"><span class="small muted" style="flex-basis:100%">${tr('이 구절만 반복해서 듣기')}</span>
      <div class="chips choice" style="flex:1">${REPEAT_SECTION_STEPS.map((n) => `<button class="chip" data-rep="${n}" aria-label="${n ? tr('{0}번 반복', n) : tr('멈출 때까지 반복')}">${n ? tr('{0}번', n) : tr('계속')}</button>`).join('')}</div></div>` : ''}
    <div id="note-box">${prefs.isBookmarked(ref) ? noteBox(ref) : ''}</div>
    ${sec.commentary ? `<h3>${tr('해설')}</h3><div>${esc(sec.commentary)}</div>` : ''}
    ${terms.length ? `<div class="chips" style="margin-top:16px">${terms.map((t, k) => `<button class="chip" data-t="${k}">${esc(t.term)}</button>`).join('')}</div><div id="term"></div>` : ''}
  `, (el) => {
    $('#d-listen', el)?.addEventListener('click', () => { closeSheet(); listen(i); });
    $('#d-bm', el).onclick = (e) => {
      prefs.toggleBookmark(ref);
      $('#d-bm', el).innerHTML = bmLabel(ref);
      const num = $(`#p-${i} .num`);
      if (num) num.innerHTML = `${i + 1}${prefs.isBookmarked(ref) ? '<span class="star">★</span>' : ''}`;
      $('#note-box', el).innerHTML = prefs.isBookmarked(ref) ? noteBox(ref) : '';
      bindNote();
    };
    const bindNote = () => { const t = $('#note', el); if (t) t.oninput = () => prefs.setNote(ref, t.value); };
    bindNote();
    el.querySelectorAll('[data-rep]').forEach((b) => { b.onclick = () => { closeSheet(); reciter.playSection(sutra, i, Number(b.dataset.rep)); }; });
    $('#d-share', el).onclick = () => { closeSheet(); openShareVerse(sutra, i); };
    $('#d-trace', el).onclick = () => { reciter.stop(); go(`/trace/${sutra.id}/${i}`); };
    el.querySelectorAll('[data-t]').forEach((b) => {
      b.onclick = () => {
        const t = terms[Number(b.dataset.t)];
        const on = b.classList.toggle('on');
        el.querySelectorAll('[data-t]').forEach((x) => { if (x !== b) x.classList.remove('on'); });
        $('#term', el).innerHTML = on ? `<div class="term"><b>${esc(t.term)} ${esc(t.hanja)}</b>
          ${t.sanskrit ? `<div class="muted small"><i>${esc(t.sanskrit)}</i></div>` : ''}<div>${esc(t.definition)}</div></div>` : '';
      };
    });
  });
}

const bmLabel = (ref) => (prefs.isBookmarked(ref) ? ('<span class="sym">★</span>' + tr('즐겨찾기됨')) : ('<span class="sym">☆</span>' + (EN ? 'Bookmark' : '즐겨찾기'))); // i18n: skip

/** 즐겨찾기 메모 입력 칸 */
const noteBox = (ref) => `<label class="small muted" for="note" style="display:block;margin-top:14px">${tr('메모')}</label>
  <textarea id="note" class="search-box" rows="2" placeholder="${tr('이 구절에서 마음에 남은 것')}">${esc(prefs.noteOf(ref))}</textarea>`;

/** 회향 적기 */
function openDedication(hint, date, done) {
  openSheet(`<h2 style="font-size:19px;margin:0 0 8px">${tr('회향 적기')}</h2>
    <p class="small muted">${tr('이 수행의 공덕을 누구에게 돌릴지 적어 두면 수행 달력에 함께 남아요.')}</p>
    <div class="chips">${[hint].filter(Boolean).concat(DEDICATION_PRESETS).map((p) => `<button class="chip" data-ded="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    <input class="search-box" id="ded" style="margin-top:12px" placeholder="${tr('예: 어머니의 건강을 위해')}" aria-label="${tr('회향')}">
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn text" id="ded-cancel">${tr('취소')}</button><button class="btn filled" id="ded-save">${tr('남기기')}</button></div>`, (el) => {
    el.querySelectorAll('[data-ded]').forEach((b) => { b.onclick = () => { $('#ded', el).value = b.dataset.ded; }; });
    $('#ded-cancel', el).onclick = closeSheet;
    $('#ded-save', el).onclick = () => {
      const t = $('#ded', el).value.trim();
      if (!t) return;
      prefs.addDedication(t, date);
      closeSheet();
      toast(tr('회향을 남겼어요'));
      done?.();
    };
  });
}

function openSettings() {
  const chips = (list, current, key) => list.map(([v, name]) =>
    `<button class="chip ${v === current ? 'on' : ''}" data-k="${key}" data-v="${v}">${name}</button>`).join('');
  const draw = () => openSheet(`
    <h2 style="font-size:19px;margin:0 0 14px">${tr('보기·듣기 설정')}</h2>
    <section><b>${tr('글자 크기 · {0}', (FONT_STEPS.find(([v]) => v === prefs.fontScale) || [])[1] || '')}</b><div class="chips choice" style="margin-top:8px">${FONT_STEPS.map(([v, n]) => `<button class="chip ${v === prefs.fontScale ? 'on' : ''}" data-k="fontScale" data-v="${v}" aria-label="${tr('글자 {0}', n)}" style="font-size:${15 * v}px;font-family:var(--serif)">${tr('가')}</button>`).join('')}</div></section>
    <section><b>${tr('듣기 속도 · {0}', (RATE_STEPS.find(([v]) => v === prefs.rate) || [])[1] || '')}</b><div class="chips choice" style="margin-top:8px">${chips(RATE_STEPS.map(([v]) => [v, EN ? v + '×' : v + '배'] /* i18n: skip (배속) */), prefs.rate, 'rate')}</div></section>
    ${reciter.womanFiles.size ? `<section><b>${tr('독송 목소리')}</b><div class="chips choice" style="margin-top:8px">
      <button class="chip ${prefs.voice !== 'woman' ? 'on' : ''}" data-voice="monk">${tr('스님 목소리')}</button>
      <button class="chip ${prefs.voice === 'woman' ? 'on' : ''}" data-voice="woman">${tr('여성 목소리')}</button></div></section>` : ''}
    ${EN && reciter.enFiles.size ? `<section><b>Chanting language</b><div class="chips choice" style="margin-top:8px">
      <button class="chip ${!prefs.chantEnglish ? 'on' : ''}" data-chant="ko">Korean</button>
      <button class="chip ${prefs.chantEnglish ? 'on' : ''}" data-chant="en">English</button></div>
      <p class="small muted" style="margin:6px 0 0">The Heart Sutra, Thousand Hands Sutra, Amitābha Sutra and many more. Mantras, and sutras without English audio yet, stay in Korean.</p></section>` : ''}
    <section><b>${tr('진언·다라니 반복')}</b><div class="chips choice" style="margin-top:8px">${chips(REPEAT_STEPS.map((n) => [n, tr('{0}번', n)]), prefs.repeat, 'repeat')}</div></section>
    <section class="row"><span class="grow"><b>${tr('끝나면 처음부터 다시')}</b><br><span class="small muted">${tr('경전을 계속 반복해서 들어요')}</span></span>
      <input type="checkbox" id="loop" ${prefs.loop ? 'checked' : ''} style="width:24px;height:24px"></section>
    <p class="small muted">${tr('듣기 설정은 다음에 ▶를 누를 때부터 적용돼요')}</p>`, (el) => {
    el.querySelectorAll('[data-k]').forEach((b) => {
      b.onclick = () => {
        prefs[b.dataset.k] = Number(b.dataset.v);
        if (b.dataset.k === 'fontScale') document.documentElement.style.setProperty('--fs', prefs.fontScale);
        draw();
      };
    });
    $('#loop', el).onchange = (e) => { prefs.loop = e.target.checked; };
    el.querySelectorAll('[data-chant]').forEach((b) => { b.onclick = () => { prefs.chantEnglish = b.dataset.chant === 'en'; draw(); }; });
    el.querySelectorAll('[data-voice]').forEach((b) => { b.onclick = () => { prefs.voice = b.dataset.voice; draw(); }; });
  });
  draw();
}

// ───────────────────────── 검색 ─────────────────────────

function highlight(text, query) {
  const q = query.trim();
  if (!q) return esc(text);
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
}

function renderSearch(initial) {
  app().innerHTML = `<div class="page">
    <input class="search-box" id="q" type="search" placeholder="${tr('경전 검색 (한글·한자·산스크리트)')}" value="${esc(initial)}" autocomplete="off">
    <div id="results" style="margin-top:16px"></div></div>`;
  const input = $('#q');
  const run = () => {
    const q = input.value;
    history.replaceState(null, '', '#/search' + (q ? '?q=' + encodeURIComponent(q) : ''));
    const hits = search(q).slice(0, 200);
    $('#results').innerHTML = !q.trim() ? ('<p class="muted">' + tr('경전 이름, 구절, 용어를 찾아 보세요. 예: 열반, 色卽是空, nirvana') + '</p>')
      : !hits.length ? ('<p class="muted">' + tr('찾는 내용이 없어요') + '</p>')
      : hits.map((h) => `<a class="card hit" style="text-decoration:none;color:inherit" href="#/read/${h.sutra.id}${h.sec ? '?s=' + h.sec.id : ''}">
          <div class="where">${esc(h.sutra.title.ko)}${h.number ? ' ' + tr('{0}구절', h.number) : ''} · ${h.field}</div>
          <div>${highlight(h.text, q)}</div></a>`).join('');
  };
  input.oninput = run;
  run();
  if (!initial) input.focus();
}

// ───────────────────────── 수행 (염주, 달력) ─────────────────────────

let calMonth = null;
let calSelected = null;

function renderPractice() {
  const b = prefs.bead;
  const t = new Date();
  if (!calMonth) calMonth = new Date(t.getFullYear(), t.getMonth(), 1);
  if (!calSelected) calSelected = today();
  const days = prefs.practicedDays();
  const streak = prefs.streak();
  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  const lead = new Date(y, m, 1).getDay();
  const len = new Date(y, m + 1, 0).getDate();
  const isThisMonth = y === t.getFullYear() && m === t.getMonth();
  const names = Object.fromEntries(sutras.map((s) => [s.id, s.title.ko]));
  const what = prefs.practiceOn(calSelected).filter((x) => !x.startsWith('#')).map((x) => names[x]).filter(Boolean);
  const deds = prefs.dedicationsOn(calSelected);
  const jae = prefs.jaeOn(calSelected);
  const ms = prefs.monthSummary(y, m);
  const beads = prefs.beadsOn(calSelected);
  const sat = prefs.sitOn(calSelected);
  const bows = prefs.bowsOn(calSelected);
  const left = sit.left();
  const [sy, sm, sd] = calSelected.split('-').map(Number);

  app().innerHTML = `<div class="page practice"><div class="practice-grid"><div class="col">
    <h1 class="title">${tr('기도 정진')}</h1>
    ${prayersHtml()}
    <h2 class="section">${tr('염주')}</h2>
    <button class="bead" id="bead" aria-label="${tr('하나 세기')}">
      <span class="n">${b.count % b.target}</span>
      <span>/ ${b.target}${Math.floor(b.count / b.target) ? ' · ' + tr('{0}바퀴', Math.floor(b.count / b.target)) : ''}</span>
    </button>
    <p class="small muted" style="text-align:center">${tr('누를 때마다 하나씩 셉니다 · 오늘 모두 {0}번', prefs.beadsOn(today()))}</p>
    <div class="row">
      <div class="chips choice grow">${BEAD_TARGETS.map((n) => `<button class="chip ${n === b.target ? 'on' : ''}" data-target="${n}">${tr('{0}번', n)}</button>`).join('')}</div>
      <button class="btn text" id="reset">${tr('처음부터')}</button>
    </div>
    <label class="row" style="margin-top:8px"><span class="grow"><b>${tr('목탁 소리')}</b><br><span class="small muted">${tr('누를 때마다 목탁, 한 바퀴를 채우면 종이 울려요')}</span></span>
      <input type="checkbox" id="bead-sound" ${prefs.beadSound ? 'checked' : ''} style="width:24px;height:24px"></label>
    <h2 class="section">${tr('좌선')}</h2>
    <div class="card sit">${sit.running ? `
      <div id="sit-left" class="sit-left">${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</div>
      <div class="sit-track"><i id="sit-bar" style="width:${((sit.total - left) / sit.total) * 100}%"></i></div>
      <p class="small muted">${tr('고요히 앉아 숨을 지켜보세요. 끝나면 종이 울립니다. 그동안 화면은 꺼지지 않아요(지원하는 브라우저).')}</p>
      <button class="btn" id="sit-stop" style="width:100%">${tr('그만하기')}</button>` : `
      <b>${tr('앉을 시간')}</b>
      <div class="chips choice" style="margin:8px 0 14px">${SIT_STEPS.map((n) => `<button class="chip ${n === prefs.sitMinutes ? 'on' : ''}" data-sit="${n}">${tr('{0}분', n)}</button>`).join('')}</div>
      <b>${tr('중간 종')}</b>
      <div class="chips choice" style="margin:8px 0 16px">${SIT_INTERVALS.map(([n, name]) => `<button class="chip ${n === prefs.sitInterval ? 'on' : ''}" data-int="${n}">${name}</button>`).join('')}</div>
      <button class="btn filled" id="sit-start" style="width:100%;font-weight:700">${tr('좌선 시작')}</button>
      <p class="small muted">${tr('시작과 끝에 큰 종이 울립니다. 소리를 켜 두세요.')}</p>`}</div>
    </div><div class="col">
    <h2 class="section first">${tr('수행 기록')}</h2>
    <p style="color:var(--primary);font-weight:600">${streak ? `${tr('{0}일째 이어서 수행하고 있어요', streak)}` : tr('오늘 경전을 읽거나 염주를 돌리거나 좌선하면 기록돼요')}</p>
    <div class="row"><button class="btn text" id="prev">‹</button>
      <b class="grow" style="text-align:center">${tr('{0}년 {1}월', y, m + 1)}</b>
      <button class="btn text" id="next" ${isThisMonth ? 'disabled' : ''}>›</button></div>
    <div class="card summary">${ms.days ? `<div>${[`${tr('수행한 날 {0}일', ms.days)}`, ms.sutraTimes && `${tr('경전 {0}번', ms.sutraTimes)}`, ms.beads && `${tr('염주 {0}번', ms.beads.toLocaleString())}`,
      ms.sits && `${tr('좌선 {0}분', ms.sits)}`, ms.dedications && `${tr('회향 {0}번', ms.dedications)}`].filter(Boolean).join(' · ')}</div>
      ${ms.top.length ? `<div class="small muted">${tr('많이 읽은 경전: {0}', ms.top.map(([id, n]) => names[id] ? `${tr('{0} {1}일', esc(names[id]), n)}` : '').filter(Boolean).join(', '))}</div>` : ''}`
      : ('<div class="small muted">' + tr('이달에는 아직 기록이 없어요') + '</div>')}</div>
    <div class="calendar">
      ${WEEK_SHORT.map((d) => `<div class="dow" aria-hidden="true">${d}</div>`).join('')}
      ${'<div></div>'.repeat(lead)}
      ${Array.from({ length: len }, (_, k) => {
        const d = ymd(new Date(y, m, k + 1));
        const h = lunar.holy(d);
        const j = prefs.jaeOn(d);
        const label = [`${tr('{0}월 {1}일', m + 1, k + 1)}`, days.has(d) && tr('수행함'), h?.name, ...j.map((x) => `${x.m.name} ${jaeName(x.n)}`)].filter(Boolean).join(', ');
        return `<button data-day="${d}" aria-label="${esc(label)}" aria-pressed="${d === calSelected}" class="${days.has(d) ? 'done' : ''} ${d === calSelected ? 'sel' : ''} ${d === today() ? 'today' : ''} ${h ? (h.major ? 'holy major' : 'holy') : ''} ${j.length ? 'jae' : ''}"><span class="d">${k + 1}</span>${[...new Set(j.map((x) => jaeShort(x.n)))].slice(0, 1).map((t) => `<span class="lb jae" aria-hidden="true">${t}</span>`).join('')}${h ? `<span class="lb ${h.major ? 'major' : ''}" aria-hidden="true">${HOLY_SHORT[h.ko] || h.name}</span>` : ''}</button>`;
      }).join('')}
    </div>
    <div class="card" style="margin-top:12px"><b>${tr('{0}월 {1}일', sm, sd)}</b>
      ${(() => { const l = lunar.of(calSelected); const h = lunar.holy(calSelected); return l ? `<div class="small" style="color:${h ? 'var(--primary)' : 'var(--muted)'}">${l.label}${h ? ' · ' + h.name : ''}</div>` : ''; })()}
      ${jae.map((x) => `<div class="small jae-text">${esc(x.m.name)} ${jaeName(x.n)}</div>`).join('')}
      ${!what.length && !beads && !sat && !deds.length ? ('<div class="small muted">' + tr('기록이 없어요') + '</div>') : ''}
      ${what.length ? `<div>${tr('읽은 경전: {0}', esc(what.join(', ')))}</div>` : ''}
      ${beads ? `<div>${tr('염주: {0}번', beads)}</div>` : ''}
      ${sat ? `<div>${tr('좌선: {0}분', sat)}</div>` : ''}
      ${bows ? `<div>${tr('절: {0}배', bows)}</div>` : ''}
      ${deds.map((d) => `<div class="row"><span class="grow">${tr('회향: {0}', esc(d.text))}</span><button class="btn text" data-unded="${d.at}">${tr('지우기')}</button></div>`).join('')}
      ${calSelected <= today() ? ('<button class="btn text" id="add-ded" style="padding-left:0">' + tr('+ 이날 회향 적기') + '</button>') : ''}</div>
    <p class="small muted">${tr('경전을 1분 넘게 읽거나, 끝까지 듣거나, 사경·염주·좌선·회향을 하면 기록돼요. 기록은 이 브라우저에만 저장됩니다.')}</p>
    <h2 class="section">${tr('49재 일정')}</h2>
    ${memorialsHtml()}
    <h2 class="section">${tr('발원·축원')}</h2>
    ${vowHtml()}
    ${savedVerses()}
  </div></div></div>`;
  void sy;

  bindDevotion();
  $('#bead').onclick = () => {
    const nb = prefs.addBead();
    const full = nb.count % nb.target === 0;
    if (prefs.beadSound) sounds.play(full ? 'bell_small' : 'mokdak');
    if (navigator.vibrate) navigator.vibrate(full ? 300 : 15);
    renderPracticeKeepScroll();
  };
  $('#reset').onclick = () => { prefs.bead = { ...prefs.bead, count: 0 }; renderPracticeKeepScroll(); };
  app().querySelectorAll('[data-target]').forEach((c) => {
    c.onclick = () => { prefs.bead = { ...prefs.bead, target: Number(c.dataset.target) }; renderPracticeKeepScroll(); };
  });
  $('#bead-sound').onchange = (e) => { prefs.beadSound = e.target.checked; };
  $('#sit-start')?.addEventListener('click', () => { sit.start(prefs.sitMinutes, prefs.sitInterval); renderPracticeKeepScroll(); });
  $('#sit-stop')?.addEventListener('click', () => { sit.stop(); renderPracticeKeepScroll(); });
  app().querySelectorAll('[data-sit]').forEach((c) => { c.onclick = () => { prefs.sitMinutes = Number(c.dataset.sit); renderPracticeKeepScroll(); }; });
  app().querySelectorAll('[data-int]').forEach((c) => { c.onclick = () => { prefs.sitInterval = Number(c.dataset.int); renderPracticeKeepScroll(); }; });
  $('#prev').onclick = () => { calMonth = new Date(y, m - 1, 1); renderPracticeKeepScroll(); };
  $('#next').onclick = () => { calMonth = new Date(y, m + 1, 1); renderPracticeKeepScroll(); };
  app().querySelectorAll('[data-day]').forEach((c) => { c.onclick = () => { calSelected = c.dataset.day; renderPracticeKeepScroll(); }; });
  app().querySelectorAll('[data-unded]').forEach((c) => { c.onclick = () => { prefs.removeDedication(Number(c.dataset.unded)); renderPracticeKeepScroll(); }; });
  $('#add-ded')?.addEventListener('click', () => openDedication(jae[0] ? `${jae[0].m.name} ${jaeName(jae[0].n)}` : '', calSelected, renderPracticeKeepScroll));
  app().querySelectorAll('[data-unmem]').forEach((c) => {
    c.onclick = () => { if (confirm(tr('이 49재 일정을 지울까요?'))) { prefs.removeMemorial(c.dataset.unmem); renderPracticeKeepScroll(); } };
  });
  $('#mem-add').onclick = () => openSheet(`<h2 style="font-size:19px;margin:0 0 14px">${tr('49재 일정 넣기')}</h2>
    <input class="search-box" id="mem-name" placeholder="${tr('영가 이름 (예: 홍길동 영가)')}" aria-label="${tr('영가 이름')}">
    <label class="small muted" for="mem-date" style="display:block;margin-top:12px">${tr('돌아가신 날')}</label>
    <input class="search-box" type="date" id="mem-date" value="${today()}">
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn text" id="mem-cancel">${tr('취소')}</button><button class="btn filled" id="mem-save">${tr('넣기')}</button></div>`, (el) => {
    $('#mem-cancel', el).onclick = closeSheet;
    $('#mem-save', el).onclick = () => {
      const n = $('#mem-name', el).value.trim();
      const d = $('#mem-date', el).value;
      if (!n || !d) return toast(tr('이름과 날짜를 넣어 주세요'));
      prefs.addMemorial(n, d);
      closeSheet();
      renderPracticeKeepScroll();
    };
  });
}

// 49재 일정 (돌아가신 날을 첫날로 쳐서 7일째 초재, 49일째 49재)
function memorialsHtml() {
  const t = today();
  return `<div class="card">${prefs.memorials.length ? '' : ('<p class="small muted" style="margin-top:0">' + tr('돌아가신 분의 이름(법명)과 돌아가신 날을 넣으면, 이레마다 올리는 일곱 번의 재 날짜를 계산해 드려요.') + '</p>')}
    ${prefs.memorials.map((mm) => {
      const next = [1, 2, 3, 4, 5, 6, 7].find((n) => jaeDate(mm, n) >= t);
      const [, dm, dd] = mm.date.split('-').map(Number);
      let nextHtml = ('<div class="muted">' + tr('49재를 모두 마쳤어요') + '</div>');
      if (next) {
        const d = jaeDate(mm, next);
        const [, nm, nd] = d.split('-').map(Number);
        const left = daysBetween(t, d);
        nextHtml = `<div class="jae-text"><b>${tr('{0} {1}월 {2}일 {3}', jaeName(next), nm, nd, left ? `${tr('({0}일 뒤)', left)}` : tr('(오늘)'))}</b></div>`;
      }
      return `<div class="memorial"><div class="row"><span class="grow"><b>${esc(mm.name)}</b><br><span class="small muted">${tr('{0}월 {1}일에 돌아가심', dm, dd)}</span></span>
        <button class="btn text" data-unmem="${esc(mm.id)}">${tr('지우기')}</button></div>${nextHtml}
        <div class="small muted">${[1, 2, 3, 4, 5, 6, 7].map((n) => { const [, a, b] = jaeDate(mm, n).split('-').map(Number); return `${tr('{0}재 {1}/{2}', n, a, b)}`; }).join('  ')}</div></div>`;
    }).join('')}
    <button class="btn text" id="mem-add" style="padding-left:0">${tr('+ 49재 일정 넣기')}</button>
    <p class="small muted">${tr('재 날 알림은 안드로이드 앱에서 받을 수 있어요. 절이나 지역에 따라 다르게 셀 수 있어요.')}</p></div>`;
}
// 즐겨찾기한 구절 (수행 탭 아래)
function savedVerses() {
  const saved = [];
  for (const s of sutras) s.sections.forEach((sec, i) => { if (prefs.isBookmarked(`${s.id}/${sec.id}`)) saved.push({ s, sec, i }); });
  if (!saved.length) return '';
  return `<h2 class="section">${tr('즐겨찾기')}</h2>` + saved.map(({ s, sec, i }) =>
    `<a class="card" href="#/read/${s.id}?s=${sec.id}" style="text-decoration:none;color:inherit">
      <div style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(isMantra(sec) ? sec.eumdok : sec.plain)}</div>
      <div class="small muted">${tr('{0} {1}구절{2}', esc(s.title.ko), i + 1, headingKo(sec) ? ' · ' + esc(headingKo(sec)) : '')}</div>
      ${prefs.noteOf(`${s.id}/${sec.id}`) ? `<div class="small" style="color:var(--primary)">${tr('메모: {0}', esc(prefs.noteOf(`${s.id}/${sec.id}`)))}</div>` : ''}</a>`).join('');
}

// 기도 정진 카드
function prayersHtml() {
  const t = today();
  const names = Object.fromEntries(sutras.map((x) => [x.id, x.title.short || x.title.ko]));
  const active = prefs.prayers.filter((p) => !p.finishedOn);
  const done = prefs.prayers.filter((p) => p.finishedOn);
  return `<div class="card">${active.length ? '' : ('<p class="small muted" style="margin-top:0">' + tr('21일·100일 기도처럼 날수를 정해 두고 날마다 기도해 보세요. 정한 경전을 읽거나 들으면 그날 기도한 것으로 세어 드려요.') + '</p>')}
    ${active.map((p) => {
      const pr = prefs.prayerProgress(p, t);
      const ended = t > pr.end;
      const [, em, ed] = pr.end.split('-').map(Number);
      return `<div class="memorial"><div class="row"><span class="grow"><b class="serif" style="font-size:18px">${esc(p.title)}</b><br>
        <span class="small muted">${tr('{0} · {1}일 기도', esc(p.sutra ? names[p.sutra] || '' : tr('무엇이든 수행')), p.days)}</span></span>
        <b style="color:var(--primary);font-size:22px">${pr.day < 1 ? tr('시작 전') : ended ? tr('회향할 때') : tr('{0}일째', pr.day)}</b></div>
        <div class="sit-track" style="margin:8px 0 6px"><i style="width:${Math.min(100, (pr.done / p.days) * 100)}%"></i></div>
        <div class="small muted">${tr('기도한 날 {0} / {1}{2} · {3}월 {4}일까지', pr.done, p.days, pr.missed ? ` ${tr('· 빠진 날 {0}', pr.missed)}` : '', em, ed)}</div>
        ${p.wish ? `<div class="small muted">${tr('발원: {0}', esc(p.wish))}</div>` : ''}
        <div class="row" style="margin-top:6px">${ended ? `<button class="btn filled" data-pfinish="${esc(p.id)}">${tr('기도를 마치고 회향하기')}</button>`
          : pr.day < 1 ? '' : pr.todayDone ? ('<b class="jae-text">' + tr('오늘 기도를 마쳤어요 ✓') + '</b>')
          : p.sutra ? `<a class="btn filled" style="text-decoration:none" href="#/read/${esc(p.sutra)}">${tr('오늘 기도하기')}</a>` : ('<span class="small muted">' + tr('오늘 경전을 읽거나 염주·좌선을 하면 기록돼요') + '</span>')}
          <span class="grow"></span><button class="btn text" data-pstop="${esc(p.id)}">${tr('그만두기')}</button></div></div>`;
    }).join('')}
    <button class="btn text" id="p-add" style="padding-left:0">${tr('+ 기도 시작하기')}</button>
    ${done.length ? `<div class="small muted" style="margin-top:8px">${tr('마친 기도: {0}', done.map((p) => `${tr('{0} {1}일 ({2} 회향)', esc(p.title), p.days, p.finishedOn)}`).join(', '))}</div>` : ''}</div>`;
}
// 나의 발원문과 축원 카드
function vowHtml() {
  return `<div class="card"><b>${tr('나의 발원문')}</b>
    <textarea class="search-box" id="vow" rows="3" style="margin-top:8px" placeholder="${tr('예: 오늘 읽은 경전의 공덕으로 우리 가족이 건강하고 모든 이웃이 평안하기를 발원합니다.')}">${esc(prefs.myVow)}</textarea>
    <b style="display:block;margin-top:14px">${tr('축원')}</b>
    ${prefs.blessings.length ? '' : ('<p class="small muted">' + tr('축원할 분의 이름과 바라는 것을 넣어 두면, 경전을 다 읽은 뒤 함께 읽을 수 있어요.') + '</p>')}
    ${prefs.blessings.map((b) => `<div class="row"><span class="grow">${esc(b.name)}${b.wish ? ' · ' + esc(b.wish) : ''}</span><button class="btn text" data-unbless="${esc(b.id)}">${tr('지우기')}</button></div>`).join('')}
    <div class="row" style="margin-top:8px"><input class="search-box" id="b-name" placeholder="${tr('이름')}" style="padding:10px 12px;font-size:15px">
      <input class="search-box" id="b-wish" placeholder="${tr('예: 건강')}" style="padding:10px 12px;font-size:15px"></div>
    <button class="btn text" id="b-add" style="padding-left:0">${tr('+ 축원 넣기')}</button>
    <p class="small muted">${tr('발원문과 축원은 이 브라우저에만 저장돼요.')}</p></div>`;
}
// 경전 끝에서 함께 읽는 발원문과 축원
function vowReadingHtml() {
  if (!prefs.myVow.trim() && !prefs.blessings.length) return '';
  return `<div class="notice serif" style="margin:8px 0 24px;line-height:1.9">
    ${prefs.myVow.trim() ? `<div class="small" style="opacity:.8">${tr('나의 발원')}</div><div class="pre">${esc(prefs.myVow)}</div>` : ''}
    ${prefs.blessings.length ? `<div class="small" style="opacity:.8;margin-top:10px">${tr('축원')}</div>${prefs.blessings.map((b) => `<div>${esc(b.name)}${b.wish ? `${tr(', {0} 축원합니다.', esc(EN ? b.wish : eulReul(b.wish)))}` : tr(' 님을 위해 축원합니다.')}</div>`).join('')}` : ''}</div>`;
}
function bindDevotion() {
  $('#p-add')?.addEventListener('click', () => {
    let days = 100, sutra = '';
    const draw = () => openSheet(`<h2 style="font-size:19px;margin:0 0 14px">${tr('기도 시작하기')}</h2>
      <input class="search-box" id="pt" placeholder="${tr('기도 이름 (예: 가족 건강 기도)')}">
      <p class="small muted">${tr('날수')}</p><div class="chips">${[7, 21, 49, 100, 1000].map((n) => `<button class="chip ${n === days ? 'on' : ''}" data-days="${n}">${tr('{0}일', n)}</button>`).join('')}</div>
      <p class="small muted">${tr('시작하는 날')}</p><input class="search-box" id="ps" type="date" value="${today()}">
      <p class="small muted">${tr('날마다 읽을 경전')}</p><select class="search-box" id="pu"><option value="">${tr('무엇이든 (경전·염주·좌선 가운데 하나)')}</option>
        ${sutras.map((x) => `<option value="${x.id}" ${x.id === sutra ? 'selected' : ''}>${esc(x.title.ko)}</option>`).join('')}</select>
      <input class="search-box" id="pw" placeholder="${tr('발원 (선택, 예: 어머니의 수술이 잘 되기를)')}" style="margin-top:10px">
      <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn text" id="pc">${tr('취소')}</button><button class="btn filled" id="pok">${tr('시작')}</button></div>`, (el) => {
      el.querySelectorAll('[data-days]').forEach((b) => { b.onclick = () => { days = Number(b.dataset.days); const t = $('#pt', el).value; sutra = $('#pu', el).value; draw(); $('#pt').value = t; }; });
      $('#pc', el).onclick = closeSheet;
      $('#pok', el).onclick = () => {
        const title = $('#pt', el).value;
        if (!title.trim()) return toast(tr('기도 이름을 적어 주세요'));
        prefs.addPrayer(title, days, $('#ps', el).value || today(), $('#pu', el).value, $('#pw', el).value);
        closeSheet();
        renderPracticeKeepScroll();
      };
    });
    draw();
  });
  app().querySelectorAll('[data-pstop]').forEach((b) => { b.onclick = () => { if (confirm(tr('이 기도를 목록에서 지울까요? 수행 기록은 달력에 그대로 남아요.'))) { prefs.removePrayer(b.dataset.pstop); renderPracticeKeepScroll(); } }; });
  app().querySelectorAll('[data-pfinish]').forEach((b) => {
    b.onclick = () => {
      const p = prefs.prayers.find((x) => x.id === b.dataset.pfinish);
      openDedication(`${tr('{0} {1}일 기도 회향', p.title, p.days)}`, today(), () => { prefs.finishPrayer(p.id); renderPracticeKeepScroll(); });
    };
  });
  const vow = $('#vow');
  if (vow) vow.oninput = () => { prefs.myVow = vow.value; };
  $('#b-add')?.addEventListener('click', () => { prefs.addBlessing($('#b-name').value, $('#b-wish').value); renderPracticeKeepScroll(); });
  app().querySelectorAll('[data-unbless]').forEach((b) => { b.onclick = () => { prefs.removeBlessing(b.dataset.unbless); renderPracticeKeepScroll(); }; });
}
function renderPracticeKeepScroll() {
  const y = window.scrollY;
  renderPractice();
  window.scrollTo(0, y);
}

// ───────────────────────── 사경 ─────────────────────────

function renderTracing(id, index) {
  const sutra = sutraById(id);
  if (!sutra) return go('/');
  const i = Math.min(Math.max(index, 0), sutra.sections.length - 1);
  const sec = sutra.sections[i];
  const hanja = store.get('traceHanja', false);
  const text = hanja ? sec.hanja : isMantra(sec) ? sec.eumdok : sec.plainKo; // 사경은 영어판에서도 한국어 풀이로
  let finished = false;
  // 원고지: 칸 수와 줄 수는 쓰는 영역 크기로 정하고, 구절이 길면 여러 쪽으로 나눈다.
  let grid = { cols: 0, rows: 1, cell: 0, pages: [[]] };
  let page = 0;

  app().innerHTML = `
    <div class="topbar"><button class="btn text" id="close">${tr('← 닫기')}</button>
      <h1 style="font-size:20px">${tr('사경 · {0} {1}/{2}', esc(sutra.title.ko), i + 1, sutra.sections.length)}</h1>
      <span class="small muted" id="traced-n" style="white-space:nowrap">${tr('다 쓴 구절 {0}/{1}', prefs.tracedCount(sutra), sutra.sections.length)}</span></div>
    <div class="page" style="padding-top:0;padding-bottom:90px">
      <div class="trace-head">
        <div class="segment"><button data-h="0" class="${hanja ? '' : 'on'}">${tr('한글')}</button><button data-h="1" class="${hanja ? 'on' : ''}">${tr('한자')}</button></div>
        <span class="trace-page muted" id="pageno"></span>
      </div>
      <div class="trace-wrap"><canvas class="trace-bg"></canvas><canvas class="trace-ink"></canvas></div>
    </div>
    <div class="playbar"><div class="inner">
      <button class="btn" id="clear">${EN ? 'Clear' : '지우기'}</button> <!-- i18n: skip -->
      <button class="btn" id="prev">${tr('이전')}</button>
      <button class="btn filled grow" id="done">${tr('다 썼어요')}</button></div></div>`;

  const bg = $('.trace-bg');
  const canvas = $('.trace-ink');
  const bgx = bg.getContext('2d');
  const ctx = canvas.getContext('2d');
  const strokes = [];
  let current = null;
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--primary').trim();
  const textColor = css.getPropertyValue('--text').trim();
  const serif = css.getPropertyValue('--serif').trim();
  const PAD = 8;
  const MIN_CELL = WIDE.matches ? 72 : 60; // 마우스·펜으로 쓰는 넓은 화면은 칸을 더 크게

  const updateButtons = () => {
    const last = page >= grid.pages.length - 1;
    $('#pageno').textContent = grid.pages.length > 1 ? `${tr('{0}/{1}쪽', page + 1, grid.pages.length)}` : '';
    $('#prev').disabled = i === 0 && page === 0;
    const done = $('#done');
    if (!last) { done.textContent = tr('다음 쪽'); done.disabled = false; }
    else if (!finished) { done.textContent = tr('다 썼어요'); done.disabled = false; }
    else { const end = i >= sutra.sections.length - 1; done.textContent = end ? tr('마지막 구절') : tr('다음 구절'); done.disabled = end; }
  };
  const drawBg = () => {
    const { cols, rows, cell, pages } = grid;
    bgx.clearRect(0, 0, bg.width, bg.height);
    if (!cols) return;
    const w = bg.clientWidth - PAD * 2, h = bg.clientHeight - PAD * 2;
    const left = PAD + (w - cols * cell) / 2, top = PAD + (h - rows * cell) / 2;
    bgx.globalAlpha = 0.08;
    bgx.strokeStyle = textColor;
    bgx.lineWidth = 1;
    bgx.beginPath();
    for (let r = 0; r <= rows; r++) { bgx.moveTo(left, top + r * cell); bgx.lineTo(left + cols * cell, top + r * cell); }
    for (let c = 0; c <= cols; c++) { bgx.moveTo(left + c * cell, top); bgx.lineTo(left + c * cell, top + rows * cell); }
    bgx.stroke();
    bgx.globalAlpha = 0.22;
    bgx.fillStyle = textColor;
    bgx.font = `${cell * 0.7}px ${serif}`;
    bgx.textAlign = 'center';
    bgx.textBaseline = 'middle';
    (pages[page] || []).forEach((row, r) => {
      [...row].forEach((ch, c) => { if (ch !== ' ') bgx.fillText(ch, left + c * cell + cell / 2, top + r * cell + cell / 2); });
    });
    bgx.globalAlpha = 1;
  };
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(3, grid.cell * 0.07);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of current ? strokes.concat([current]) : strokes) {
      if (s.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(s[0][0], s[0][1]);
      for (const [x, y] of s.slice(1)) ctx.lineTo(x, y);
      ctx.stroke();
    }
  };
  const showPage = (p) => { page = p; strokes.length = 0; current = null; drawBg(); draw(); updateButtons(); };
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    for (const [cv, cx] of [[bg, bgx], [canvas, ctx]]) {
      cv.width = r.width * dpr;
      cv.height = r.height * dpr;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const w = r.width - PAD * 2, h = r.height - PAD * 2;
    const cols = Math.min(14, Math.max(4, Math.floor(w / MIN_CELL)));
    const cell = w / cols;
    const rows = Math.max(1, Math.floor(h / cell));
    const lines = manuscriptRows(text, cols, !hanja);
    const pages = [];
    for (let k = 0; k < lines.length; k += rows) pages.push(lines.slice(k, k + rows));
    const changed = cols !== grid.cols || rows !== grid.rows;
    grid = { cols, rows, cell, pages: pages.length ? pages : [[]] };
    if (changed) strokes.length = 0;
    page = Math.min(page, grid.pages.length - 1);
    drawBg();
    draw();
    updateButtons();
  };

  $('#close').onclick = () => go(`/read/${id}?s=${sec.id}`);
  app().querySelectorAll('[data-h]').forEach((b) => { b.onclick = () => { store.set('traceHanja', b.dataset.h === '1'); renderTracing(id, i); }; });
  $('#prev').onclick = () => { if (page > 0) showPage(page - 1); else go(`/trace/${id}/${i - 1}`); };
  $('#done').onclick = () => {
    if (page < grid.pages.length - 1) return showPage(page + 1);
    if (!finished) {
      finished = true;
      prefs.markPractice(sutra.id);
      prefs.markTraced(sutra.id, sec.id);
      $('#traced-n').textContent = `${tr('다 쓴 구절 {0}/{1}', prefs.tracedCount(sutra), sutra.sections.length)}`;
      toast(tr('오늘의 수행 기록에 남겼어요'));
      updateButtons();
    } else {
      go(`/trace/${id}/${i + 1}`);
    }
  };

  // 손가락·펜·마우스로 따라 쓰기
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.onpointerdown = (e) => { canvas.setPointerCapture(e.pointerId); current = [pos(e)]; };
  canvas.onpointermove = (e) => { if (current) { current.push(pos(e)); draw(); } };
  canvas.onpointerup = canvas.onpointercancel = () => { if (current) strokes.push(current); current = null; draw(); };
  $('#clear').onclick = () => { strokes.length = 0; draw(); };
  window.addEventListener('resize', resize);
  cleanup.push(() => window.removeEventListener('resize', resize));
  requestAnimationFrame(resize);
  // 글꼴이 늦게 내려오면 바탕 글자를 다시 그린다.
  document.fonts?.ready.then(() => { if (canvas.isConnected) drawBg(); });
}

/**
 * 글을 원고지 줄로 나눈다. 한 칸에 한 글자.
 * 한글은 띄어쓰기도 한 칸으로 두고 낱말을 줄 끝에서 자르지 않는다.
 * 한문(words가 false)은 옛 사경처럼 띄어쓰기 없이 칸을 채워 이어 쓴다.
 */
function manuscriptRows(text, cols, words = true) {
  const rows = [];
  if (!words) {
    const chars = [...text.replace(/\s+/g, '')];
    for (let k = 0; k < chars.length; k += cols) rows.push(chars.slice(k, k + cols).join(''));
    return rows;
  }
  for (const line of text.split('\n')) {
    let row = [];
    for (const word of line.split(/[ 　]+/).filter(Boolean)) {
      let w = [...word];
      const need = row.length ? row.length + 1 + w.length : w.length;
      if (need <= cols) { if (row.length) row.push(' '); row.push(...w); continue; }
      if (row.length) { rows.push(row.join('')); row = []; }
      while (w.length > cols) { rows.push(w.slice(0, cols).join('')); w = w.slice(cols); }
      row.push(...w);
    }
    if (row.length) rows.push(row.join(''));
  }
  return rows;
}

// ───────────────────────── 정보 ─────────────────────────

// ───────────────────────── 음력과 불교 재일 (lunar-months.json, scripts/make-lunar.mjs) ─────────────────────────

const lunar = {
  starts: [], // [양력 'YYYY-MM-DD', 음력 월, 윤달]
  MAJOR: { '2-8': '출가재일', '2-15': '열반재일', '4-8': '부처님오신날', '7-15': '백중 (우란분절)', '12-8': '성도재일' }, // i18n: skip (이름은 보여 줄 때 tr)
  MONTHLY: { 1: '초하루', 8: '약사재일', 15: '보름', 18: '지장재일', 24: '관음재일' }, // i18n: skip
  async load() {
    try { this.starts = (await (await fetch('lunar-months.json')).json()).months; } catch { this.starts = []; }
  },
  // 'YYYY-MM-DD' → { month, day, leap, label } (표 밖이면 null)
  of(date) {
    let lo = 0, hi = this.starts.length - 1;
    if (hi < 0 || date < this.starts[0][0]) return null;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.starts[mid][0] <= date) lo = mid; else hi = mid - 1; }
    const [start, month, leap] = this.starts[lo];
    const day = Math.round((Date.parse(date) - Date.parse(start)) / 86400000) + 1;
    if (day > 30 || (lo === this.starts.length - 1 && day > 29)) return null;
    return { month, day, leap, label: `${tr('음력 {0}{1}월 {2}일', leap ? tr('윤') : '', month, day)}` };
  },
  holy(date) {
    const l = this.of(date);
    if (!l) return null;
    if (!l.leap && this.MAJOR[`${l.month}-${l.day}`]) { const ko = this.MAJOR[`${l.month}-${l.day}`]; return { ko, name: tr(ko), major: true }; }
    return this.MONTHLY[l.day] ? { ko: this.MONTHLY[l.day], name: tr(this.MONTHLY[l.day]), major: false } : null;
  },
  next(from, days = 14) {
    const d = new Date(from + 'T00:00:00');
    for (let i = 0; i <= days; i++) {
      const key = ymd(d);
      const h = this.holy(key);
      if (h) return { date: key, days: i, ...h };
      d.setDate(d.getDate() + 1);
    }
    return null;
  },
};

// ───────────────────────── 기록 백업 (안드로이드 앱과 같은 형식) ─────────────────────────

const backup = {
  export() {
    const b = prefs.bead;
    return {
      app: '경전함', format: 1, exportedAt: new Date().toISOString(), // i18n: skip (백업 파일 표시, 바꾸면 안 됨)
      bookmarks: store.get('bookmarks', []).slice().sort(),
      positions: store.get('positions', {}),
      ...(store.get('lastSutra') ? { lastSutra: store.get('lastSutra') } : {}),
      practiceLog: prefs.log.slice().sort(),
      beads: store.get('beads', {}),
      sits: store.get('sits', {}),
      beadCount: b.count, beadTarget: b.target,
      playlists: prefs.playlists, notes: prefs.notes, dedications: prefs.dedications, memorials: store.get('memorials', []),
      prayers: prefs.prayers, myVow: prefs.myVow, blessings: prefs.blessings, traced: prefs.traced, bows: store.get('bows', {}),
      reciteAlarms: store.get('reciteAlarms', []), // 앱의 독송 알람 (웹은 보관만 해서 앱으로 되돌려 준다)
      settings: {
        fontScale: prefs.fontScale, viewMode: prefs.viewMode, listenSpeed: prefs.rate, mantraRepeat: prefs.repeat,
        loop: prefs.loop, beadSound: prefs.beadSound, sitMinutes: prefs.sitMinutes, sitInterval: prefs.sitInterval,
      },
    };
  },
  download() {
    const blob = new Blob([JSON.stringify(this.export(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${tr('경전함-기록-{0}.json', today())}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  // 지금 기록에 합친다: 수행 기록·즐겨찾기는 합치고, 날짜별 수는 큰 쪽, 설정·위치는 파일 쪽
  merge(j) {
    if (!j || j.app !== '경전함' || !('format' in j)) /* i18n: skip */ throw new Error(notBackup());
    const union = (a, b) => [...new Set([...(a || []), ...(b || [])])];
    store.set('log', union(prefs.log, j.practiceLog));
    store.set('bookmarks', union(store.get('bookmarks', []), j.bookmarks));
    store.set('positions', { ...store.get('positions', {}), ...(j.positions || {}) });
    if (j.lastSutra) store.set('lastSutra', j.lastSutra);
    for (const key of ['beads', 'sits', 'bows']) {
      const cur = store.get(key, {});
      for (const [d, n] of Object.entries(j[key] || {})) cur[d] = Math.max(cur[d] || 0, n);
      store.set(key, cur);
    }
    if ('beadCount' in j) prefs.bead = { count: j.beadCount, target: j.beadTarget || prefs.bead.target };
    const st = j.settings || {};
    if ('fontScale' in st) store.set('fontScale', st.fontScale);
    if (st.viewMode) store.set('viewMode', st.viewMode);
    if ('listenSpeed' in st) store.set('listenSpeed', st.listenSpeed);
    if ('mantraRepeat' in st) store.set('repeat', st.mantraRepeat);
    for (const k of ['loop', 'beadSound', 'sitMinutes', 'sitInterval']) if (k in st) store.set(k, st[k]);
    // 묶음·메모·회향·49재는 합친다 (같은 것은 하나로)
    const byId = (cur, add) => cur.concat((add || []).filter((x) => !cur.some((c) => c.id === x.id)));
    store.set('playlists', byId(prefs.playlists, j.playlists));
    store.set('memorials', byId(store.get('memorials', []), j.memorials));
    store.set('prayers', byId(prefs.prayers, j.prayers));
    store.set('blessings', byId(prefs.blessings, j.blessings));
    store.set('reciteAlarms', byId(store.get('reciteAlarms', []), j.reciteAlarms));
    if (!prefs.myVow && j.myVow) prefs.myVow = j.myVow;
    store.set('traced', union(prefs.traced, j.traced));
    store.set('notes', { ...prefs.notes, ...(j.notes || {}) });
    const ded = prefs.dedications;
    (j.dedications || []).forEach((d) => { if (!ded.some((x) => x.date === d.date && x.text === d.text)) ded.push({ ...d, at: d.at || Date.now() + ded.length }); });
    store.set('dedications', ded);
    return (j.practiceLog || []).length;
  },
  pick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      if (!confirm(tr('파일의 기록을 지금 기록에 합칩니다. 지금 기록은 지워지지 않고, 설정과 읽던 위치는 파일 쪽을 따릅니다.'))) return;
      try { toast(`${tr('불러왔어요 (수행 기록 {0}개)', this.merge(JSON.parse(await file.text())))}`); render(); } catch (e) { toast(e.message || tr('불러오지 못했어요')); }
    };
    input.click();
  },
};

/** 판매자 정보 (seller.json: 앱 assets/seller.json과 같은 파일). 상호·사업자등록번호가 비어 있으면 보이지 않는다. */
async function showSeller() {
  let v;
  try { v = await (await fetch('seller.json')).json(); } catch { return; }
  if (!v?.name?.trim() || !v?.bizNo?.trim()) return;
  const rows = [[tr('상호'), v.name], [tr('대표자'), v.ceo], [tr('주소'), v.address], [tr('사업자등록번호'), v.bizNo],
    [tr('통신판매업 신고번호'), v.mailOrderNo], [tr('전화'), v.phone], [tr('이메일'), v.email]].filter(([, x]) => x?.trim());
  const el = document.getElementById('seller');
  if (el) el.innerHTML = `<div class="card" style="margin-top:12px"><b>${tr('판매자 정보')}</b>${rows.map(([k, x]) => `<div class="small">${tr('{0}: {1}', k, esc(x))}</div>`).join('')}</div>`;
}

/**
 * 함께 쓰면 좋은 앱: 같은 개발자의 형제 앱 목록(/related-apps.json, 포트폴리오 저장소가 관리)에서
 * 경전함과 같은 묶음의 앱을 보여 준다. 받지 못하면 함께 배포한 사본(related-apps.json)을 쓴다.
 * 소개 글이 한국어뿐이라 한국어 화면에서만 보인다. 링크: 웹이 있으면 웹, 없으면 공개 앱의 Play 스토어.
 */
async function showRelated() {
  if (EN) return;
  let j = null;
  for (const url of ['/related-apps.json', 'related-apps.json']) {
    try { j = await (await fetch(url)).json(); break; } catch { /* 다음 주소 */ }
  }
  if (!j?.groups || !j?.apps) return;
  const ids = [...new Set(j.groups.filter((g) => g.apps.includes('sutra')).flatMap((g) => g.apps).filter((id) => id !== 'sutra'))];
  const items = ids.map((id) => ({ id, ...j.apps[id] })).map((a) => ({ ...a,
    href: a.web || (a.public && a.package ? `https://play.google.com/store/apps/details?id=${a.package}` : null) }))
    .filter((a) => a.name && a.href);
  const el = document.getElementById('related');
  if (!el || !items.length) return;
  el.innerHTML = `<div class="card related" style="margin-top:12px"><b>${tr('함께 쓰면 좋은 앱')}</b>${items.map((a) =>
    `<a class="related-app" href="${esc(a.href)}" target="_blank" rel="noopener">${a.icon ? `<img src="${esc(a.icon)}" alt="" width="40" height="40" loading="lazy">` : ''}
      <span><span class="name">${esc(a.name)}</span><span class="small muted">${esc(a.tagline || '')}</span></span></a>`).join('')}</div>`;
}

function renderAbout() {
  // 감수 체크리스트는 주소에 ?review 가 있을 때만 보인다 (일반 사용자에게는 감추기)
  const showReview = new URLSearchParams(location.search).has('review');
  const langBtn = (v, label) => `<button class="chip ${LANG_CHOSEN === v ? 'on' : ''}" data-lang="${v ?? ''}">${label}</button>`;
  app().innerHTML = `<div class="page">
    <h1 class="title">${EN ? tr('Language · 언어') : tr('언어 · Language')}</h1>
    <div class="card"><div class="chips choice">${langBtn(null, tr('기기 언어'))}${langBtn('ko', tr('한국어'))}${langBtn('en', 'English')}</div>
      <p class="small muted" style="margin-bottom:0">${tr('English를 고르면 경전 풀이와 해설도 영어로 나와요. 몇몇 경전은 영어 독송도 들을 수 있어요 (보기·듣기 설정).')}</p></div>
    <h1 class="title" style="margin-top:28px">${tr('기록 백업')}</h1>
    <div class="card"><p class="small muted" style="margin-top:0">${tr('수행 기록·즐겨찾기·염주·좌선 기록과 설정은 이 브라우저 안에만 저장돼요. 브라우저 데이터를 지우기 전이나 다른 기기로 옮길 때 파일로 백업해 두세요. 안드로이드 앱과 서로 옮길 수도 있어요.')}</p>
      <div class="row"><button class="btn" id="backup-save">${tr('파일로 내보내기')}</button><button class="btn" id="backup-load">${tr('불러오기')}</button></div></div>
    <h1 class="title" style="margin-top:28px">${tr('경전함에 대하여')}</h1>
    <p>${tr('경전함은 불교 경전을 원문·음독·번역으로 읽고 듣는 앱입니다. 웹 버전은 광고와 서버 없이 모든 내용이 브라우저 안에서 동작합니다. 독송 영상은 불교방송(BBS)·BTN 등 공식 채널이 유튜브에 올린 영상을 유튜브 플레이어로 보여 주며, 영상을 볼 때만 YouTube에 연결합니다.')}</p>
    <p class="small muted">${tr('매일 알림과 홈 화면 위젯은 안드로이드 앱에서 쓸 수 있어요. 이 웹 앱은 브라우저 메뉴의 \'홈 화면에 추가\'로 설치하면 인터넷 없이도 읽을 수 있어요.')}</p>
    <div class="notice">${tr('번역과 해설은 AI 초안을 바탕으로 새로 옮긴 것으로, 감수를 거쳐 계속 다듬고 있습니다. 독송 음성은 미리 만든 AI 음성(ElevenLabs)입니다. 글꼴: 고운바탕(류양희,')} <a href="fonts/OFL.txt">SIL Open Font License 1.1</a>${tr('). 목탁·종 효과음: 김용배, 한국저작권위원회')} <a href="https://gongu.copyright.or.kr/">${tr('공유마당')}</a>(CC BY).</div>
    <div id="related"></div>
    <div id="seller"></div>
    ${sutras.map((s) => `<div class="card" style="margin-top:12px">
      <b>${esc(s.title.ko)}</b>
      <div class="small">${tr('원문: {0}', esc(s.source.text))}</div>
      <div class="small">${esc(s.source.license)}</div>
      <div class="small">${esc(s.source.translationLicense)}</div>
      ${showReview && s.reviewChecklist.length ? `<div class="small" style="color:var(--primary);margin-top:6px">${tr('감수 때 확인할 항목')}</div>` +
        s.reviewChecklist.slice().sort((a, b) => a.priority - b.priority).map((r) =>
          `<div class="small">${tr('{0}. [{1}구절] {2}', r.priority, s.sections.findIndex((x) => x.id === r.sectionId) + 1, esc(r.issue))}</div>`).join('') : ''}
    </div>`).join('')}
    <p class="small muted">${tr('설정·즐겨찾기·수행 기록은 이 브라우저에만 저장되며 어디로도 보내지 않습니다.')}</p>
  </div>`;
  showSeller();
  showRelated();
  app().querySelectorAll('[data-lang]').forEach((b) => { b.onclick = () => setLanguage(b.dataset.lang || null); });
  $('#backup-save').onclick = () => backup.download();
  $('#backup-load').onclick = () => backup.pick();
}

// ───────────────────────── 시작 ─────────────────────────

window.addEventListener('hashchange', () => {
  // 다른 화면으로 가면 독송을 멈춘다 (같은 경전 안에서 사경 등은 예외 없음)
  if (reciter.playing && !location.hash.startsWith('#/read/' + reciter.playing.sutraId)) reciter.stop();
  render();
});

(async () => {
  try {
    [sutras] = await Promise.all([loadSutras(), reciter.loadRecorded(), lunar.load()]);
    render();
  } catch (e) {
    app().innerHTML = `<p class="loading">${tr('경전 데이터를 읽지 못했습니다')}<br>${esc(e.message)}</p>`;
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
