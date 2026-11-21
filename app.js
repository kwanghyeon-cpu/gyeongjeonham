/*
 * 경전함 웹 버전.
 * 안드로이드 앱의 assets/sutras/*.json 을 그대로 읽는다 (scripts/build-web.sh 가 복사).
 * 서버·광고·분석 없이 모든 기록은 브라우저 localStorage 에만 저장한다.
 */
'use strict';

// ───────────────────────── 데이터 ─────────────────────────

const VIEW_MODES = [
  { id: 'Read', label: '읽기' },
  { id: 'Recite', label: '독송' },
  { id: 'Study', label: '공부' },
  { id: 'Memorize', label: '외우기' },
];
const MASK_LEVELS = ['보기', '첫 글자만', '모두 가리기'];
const SLEEP_STEPS = [[0, '이 경전이 끝나면'], [15, '15분'], [30, '30분'], [45, '45분'], [60, '1시간']];
const REPEAT_SECTION_STEPS = [3, 7, 21, 0];
const BOW_PAUSES = [3, 5, 8];
const DEDICATION = '#dedication';
const DEDICATION_PRESETS = ['부모님의 건강을 위해', '돌아가신 분의 극락왕생을 위해', '가족의 평안을 위해', '모든 중생이 행복하기를'];
// 미리 넣어 둔 독송 묶음 (앱과 같다)
const PRESET_PLAYLISTS = [
  { id: 'morning', name: '아침 예불', sutras: ['yebul-mun', 'heart-sutra', 'cheonsu-gyeong'] },
  { id: 'evening', name: '저녁 독송', sutras: ['heart-sutra', 'beopseong-ge', 'isan-balwon'] },
  { id: 'memorial', name: '49재 독송', sutras: ['musang-gye', 'heart-sutra', 'amitabha-sutra', 'jijang-gyeong'] },
  { id: 'parents', name: '부모님을 위해', sutras: ['bumo-eunjung', 'uranbun-gyeong', 'jijang-gyeong'] },
  { id: 'healing', name: '건강을 비는 독송', sutras: ['heart-sutra', 'yaksa-gyeong', 'gwaneum-gyeong'] },
  { id: 'seon', name: '선의 노래', sutras: ['sinsim-myeong', 'jeungdo-ga', 'beopseong-ge'] },
];

/** 외우기: 낱말의 첫 글자만 남기거나(1) 모두(2) ○로 가린다 */
const maskText = (text, level) => (level <= 0 ? text
  : text.replace(/\S+/g, (w) => [...w].map((c, i) => (/\p{L}/u.test(c) && (level >= 2 || i > 0) ? '○' : c)).join('')));

/** 49재: 돌아가신 날을 첫날로 쳐서 이레마다, 일곱째가 49재 */
const jaeDate = (m, n) => { const d = new Date(m.date + 'T00:00:00'); d.setDate(d.getDate() + 7 * n - 1); return ymd(d); };
const jaeName = (n) => (n === 1 ? '초재' : n === 7 ? '49재(막재)' : `${n}재`);
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
const FONT_STEPS = [[0.9, '작게'], [1, '보통'], [1.15, '크게'], [1.3, '더 크게'], [1.5, '아주 크게']];
// 듣기 배속 (음원 원래 속도 = 1). 독송은 천천히 듣는 게 좋아 기본은 '조금 느리게'(0.85배)
const RATE_STEPS = [[0.6, '아주 느리게'], [0.7, '느리게'], [0.85, '조금 느리게'], [1, '원래 속도']];
const REPEAT_STEPS = [1, 3, 7, 21];
const BEAD_TARGETS = [108, 1080, 3000];
const BEADS = '#beads';
const SIT = '#sit';
const SIT_STEPS = [5, 10, 20, 30, 60];
const SIT_INTERVALS = [[0, '없음'], [5, '5분마다'], [10, '10분마다']];
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

async function loadSutras() {
  const files = await (await fetch('sutras/index.json')).json();
  const list = await Promise.all(files.map(async (f) => parseSutra(await (await fetch('sutras/' + f)).json())));
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
        terms.push({ sutra: s, field: '용어', text: `${t.term} (${t.hanja}) — ${t.definition}` });
      }
    }
    s.sections.forEach((sec, i) => {
      const fields = [
        ['소제목', sec.heading || ''], ['원문', sec.hanja], ['음독', sec.eumdok], ['풀이', sec.plain],
        ['독송본', sec.recitation.join(' ')], ['해설', sec.commentary],
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

async function shareVerse(sutra, index) {
  const sec = sutra.sections[index];
  const body = isMantra(sec) ? sec.eumdok : sec.plain;
  const where = `${sutra.title.ko} ${index + 1}구절` + (headingKo(sec) ? ` · ${headingKo(sec)}` : '');
  const text = `${body}\n\n— ${where}\n경전함`;
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('구절을 복사했어요'); } catch { toast('공유할 수 없어요'); }
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
      audio.src = 'audio/' + item.src;
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
      navigator.mediaSession.metadata = new MediaMetadata({ title: (this.playlist ? this.playlist.name + ' · ' : '') + sutra.title.ko, artist: '경전함 독송' });
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
  return l == null ? '취침' : l < 0 ? '끝나면' : l >= 60 ? `${Math.ceil(l / 60)}분` : `${l}초`;
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
  const tabs = { home: '홈', search: '검색', practice: '수행', about: '더보기' };
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

// ───────────────────────── 홈 ─────────────────────────

function renderHome() {
  const v = dailyVerse();
  const now = new Date();
  const last = sutraById(prefs.lastSutra);
  // 들을 시간(음원이 있으면 'N분'), 없으면 구절 수
  const length = (s) => (reciter.minutes(s.id) ? `${reciter.minutes(s.id)}분` : `${s.sections.length}구절`);
  const label = (s) => s.title.short || s.title.ko;
  const group = (g) => sutras.filter((s) => s.group === g);

  const dow = '일월화수목금토'[now.getDay()];
  app().innerHTML = `<div class="page">
    <div class="home-head"><h1>경전함</h1><div class="muted">${now.getMonth() + 1}월 ${now.getDate()}일 ${dow}요일${lunar.of(today()) ? ' · ' + lunar.of(today()).label : ''}</div>
      ${(() => { const h = lunar.next(today()); if (!h) return ''; const [, hm, hd] = h.date.split('-').map(Number);
        return `<div class="holy-next">${h.days === 0 ? `오늘은 ${h.name}입니다` : `${h.name} ${h.days}일 뒤 (${hm}월 ${hd}일)`}</div>`; })()}</div>
    ${v ? `<div class="card verse">
      <div class="label">오늘의 말씀 · ${esc(v.sutra.title.ko)}</div>
      <a href="#/read/${v.sutra.id}?s=${v.sec.id}" style="color:inherit;text-decoration:none"><div class="text" style="margin-top:10px">${esc(v.sec.plain)}</div></a>
      <div class="row" style="justify-content:flex-end"><button class="btn text" id="share-daily">공유</button></div>
    </div>` : ''}
    ${last ? `<a class="resume" href="#/read/${last.id}">${ICON.play}<span class="grow">이어 읽기 · ${esc(last.title.ko)}</span><span class="at">${prefs.position(last.id) + 1}구절</span></a>` : ''}
    ${group('daily').length ? `<h2 class="group">매일 독송</h2><div class="daily">${group('daily').map((s) =>
      `<a class="card" href="#/read/${s.id}"><b>${esc(label(s))}</b><span class="small muted">${length(s)}</span></a>`).join('')}</div>` : ''}
    <h2 class="group">묶음 듣기</h2><div class="chips">${PRESET_PLAYLISTS.concat(prefs.playlists).map((p) => {
      const mine = p.id.startsWith('my-');
      const mins = p.sutras.reduce((n, id) => n + (reciter.minutes(id) || 0), 0);
      return `<span class="pill playlist ${mine ? 'mine' : ''}"><button data-pl="${esc(p.id)}" aria-label="${esc(p.name)} 이어서 듣기">${ICON.play} ${esc(p.name)}${mins ? ` <span class="small muted">${mins}분</span>` : ''}</button>${mine ? `<button class="x" data-del="${esc(p.id)}" aria-label="${esc(p.name)} 묶음 지우기">×</button>` : ''}</span>`;
    }).join('')}<button class="pill outline" id="pl-new">+ 묶음 만들기</button></div>
    ${group('sutra').length ? `<h2 class="group">경전</h2><div class="rows">${group('sutra').map((s) =>
      `<a href="#/read/${s.id}"><span class="grow">${esc(s.title.ko)}</span><span class="small muted">${length(s)}</span></a>`).join('')}</div>` : ''}
    ${group('verse').length ? `<h2 class="group">게송·수행문</h2><div class="chips">${group('verse').map((s) =>
      `<a class="pill" href="#/read/${s.id}">${esc(label(s))}</a>`).join('')}</div>` : ''}
  </div>`;
  if (v) $('#share-daily').onclick = () => shareVerse(v.sutra, v.number - 1);
  const all = PRESET_PLAYLISTS.concat(prefs.playlists);
  app().querySelectorAll('[data-pl]').forEach((b) => {
    b.onclick = () => {
      const first = reciter.playPlaylist(all.find((p) => p.id === b.dataset.pl));
      if (first) go('/read/' + first.id); else toast('들을 수 있는 경전이 없어요');
    };
  });
  app().querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = () => { const p = all.find((x) => x.id === b.dataset.del); if (confirm(`'${p.name}' 묶음을 지울까요?`)) { prefs.removePlaylist(p.id); renderHome(); } };
  });
  $('#pl-new').onclick = openPlaylistEditor;
}

/** 독송 묶음 만들기: 이름을 짓고 들을 차례대로 누른다 */
function openPlaylistEditor() {
  let picked = [];
  const playable = sutras.filter((s) => reciter.canPlay(s));
  const draw = (name = '') => openSheet(`
    <h2 style="font-size:19px;margin:0 0 14px">묶음 만들기</h2>
    <input class="search-box" id="pl-name" placeholder="묶음 이름 (예: 나의 저녁 기도)" value="${esc(name)}" aria-label="묶음 이름">
    <p class="small muted">들을 차례대로 누르세요</p>
    <div class="chips">${playable.map((s) => { const n = picked.indexOf(s.id);
      return `<button class="chip ${n >= 0 ? 'on' : ''}" data-pick="${s.id}" aria-pressed="${n >= 0}">${n >= 0 ? n + 1 + '. ' : ''}${esc(s.title.short || s.title.ko)}</button>`; }).join('')}</div>
    <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn text" id="pl-cancel">취소</button><button class="btn filled" id="pl-save">만들기</button></div>`, (el) => {
    el.querySelectorAll('[data-pick]').forEach((b) => {
      b.onclick = () => { const id = b.dataset.pick; picked = picked.includes(id) ? picked.filter((x) => x !== id) : picked.concat(id); draw($('#pl-name', el).value); };
    });
    $('#pl-cancel', el).onclick = closeSheet;
    $('#pl-save', el).onclick = () => {
      const n = $('#pl-name', el).value.trim();
      if (!n || !picked.length) return toast('이름을 짓고 경전을 하나 이상 골라 주세요');
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
    body = `<div class="recite pre ${level ? 'masked' : ''}" ${level ? 'aria-label="가려진 구절. 눌러서 펼쳐 보세요"' : ''}>${esc(maskText(text, level))}</div>`;
  } else if (isMantra(sec) && mode !== 'Study') body = `<div class="mantra">${esc(sec.eumdok)}</div>`;
  else if (mode === 'Read') body = `<div class="plain">${esc(sec.plain)}</div>`;
  else if (mode === 'Recite') body = `<div class="recite pre">${esc((sec.recitation.length ? sec.recitation : [sec.plain]).join('\n'))}</div>`;
  else body = `<div class="study"><div><div class="hanja pre">${esc(sec.hanja)}</div><div class="eumdok">${esc(sec.eumdok)}</div></div>
    <div class="plain">${esc(isMantra(sec) ? sec.meaning || '' : sec.plain)}</div></div>`;
  const marked = prefs.isBookmarked(`${sutra.id}/${sec.id}`);
  const star = marked ? '<span class="star" aria-hidden="true">★</span>' : '';
  return `<div class="passage" id="p-${i}" data-i="${i}" role="button" tabindex="0">
    <div class="num" aria-label="${i + 1}구절${marked ? ', 즐겨찾기' : ''}">${i + 1}${star}</div>
    <div class="body">${label ? `<div class="head">${esc(label)}</div>` : ''}${body}</div></div>`;
}

let reader = null; // 지금 열린 경전 상태

function renderReader(id, focusId) {
  const sutra = sutraById(id);
  if (!sutra) return go('/');
  const mode = VIEW_MODES.find((m) => m.id === prefs.viewMode) || VIEW_MODES[0];
  reader = { sutra, mode, mask: store.get('maskLevel', 1), memEumdok: store.get('memEumdok', true), revealed: new Set(), bowPause: store.get('bowPause', 5) };
  document.documentElement.style.setProperty('--fs', prefs.fontScale);
  const toc = sutra.sections.some((s) => s.heading);

  app().innerHTML = `
    <div class="topbar">
      <button class="icon" id="back" aria-label="뒤로">${ICON.back}</button>
      <h1>${esc(sutra.title.ko)}</h1>
      ${toc ? `<select id="toc" aria-label="목차"><option value="">목차 ▾</option>
        ${sutra.sections.map((s, i) => headingKo(s) ? `<option value="${i}">${i + 1}  ${esc(headingKo(s))}</option>` : '').join('')}</select>` : ''}
      <span style="flex:1"></span>
      ${sutra.videos.length ? `<button class="btn text" id="video-toggle">${ICON.video} 영상</button>` : ''}
      <button class="icon" id="settings" aria-label="보기·듣기 설정">${ICON.settings}</button>
    </div>
    <div id="video"></div>
    <div class="page reader" style="padding-top:0">
      <div class="segment">${VIEW_MODES.map((m) => `<button data-mode="${m.id}" class="${m.id === mode.id ? 'on' : ''}">${m.id === mode.id ? '✓ ' : ''}${m.label}</button>`).join('')}</div>
      ${mode.id === 'Memorize' ? `<div class="chips choice">${MASK_LEVELS.map((n, k) => `<button class="chip ${k === reader.mask ? 'on' : ''}" data-mask="${k}">${n}</button>`).join('')}</div>
        <div class="chips choice" style="margin-top:8px"><button class="chip ${reader.memEumdok ? 'on' : ''}" data-mem="1">음독으로</button><button class="chip ${reader.memEumdok ? '' : 'on'}" data-mem="0">우리말로</button></div>
        <p class="small muted">구절을 누르면 잠깐 펼쳐 보고, 길게 누르면 자세히 볼 수 있어요</p>`
        : reciter.canPlay(sutra) ? '<p class="small muted">듣기: AI 음성 독송 · 두 손가락으로 글자 크기 조절</p>' : ''}
      ${reciter.canBow(sutra) ? `<div class="card bowbox" id="bowbox"><b>108배 맞춰 듣기</b>
        <p class="small muted" style="margin:4px 0 10px">명호를 한 줄 읽고, 절할 시간만큼 쉬었다가 다음으로 넘어가요. 몇 번째 절인지 아래에 크게 보여 드려요. (모두 ${bowCount(sutra)}번)</p>
        <div class="chips choice">${BOW_PAUSES.map((s) => `<button class="chip ${s === reader.bowPause ? 'on' : ''}" data-pause="${s}">${s}초</button>`).join('')}</div>
        <button class="btn filled" id="bow-start" style="width:100%;margin-top:12px;font-weight:700">절하며 듣기 시작</button></div>` : ''}
      <div id="passages">${sutra.sections.map((s, i) => passageHtml(sutra, s, i, mode.id)).join('')}</div>
    </div>
    <div id="player"></div>`;

  $('#back').onclick = () => { reciter.stop(); history.length > 1 ? history.back() : go('/'); };
  $('#settings').onclick = openSettings;
  $('#video-toggle')?.addEventListener('click', () => (reader.video == null ? openVideo(0) : closeVideo()));
  if (toc) $('#toc').onchange = (e) => { if (e.target.value !== '') $('#p-' + e.target.value).scrollIntoView(); e.target.value = ''; };
  app().querySelectorAll('[data-mode]').forEach((b) => {
    b.onclick = () => { prefs.viewMode = b.dataset.mode; renderReader(id); onPlaybackChange(); };
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
    const i = Math.max(0, FONT_STEPS.findIndex(([v]) => v === prefs.fontScale));
    const next = ratio > 1.25 ? i + 1 : ratio < 0.8 ? i - 1 : i;
    if (next !== i && FONT_STEPS[next]) {
      prefs.fontScale = FONT_STEPS[next][0];
      document.documentElement.style.setProperty('--fs', prefs.fontScale);
      toast('글자 ' + FONT_STEPS[next][1]);
      pinch = dist(e.touches);
    }
  };
  const onTouchEnd = (e) => { if (e.touches.length < 2) pinch = null; };
  const area = $('.page.reader');
  area.addEventListener('touchstart', onTouchStart, { passive: true });
  area.addEventListener('touchmove', onTouchMove, { passive: false });
  area.addEventListener('touchend', onTouchEnd);

  // 처음 열 때 위치: 알림·검색에서 온 구절, 아니면 지난번 읽던 곳
  const focus = sutra.sections.findIndex((s) => s.id === focusId);
  const startAt = focus >= 0 ? focus : prefs.position(sutra.id);
  requestAnimationFrame(() => { if (startAt > 0) $('#p-' + startAt)?.scrollIntoView(); });

  // 읽던 위치 저장
  let scrollTimer;
  const onScroll = () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const top = 80;
      const ps = [...document.querySelectorAll('.passage')];
      const first = ps.find((p) => p.getBoundingClientRect().bottom > top);
      if (first) prefs.savePosition(sutra.id, Number(first.dataset.i));
    }, 300);
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
      <span class="grow"><b>${esc(v.title)}</b><br><span class="small muted">${esc(v.channel)} 공식 채널 · YouTube</span></span>
      <a class="btn text" href="https://www.youtube.com/watch?v=${encodeURIComponent(v.youtubeId)}" target="_blank" rel="noopener">YouTube</a>
      <button class="btn text" id="video-close">닫기</button>
    </div>
    ${reader.sutra.videos.length > 1 ? `<div class="chips" style="padding:8px 16px 0">${reader.sutra.videos.map((x, k) =>
      `<button class="chip ${k === i ? 'on' : ''}" data-video="${k}">${esc(x.title)}</button>`).join('')}</div>` : ''}
  </div>`;
  $('#video-close').onclick = closeVideo;
  document.querySelectorAll('[data-video]').forEach((b) => { b.onclick = () => openVideo(Number(b.dataset.video)); });
  $('#video-toggle').innerHTML = ICON.video + ' 닫기';
  onPlaybackChange();
}
function closeVideo() {
  if (!reader) return;
  reader.video = null;
  $('#video').innerHTML = '';
  $('#video-toggle').innerHTML = ICON.video + ' 영상';
  onPlaybackChange();
}

function listen(start = 0) {
  if (!reader) return;
  reciter.play(reader.sutra, start);
}

function onPlaybackChange() {
  if (!reader) return;
  const p = reciter.playing && reciter.playing.sutraId === reader.sutra.id ? reciter.playing : null;
  document.querySelectorAll('.passage.playing').forEach((el) => el.classList.remove('playing'));
  const player = $('#player');
  if (!player) return;
  $('#bowbox')?.toggleAttribute('hidden', !!p);
  if (p) {
    const el = $('#p-' + p.index);
    if (el) { el.classList.add('playing'); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    const sec = reader.sutra.sections[p.index];
    const name = headingKo(sec);
    const progress = p.bow ? p.bow / Math.max(1, p.bowTotal) : (p.index + 1) / p.total;
    const info = p.bow ? '' : [
      p.playlist ? `${p.playlist} ${p.pos + 1}/${p.size}` : null,
      p.repeat ? (p.repeatTotal ? `반복 ${p.repeat}/${p.repeatTotal}번` : `반복 ${p.repeat}번째`) : `${p.index + 1} / ${p.total} 구절`,
    ].filter(Boolean).join(' · ');
    player.innerHTML = `<div class="playbar"><div class="progress"><i style="width:${progress * 100}%"></i></div><div class="inner">
      ${p.bow ? `<div class="bow-n" aria-label="${p.bow}번째 절">${p.bow}</div>
        <div class="grow" style="min-width:0" aria-live="polite"><div class="now">${esc(p.bowing ? '절하세요' : (p.line != null ? sec.recitation[p.line] : name || reader.sutra.title.ko))}</div>
        <div class="small muted">${p.bowTotal}번 가운데 · 108배 맞춰 듣기</div></div>`
      : `<div class="grow" style="min-width:0"><div class="now">${esc(name || reader.sutra.title.ko)}</div>
        <div class="small muted">${p.paused ? '일시정지 · ' : ''}${esc(info)}</div></div>`}
      <button class="btn text" id="sleep" aria-label="취침 타이머">${sleepLabel()}</button></div>
      <div class="inner controls">
        <button class="icon-btn" id="prev-sec" aria-label="이전 구절">${ICON.prev}</button>
        <button class="icon-btn main" id="toggle" aria-label="${p.paused ? '이어 듣기' : '일시정지'}">${p.paused ? ICON.play : ICON.pause}</button>
        <button class="icon-btn" id="next-sec" aria-label="다음 구절">${ICON.next}</button>
        <span class="grow"></span>
        <button class="btn tonal" id="stop">${ICON.stop} 정지</button></div></div>`;
    $('#stop').onclick = () => reciter.stop();
    $('#toggle').onclick = () => reciter.togglePause();
    $('#prev-sec').onclick = () => reciter.previous();
    $('#next-sec').onclick = () => reciter.next();
    $('#sleep').onclick = () => openSheet(`<h2 style="font-size:19px;margin:0 0 14px">취침 타이머</h2>
      <p class="small muted">정한 시간이 되면 소리를 서서히 줄이며 멈춰요.</p>
      <div class="chips">${SLEEP_STEPS.map(([m, n]) => `<button class="chip" data-sleep="${m}">${n}</button>`).join('')}
        ${reciter.sleepLeft() != null ? '<button class="chip" data-sleep="off">끄기</button>' : ''}</div>`, (el) => {
      el.querySelectorAll('[data-sleep]').forEach((b) => {
        b.onclick = () => { reciter.setSleep(b.dataset.sleep === 'off' ? null : Number(b.dataset.sleep)); closeSheet(); };
      });
    });
  } else if (reciter.lastFinished === reader.sutra.id) {
    // 끝까지 들었으면 회향을 적을지 가볍게 묻는다
    player.innerHTML = `<div class="playbar"><div class="inner"><div class="grow now">끝까지 들었어요</div>
      <button class="btn text" id="dedicate">회향 적기</button><button class="btn text" id="fin-close">닫기</button></div></div>`;
    $('#dedicate').onclick = () => openDedication(reader.sutra.title.ko + ' 독송', today(), () => { reciter.lastFinished = null; onPlaybackChange(); });
    $('#fin-close').onclick = () => { reciter.lastFinished = null; onPlaybackChange(); };
  } else if (reciter.canPlay(reader.sutra) && reader.video == null) {
    player.innerHTML = `<button class="fab" id="play">${ICON.play} 독송 듣기</button>`;
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
  openSheet(`
    <div class="muted small">${i + 1}  ${esc(sec.heading || '')}</div>
    <div class="actions">
      ${reciter.canPlay(sutra) ? '<button class="act" id="d-listen"><span class="sym">▶</span>여기서 듣기</button>' : ''}
      <button class="act" id="d-bm">${bmLabel(ref)}</button>
      <button class="act" id="d-share"><span class="sym">↗</span>공유</button>
      <button class="act" id="d-trace"><span class="sym">✎</span>사경</button>
    </div>
    <div class="stack reader">
      <div class="hanja pre">${esc(sec.hanja)}</div>
      <div class="eumdok">${esc(sec.eumdok)}</div>
      ${isMantra(sec) ? '' : `<div class="plain">${esc(sec.plain)}</div>`}
      ${sec.meaning ? `<div>뜻: ${esc(sec.meaning)}</div>` : ''}
      ${sec.sanskrit ? `<div class="muted small"><i>${esc(sec.sanskrit)}</i></div>` : ''}
    </div>
    ${reciter.canPlay(sutra) ? `<div class="row" style="margin-top:16px;flex-wrap:wrap"><span class="small muted" style="flex-basis:100%">이 구절만 반복해서 듣기</span>
      <div class="chips choice" style="flex:1">${REPEAT_SECTION_STEPS.map((n) => `<button class="chip" data-rep="${n}" aria-label="${n ? n + '번 반복' : '멈출 때까지 반복'}">${n ? n + '번' : '계속'}</button>`).join('')}</div></div>` : ''}
    <div id="note-box">${prefs.isBookmarked(ref) ? noteBox(ref) : ''}</div>
    ${sec.commentary ? `<h3>해설</h3><div>${esc(sec.commentary)}</div>` : ''}
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
    $('#d-share', el).onclick = () => shareVerse(sutra, i);
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

const bmLabel = (ref) => (prefs.isBookmarked(ref) ? '<span class="sym">★</span>즐겨찾기됨' : '<span class="sym">☆</span>즐겨찾기');

/** 즐겨찾기 메모 입력 칸 */
const noteBox = (ref) => `<label class="small muted" for="note" style="display:block;margin-top:14px">메모</label>
  <textarea id="note" class="search-box" rows="2" placeholder="이 구절에서 마음에 남은 것">${esc(prefs.noteOf(ref))}</textarea>`;

/** 회향 적기 */
function openDedication(hint, date, done) {
  openSheet(`<h2 style="font-size:19px;margin:0 0 8px">회향 적기</h2>
    <p class="small muted">이 수행의 공덕을 누구에게 돌릴지 적어 두면 수행 달력에 함께 남아요.</p>
    <div class="chips">${[hint].filter(Boolean).concat(DEDICATION_PRESETS).map((p) => `<button class="chip" data-ded="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    <input class="search-box" id="ded" style="margin-top:12px" placeholder="예: 어머니의 건강을 위해" aria-label="회향">
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn text" id="ded-cancel">취소</button><button class="btn filled" id="ded-save">남기기</button></div>`, (el) => {
    el.querySelectorAll('[data-ded]').forEach((b) => { b.onclick = () => { $('#ded', el).value = b.dataset.ded; }; });
    $('#ded-cancel', el).onclick = closeSheet;
    $('#ded-save', el).onclick = () => {
      const t = $('#ded', el).value.trim();
      if (!t) return;
      prefs.addDedication(t, date);
      closeSheet();
      toast('회향을 남겼어요');
      done?.();
    };
  });
}

function openSettings() {
  const chips = (list, current, key) => list.map(([v, name]) =>
    `<button class="chip ${v === current ? 'on' : ''}" data-k="${key}" data-v="${v}">${name}</button>`).join('');
  const draw = () => openSheet(`
    <h2 style="font-size:19px;margin:0 0 14px">보기·듣기 설정</h2>
    <section><b>글자 크기 · ${(FONT_STEPS.find(([v]) => v === prefs.fontScale) || [])[1] || ''}</b><div class="chips choice" style="margin-top:8px">${FONT_STEPS.map(([v, n]) => `<button class="chip ${v === prefs.fontScale ? 'on' : ''}" data-k="fontScale" data-v="${v}" aria-label="글자 ${n}" style="font-size:${15 * v}px;font-family:var(--serif)">가</button>`).join('')}</div></section>
    <section><b>듣기 속도 · ${(RATE_STEPS.find(([v]) => v === prefs.rate) || [])[1] || ''}</b><div class="chips choice" style="margin-top:8px">${chips(RATE_STEPS.map(([v]) => [v, v + '배']), prefs.rate, 'rate')}</div></section>
    <section><b>진언·다라니 반복</b><div class="chips choice" style="margin-top:8px">${chips(REPEAT_STEPS.map((n) => [n, n + '번']), prefs.repeat, 'repeat')}</div></section>
    <section class="row"><span class="grow"><b>끝나면 처음부터 다시</b><br><span class="small muted">경전을 계속 반복해서 들어요</span></span>
      <input type="checkbox" id="loop" ${prefs.loop ? 'checked' : ''} style="width:24px;height:24px"></section>
    <p class="small muted">듣기 설정은 다음에 ▶를 누를 때부터 적용돼요</p>`, (el) => {
    el.querySelectorAll('[data-k]').forEach((b) => {
      b.onclick = () => {
        prefs[b.dataset.k] = Number(b.dataset.v);
        if (b.dataset.k === 'fontScale') document.documentElement.style.setProperty('--fs', prefs.fontScale);
        draw();
      };
    });
    $('#loop', el).onchange = (e) => { prefs.loop = e.target.checked; };
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
    <input class="search-box" id="q" type="search" placeholder="경전 검색 (한글·한자·산스크리트)" value="${esc(initial)}" autocomplete="off">
    <div id="results" style="margin-top:16px"></div></div>`;
  const input = $('#q');
  const run = () => {
    const q = input.value;
    history.replaceState(null, '', '#/search' + (q ? '?q=' + encodeURIComponent(q) : ''));
    const hits = search(q).slice(0, 200);
    $('#results').innerHTML = !q.trim() ? '<p class="muted">경전 이름, 구절, 용어를 찾아 보세요. 예: 열반, 色卽是空, nirvana</p>'
      : !hits.length ? '<p class="muted">찾는 내용이 없어요</p>'
      : hits.map((h) => `<a class="card hit" style="text-decoration:none;color:inherit" href="#/read/${h.sutra.id}${h.sec ? '?s=' + h.sec.id : ''}">
          <div class="where">${esc(h.sutra.title.ko)}${h.number ? ' ' + h.number + '구절' : ''} · ${h.field}</div>
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
  const left = sit.left();
  const [sy, sm, sd] = calSelected.split('-').map(Number);

  app().innerHTML = `<div class="page">
    <h1 class="title">염주</h1>
    <button class="bead" id="bead" aria-label="하나 세기">
      <span class="n">${b.count % b.target}</span>
      <span>/ ${b.target}${Math.floor(b.count / b.target) ? ' · ' + Math.floor(b.count / b.target) + '바퀴' : ''}</span>
    </button>
    <p class="small muted" style="text-align:center">누를 때마다 하나씩 셉니다 · 오늘 모두 ${prefs.beadsOn(today())}번</p>
    <div class="row">
      <div class="chips choice grow">${BEAD_TARGETS.map((n) => `<button class="chip ${n === b.target ? 'on' : ''}" data-target="${n}">${n}번</button>`).join('')}</div>
      <button class="btn text" id="reset">처음부터</button>
    </div>
    <label class="row" style="margin-top:8px"><span class="grow"><b>목탁 소리</b><br><span class="small muted">누를 때마다 목탁, 한 바퀴를 채우면 종이 울려요</span></span>
      <input type="checkbox" id="bead-sound" ${prefs.beadSound ? 'checked' : ''} style="width:24px;height:24px"></label>
    <h2 class="section">좌선</h2>
    <div class="card sit">${sit.running ? `
      <div id="sit-left" class="sit-left">${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</div>
      <div class="sit-track"><i id="sit-bar" style="width:${((sit.total - left) / sit.total) * 100}%"></i></div>
      <p class="small muted">고요히 앉아 숨을 지켜보세요. 끝나면 종이 울립니다. 그동안 화면은 꺼지지 않아요(지원하는 브라우저).</p>
      <button class="btn" id="sit-stop" style="width:100%">그만하기</button>` : `
      <b>앉을 시간</b>
      <div class="chips choice" style="margin:8px 0 14px">${SIT_STEPS.map((n) => `<button class="chip ${n === prefs.sitMinutes ? 'on' : ''}" data-sit="${n}">${n}분</button>`).join('')}</div>
      <b>중간 종</b>
      <div class="chips choice" style="margin:8px 0 16px">${SIT_INTERVALS.map(([n, name]) => `<button class="chip ${n === prefs.sitInterval ? 'on' : ''}" data-int="${n}">${name}</button>`).join('')}</div>
      <button class="btn filled" id="sit-start" style="width:100%;font-weight:700">좌선 시작</button>
      <p class="small muted">시작과 끝에 큰 종이 울립니다. 소리를 켜 두세요.</p>`}</div>
    <h2 class="section">수행 기록</h2>
    <p style="color:var(--primary);font-weight:600">${streak ? `${streak}일째 이어서 수행하고 있어요` : '오늘 경전을 읽거나 염주를 돌리거나 좌선하면 기록돼요'}</p>
    <div class="row"><button class="btn text" id="prev">‹</button>
      <b class="grow" style="text-align:center">${y}년 ${m + 1}월</b>
      <button class="btn text" id="next" ${isThisMonth ? 'disabled' : ''}>›</button></div>
    <div class="card summary">${ms.days ? `<div>${[`수행한 날 ${ms.days}일`, ms.sutraTimes && `경전 ${ms.sutraTimes}번`, ms.beads && `염주 ${ms.beads.toLocaleString()}번`,
      ms.sits && `좌선 ${ms.sits}분`, ms.dedications && `회향 ${ms.dedications}번`].filter(Boolean).join(' · ')}</div>
      ${ms.top.length ? `<div class="small muted">많이 읽은 경전: ${ms.top.map(([id, n]) => names[id] ? `${esc(names[id])} ${n}일` : '').filter(Boolean).join(', ')}</div>` : ''}`
      : '<div class="small muted">이달에는 아직 기록이 없어요</div>'}</div>
    <div class="calendar">
      ${['일', '월', '화', '수', '목', '금', '토'].map((d) => `<div class="dow" aria-hidden="true">${d}</div>`).join('')}
      ${'<div></div>'.repeat(lead)}
      ${Array.from({ length: len }, (_, k) => {
        const d = ymd(new Date(y, m, k + 1));
        const h = lunar.holy(d);
        const j = prefs.jaeOn(d);
        const label = [`${m + 1}월 ${k + 1}일`, days.has(d) && '수행함', h?.name, ...j.map((x) => `${x.m.name} ${jaeName(x.n)}`)].filter(Boolean).join(', ');
        return `<button data-day="${d}" aria-label="${esc(label)}" aria-pressed="${d === calSelected}" class="${days.has(d) ? 'done' : ''} ${d === calSelected ? 'sel' : ''} ${d === today() ? 'today' : ''} ${h ? (h.major ? 'holy major' : 'holy') : ''} ${j.length ? 'jae' : ''}">${k + 1}</button>`;
      }).join('')}
    </div>
    <div class="card" style="margin-top:12px"><b>${sm}월 ${sd}일</b>
      ${(() => { const l = lunar.of(calSelected); const h = lunar.holy(calSelected); return l ? `<div class="small" style="color:${h ? 'var(--primary)' : 'var(--muted)'}">${l.label}${h ? ' · ' + h.name : ''}</div>` : ''; })()}
      ${jae.map((x) => `<div class="small jae-text">${esc(x.m.name)} ${jaeName(x.n)}</div>`).join('')}
      ${!what.length && !beads && !sat && !deds.length ? '<div class="small muted">기록이 없어요</div>' : ''}
      ${what.length ? `<div>읽은 경전: ${esc(what.join(', '))}</div>` : ''}
      ${beads ? `<div>염주: ${beads}번</div>` : ''}
      ${sat ? `<div>좌선: ${sat}분</div>` : ''}
      ${deds.map((d) => `<div class="row"><span class="grow">회향: ${esc(d.text)}</span><button class="btn text" data-unded="${d.at}">지우기</button></div>`).join('')}
      ${calSelected <= today() ? '<button class="btn text" id="add-ded" style="padding-left:0">+ 이날 회향 적기</button>' : ''}</div>
    <p class="small muted">경전을 1분 넘게 읽거나, 끝까지 듣거나, 사경·염주·좌선·회향을 하면 기록돼요. 기록은 이 브라우저에만 저장됩니다.</p>
    <h2 class="section">49재 일정</h2>
    ${memorialsHtml()}
    ${savedVerses()}
  </div>`;
  void sy;

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
    c.onclick = () => { if (confirm('이 49재 일정을 지울까요?')) { prefs.removeMemorial(c.dataset.unmem); renderPracticeKeepScroll(); } };
  });
  $('#mem-add').onclick = () => openSheet(`<h2 style="font-size:19px;margin:0 0 14px">49재 일정 넣기</h2>
    <input class="search-box" id="mem-name" placeholder="영가 이름 (예: 홍길동 영가)" aria-label="영가 이름">
    <label class="small muted" for="mem-date" style="display:block;margin-top:12px">돌아가신 날</label>
    <input class="search-box" type="date" id="mem-date" value="${today()}">
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn text" id="mem-cancel">취소</button><button class="btn filled" id="mem-save">넣기</button></div>`, (el) => {
    $('#mem-cancel', el).onclick = closeSheet;
    $('#mem-save', el).onclick = () => {
      const n = $('#mem-name', el).value.trim();
      const d = $('#mem-date', el).value;
      if (!n || !d) return toast('이름과 날짜를 넣어 주세요');
      prefs.addMemorial(n, d);
      closeSheet();
      renderPracticeKeepScroll();
    };
  });
}

// 49재 일정 (돌아가신 날을 첫날로 쳐서 7일째 초재, 49일째 49재)
function memorialsHtml() {
  const t = today();
  return `<div class="card">${prefs.memorials.length ? '' : '<p class="small muted" style="margin-top:0">돌아가신 분의 이름(법명)과 돌아가신 날을 넣으면, 이레마다 올리는 일곱 번의 재 날짜를 계산해 드려요.</p>'}
    ${prefs.memorials.map((mm) => {
      const next = [1, 2, 3, 4, 5, 6, 7].find((n) => jaeDate(mm, n) >= t);
      const [, dm, dd] = mm.date.split('-').map(Number);
      let nextHtml = '<div class="muted">49재를 모두 마쳤어요</div>';
      if (next) {
        const d = jaeDate(mm, next);
        const [, nm, nd] = d.split('-').map(Number);
        const left = daysBetween(t, d);
        nextHtml = `<div class="jae-text"><b>${jaeName(next)} ${nm}월 ${nd}일 ${left ? `(${left}일 뒤)` : '(오늘)'}</b></div>`;
      }
      return `<div class="memorial"><div class="row"><span class="grow"><b>${esc(mm.name)}</b><br><span class="small muted">${dm}월 ${dd}일에 돌아가심</span></span>
        <button class="btn text" data-unmem="${esc(mm.id)}">지우기</button></div>${nextHtml}
        <div class="small muted">${[1, 2, 3, 4, 5, 6, 7].map((n) => { const [, a, b] = jaeDate(mm, n).split('-').map(Number); return `${n}재 ${a}/${b}`; }).join('  ')}</div></div>`;
    }).join('')}
    <button class="btn text" id="mem-add" style="padding-left:0">+ 49재 일정 넣기</button>
    <p class="small muted">재 날 알림은 안드로이드 앱에서 받을 수 있어요. 절이나 지역에 따라 다르게 셀 수 있어요.</p></div>`;
}
// 즐겨찾기한 구절 (수행 탭 아래)
function savedVerses() {
  const saved = [];
  for (const s of sutras) s.sections.forEach((sec, i) => { if (prefs.isBookmarked(`${s.id}/${sec.id}`)) saved.push({ s, sec, i }); });
  if (!saved.length) return '';
  return `<h2 class="section">즐겨찾기</h2>` + saved.map(({ s, sec, i }) =>
    `<a class="card" href="#/read/${s.id}?s=${sec.id}" style="text-decoration:none;color:inherit">
      <div style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(isMantra(sec) ? sec.eumdok : sec.plain)}</div>
      <div class="small muted">${esc(s.title.ko)} ${i + 1}구절${headingKo(sec) ? ' · ' + esc(headingKo(sec)) : ''}</div>
      ${prefs.noteOf(`${s.id}/${sec.id}`) ? `<div class="small" style="color:var(--primary)">메모: ${esc(prefs.noteOf(`${s.id}/${sec.id}`))}</div>` : ''}</a>`).join('');
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
  const text = hanja ? sec.hanja : isMantra(sec) ? sec.eumdok : sec.plain;
  let finished = false;
  // 원고지: 칸 수와 줄 수는 쓰는 영역 크기로 정하고, 구절이 길면 여러 쪽으로 나눈다.
  let grid = { cols: 0, rows: 1, cell: 0, pages: [[]] };
  let page = 0;

  app().innerHTML = `
    <div class="topbar"><button class="btn text" id="close">← 닫기</button>
      <h1 style="font-size:20px">사경 · ${esc(sutra.title.ko)} ${i + 1}/${sutra.sections.length}</h1></div>
    <div class="page" style="padding-top:0;padding-bottom:90px">
      <div class="trace-head">
        <div class="segment"><button data-h="0" class="${hanja ? '' : 'on'}">한글</button><button data-h="1" class="${hanja ? 'on' : ''}">한자</button></div>
        <span class="trace-page muted" id="pageno"></span>
      </div>
      <div class="trace-wrap"><canvas class="trace-bg"></canvas><canvas class="trace-ink"></canvas></div>
    </div>
    <div class="playbar"><div class="inner">
      <button class="btn" id="clear">지우기</button>
      <button class="btn" id="prev">이전</button>
      <button class="btn filled grow" id="done">다 썼어요</button></div></div>`;

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
  const MIN_CELL = 60;

  const updateButtons = () => {
    const last = page >= grid.pages.length - 1;
    $('#pageno').textContent = grid.pages.length > 1 ? `${page + 1}/${grid.pages.length}쪽` : '';
    $('#prev').disabled = i === 0 && page === 0;
    const done = $('#done');
    if (!last) { done.textContent = '다음 쪽'; done.disabled = false; }
    else if (!finished) { done.textContent = '다 썼어요'; done.disabled = false; }
    else { const end = i >= sutra.sections.length - 1; done.textContent = end ? '마지막 구절' : '다음 구절'; done.disabled = end; }
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
      toast('오늘의 수행 기록에 남겼어요');
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
  MAJOR: { '2-8': '출가재일', '2-15': '열반재일', '4-8': '부처님오신날', '7-15': '백중 (우란분절)', '12-8': '성도재일' },
  MONTHLY: { 1: '초하루', 8: '약사재일', 15: '보름', 18: '지장재일', 24: '관음재일' },
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
    return { month, day, leap, label: `음력 ${leap ? '윤' : ''}${month}월 ${day}일` };
  },
  holy(date) {
    const l = this.of(date);
    if (!l) return null;
    if (!l.leap && this.MAJOR[`${l.month}-${l.day}`]) return { name: this.MAJOR[`${l.month}-${l.day}`], major: true };
    return this.MONTHLY[l.day] ? { name: this.MONTHLY[l.day], major: false } : null;
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
      app: '경전함', format: 1, exportedAt: new Date().toISOString(),
      bookmarks: store.get('bookmarks', []).slice().sort(),
      positions: store.get('positions', {}),
      ...(store.get('lastSutra') ? { lastSutra: store.get('lastSutra') } : {}),
      practiceLog: prefs.log.slice().sort(),
      beads: store.get('beads', {}),
      sits: store.get('sits', {}),
      beadCount: b.count, beadTarget: b.target,
      playlists: prefs.playlists, notes: prefs.notes, dedications: prefs.dedications, memorials: store.get('memorials', []),
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
    a.download = `경전함-기록-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  // 지금 기록에 합친다: 수행 기록·즐겨찾기는 합치고, 날짜별 수는 큰 쪽, 설정·위치는 파일 쪽
  merge(j) {
    if (!j || j.app !== '경전함' || !('format' in j)) throw new Error('경전함 백업 파일이 아니에요');
    const union = (a, b) => [...new Set([...(a || []), ...(b || [])])];
    store.set('log', union(prefs.log, j.practiceLog));
    store.set('bookmarks', union(store.get('bookmarks', []), j.bookmarks));
    store.set('positions', { ...store.get('positions', {}), ...(j.positions || {}) });
    if (j.lastSutra) store.set('lastSutra', j.lastSutra);
    for (const key of ['beads', 'sits']) {
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
      if (!confirm('파일의 기록을 지금 기록에 합칩니다. 지금 기록은 지워지지 않고, 설정과 읽던 위치는 파일 쪽을 따릅니다.')) return;
      try { toast(`불러왔어요 (수행 기록 ${this.merge(JSON.parse(await file.text()))}개)`); render(); } catch (e) { toast(e.message || '불러오지 못했어요'); }
    };
    input.click();
  },
};

function renderAbout() {
  // 감수 체크리스트는 주소에 ?review 가 있을 때만 보인다 (일반 사용자에게는 감추기)
  const showReview = new URLSearchParams(location.search).has('review');
  app().innerHTML = `<div class="page">
    <h1 class="title">기록 백업</h1>
    <div class="card"><p class="small muted" style="margin-top:0">수행 기록·즐겨찾기·염주·좌선 기록과 설정은 이 브라우저 안에만 저장돼요. 브라우저 데이터를 지우기 전이나 다른 기기로 옮길 때 파일로 백업해 두세요. 안드로이드 앱과 서로 옮길 수도 있어요.</p>
      <div class="row"><button class="btn" id="backup-save">파일로 내보내기</button><button class="btn" id="backup-load">불러오기</button></div></div>
    <h1 class="title" style="margin-top:28px">경전함에 대하여</h1>
    <p>경전함은 불교 경전을 원문·음독·번역으로 읽고 듣는 앱입니다. 웹 버전은 광고와 서버 없이 모든 내용이 브라우저 안에서 동작합니다. 독송 영상은 불교방송(BBS)·BTN 등 공식 채널이 유튜브에 올린 영상을 유튜브 플레이어로 보여 주며, 영상을 볼 때만 YouTube에 연결합니다.</p>
    <p class="small muted">매일 알림과 홈 화면 위젯은 안드로이드 앱에서 쓸 수 있어요. 이 웹 앱은 브라우저 메뉴의 '홈 화면에 추가'로 설치하면 인터넷 없이도 읽을 수 있어요.</p>
    <div class="notice">번역과 해설은 AI 초안을 바탕으로 새로 옮긴 것으로, 감수를 거쳐 계속 다듬고 있습니다. 독송 음성은 미리 만든 AI 음성(ElevenLabs)입니다. 글꼴: 고운바탕(류양희, <a href="fonts/OFL.txt">SIL Open Font License 1.1</a>). 목탁·종 효과음: 김용배, 한국저작권위원회 <a href="https://gongu.copyright.or.kr/">공유마당</a>(CC BY).</div>
    ${sutras.map((s) => `<div class="card" style="margin-top:12px">
      <b>${esc(s.title.ko)}</b>
      <div class="small">원문: ${esc(s.source.text)}</div>
      <div class="small">${esc(s.source.license)}</div>
      <div class="small">${esc(s.source.translationLicense)}</div>
      ${showReview && s.reviewChecklist.length ? `<div class="small" style="color:var(--primary);margin-top:6px">감수 때 확인할 항목</div>` +
        s.reviewChecklist.slice().sort((a, b) => a.priority - b.priority).map((r) =>
          `<div class="small">${r.priority}. [${s.sections.findIndex((x) => x.id === r.sectionId) + 1}구절] ${esc(r.issue)}</div>`).join('') : ''}
    </div>`).join('')}
    <p class="small muted">설정·즐겨찾기·수행 기록은 이 브라우저에만 저장되며 어디로도 보내지 않습니다.</p>
  </div>`;
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
    app().innerHTML = `<p class="loading">경전 데이터를 읽지 못했습니다<br>${esc(e.message)}</p>`;
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
