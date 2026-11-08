'use strict';

/* ================= 1024 · ARCADE 游戏逻辑 ================= */

// ---------- DOM 引用 ----------
const board = document.getElementById('board');
const cellsBox = document.getElementById('cells');
const tilesBox = document.getElementById('tiles');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const ovTitle = document.getElementById('ovTitle');
const ovSub = document.getElementById('ovSub');
const ovContinue = document.getElementById('ovContinue');
const ovNew = document.getElementById('ovNew');
const sizeSeg = document.getElementById('sizeSeg');
const btnNew = document.getElementById('btnNew');
const btnSound = document.getElementById('btnSound');

// ---------- 状态 ----------
let size = 4;              // 棋盘规格 4 或 5
let grid = [];             // grid[r][c] -> 方块对象 | null
let score = 0;
let best = 0;
let over = false;          // 无路可走
let won = false;           // 拼出过 1024
let keepPlaying = false;   // 胜利后选择继续
let lock = false;          // 动画期间锁定输入
let uid = 0;
let gen = 0;               // 局号：换局后旧动画定时器全部失效
let soundOn = localStorage.getItem('a1024-sound') !== '0';

const bestKey = () => 'a1024-best-' + size;

// ---------- 音效（WebAudio 芯片音） ----------
let actx = null;
function tone(freq, dur = 0.08, type = 'square', gain = 0.04, when = 0) {
  if (!soundOn) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = actx.createOscillator();
    const g = actx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(g);
    g.connect(actx.destination);
    const t = actx.currentTime + when;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start(t);
    osc.stop(t + dur);
  } catch (e) { /* 音频不可用时静默 */ }
}
const sndMove = () => tone(140, .05, 'triangle', .025);
const sndMerge = (v, i = 0) => tone(200 + Math.log2(v) * 60, .1, 'square', .045, i * .06);
const sndClick = () => tone(660, .04, 'square', .03);
const sndWin = () => [523, 659, 784, 1046].forEach((f, i) => tone(f, .12, 'square', .05, i * .09));
const sndLose = () => { tone(220, .2, 'sawtooth', .04); tone(110, .35, 'sawtooth', .04, .18); };

// ---------- 初始化 / 新局 ----------
function setup() {
  gen++;
  board.dataset.n = size;
  board.style.setProperty('--n', size);

  cellsBox.innerHTML = '';
  for (let i = 0; i < size * size; i++) {
    cellsBox.appendChild(document.createElement('div')).className = 'cell';
  }
  tilesBox.innerHTML = '';
  grid = Array.from({ length: size }, () => Array(size).fill(null));

  score = 0;
  over = false;
  won = false;
  keepPlaying = false;
  lock = false;
  best = parseInt(localStorage.getItem(bestKey()), 10) || 0;
  bestEl.textContent = best;
  scoreEl.textContent = 0;
  hideOverlay();

  spawnRandom();
  spawnRandom();
}

function spawnRandom() {
  const empty = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!grid[r][c]) empty.push([r, c]);
    }
  }
  if (!empty.length) return;
  const [r, c] = empty[Math.floor(Math.random() * empty.length)];
  const v = Math.random() < 0.85 ? 2 : 4;
  createTile(r, c, v);
}

function createTile(r, c, v) {
  const t = { id: ++uid, value: v, r, c, el: null, merged: false };
  const el = document.createElement('div');
  el.className = 'tile spawn ' + valClass(v);
  el.dataset.len = String(v).length;
  el.textContent = v;
  setPos({ ...t, el });
  t.el = el;
  grid[r][c] = t;
  tilesBox.appendChild(el);
  setTimeout(() => el.classList.remove('spawn'), 220);
  return t;
}

const valClass = v => 'val-' + (v <= 1024 ? v : 'super');
const setPos = t => {
  t.el.style.setProperty('--r', t.r);
  t.el.style.setProperty('--c', t.c);
};
function setFace(t) {
  t.el.textContent = t.value;
  t.el.dataset.len = String(t.value).length;
  t.el.className = 'tile ' + valClass(t.value);
}

// ---------- 核心移动 ----------
function move(dr, dc) {
  if (lock || over || overlay.classList.contains('show')) return;

  const g = gen;
  let moved = false;
  let gained = 0;
  const absorbed = [];   // 被吞并方块的元素（滑动结束后移除）
  const upgraded = [];   // 合并后的幸存方块（滑动结束后升级 + 弹跳）

  for (const row of grid) for (const t of row) if (t) t.merged = false;

  // 靠墙一侧的方块先处理
  const rows = [...Array(size).keys()];
  const cols = [...Array(size).keys()];
  if (dr === 1) rows.reverse();
  if (dc === 1) cols.reverse();

  for (const r of rows) {
    for (const c of cols) {
      const t = grid[r][c];
      if (!t) continue;

      // 沿方向滑到最远的空格
      let nr = r, nc = c;
      while (true) {
        const ar = nr + dr, ac = nc + dc;
        if (ar < 0 || ar >= size || ac < 0 || ac >= size || grid[ar][ac]) break;
        nr = ar; nc = ac;
      }
      // 再看下一格能否合并
      const ar = nr + dr, ac = nc + dc;
      const target = (ar >= 0 && ar < size && ac >= 0 && ac < size) ? grid[ar][ac] : null;

      if (target && target.value === t.value && !target.merged) {
        grid[r][c] = null;
        grid[target.r][target.c] = t;
        t.r = target.r; t.c = target.c;
        t.merged = true;
        t.pending = t.value * 2;
        absorbed.push(target.el);
        upgraded.push(t);
        gained += t.pending;
        floater(t.r, t.c, '+' + t.pending);
        setPos(t);
        moved = true;
      } else if (nr !== r || nc !== c) {
        grid[r][c] = null;
        grid[nr][nc] = t;
        t.r = nr; t.c = nc;
        setPos(t);
        moved = true;
      }
    }
  }

  if (!moved) return;
  lock = true;

  setTimeout(() => {           // 滑动结束：吞并 + 升级 + 弹跳
    if (g !== gen) return;
    absorbed.forEach(el => el.remove());
    upgraded.forEach((t, i) => {
      t.value = t.pending;
      delete t.pending;
      setFace(t);
      void t.el.offsetWidth;   // 重启动画
      t.el.classList.add('pop');
      sndMerge(t.value, i);
    });
  }, 120);

  setTimeout(() => {           // 生成新方块 + 终局判定
    if (g !== gen) return;
    spawnRandom();
    lock = false;
    if (gained) addScore(gained); else sndMove();
    checkEnd();
  }, 150);
}

function floater(r, c, text) {
  const f = document.createElement('div');
  f.className = 'floater';
  f.textContent = text;
  f.style.setProperty('--r', r);
  f.style.setProperty('--c', c);
  tilesBox.appendChild(f);
  setTimeout(() => f.remove(), 750);
}

function addScore(g) {
  score += g;
  scoreEl.textContent = score;
  bump(scoreEl);
  if (score > best) {
    best = score;
    bestEl.textContent = best;
    localStorage.setItem(bestKey(), best);
    bump(bestEl);
  }
}
function bump(el) {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

// ---------- 胜负判定 ----------
function hasValue(v) {
  for (const row of grid) for (const t of row) if (t && t.value === v) return true;
  return false;
}
function canMove() {
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const t = grid[r][c];
      if (!t) return true;
      if (r + 1 < size && grid[r + 1][c] && grid[r + 1][c].value === t.value) return true;
      if (c + 1 < size && grid[r][c + 1] && grid[r][c + 1].value === t.value) return true;
    }
  }
  return false;
}
function checkEnd() {
  if (!keepPlaying && !won && hasValue(1024)) {
    won = true;
    sndWin();
    showOverlay('win', '★ YOU WIN ★', '拼出了 1024！');
    return;
  }
  if (!canMove()) {
    over = true;
    sndLose();
    showOverlay('lose', 'GAME OVER', '没有可移动的方块了');
  }
}

function showOverlay(type, title, sub) {
  overlay.classList.remove('win', 'lose');
  overlay.classList.add('show', type);
  ovTitle.textContent = title;
  ovSub.textContent = sub;
  ovContinue.hidden = type !== 'win';
  ovNew.textContent = type === 'win' ? '新游戏' : '再来一局';
}
function hideOverlay() {
  overlay.classList.remove('show', 'win', 'lose');
}

// ---------- 输入：键盘 ----------
const KEYMAP = {
  arrowup: [-1, 0], w: [-1, 0],
  arrowdown: [1, 0], s: [1, 0],
  arrowleft: [0, -1], a: [0, -1],
  arrowright: [0, 1], d: [0, 1],
};
document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (KEYMAP[k]) {
    e.preventDefault();
    move(...KEYMAP[k]);
  } else if (k === 'r') {
    newGame();
  }
});

// ---------- 输入：触摸滑动 ----------
let touchStart = null;
board.addEventListener('touchstart', e => {
  touchStart = e.changedTouches[0];
}, { passive: true });
board.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
board.addEventListener('touchend', e => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.clientX;
  const dy = t.clientY - touchStart.clientY;
  touchStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
  if (Math.abs(dx) > Math.abs(dy)) move(0, dx > 0 ? 1 : -1);
  else move(dy > 0 ? 1 : -1, 0);
});

// ---------- 按钮 ----------
function newGame() {
  sndClick();
  setup();
}
btnNew.addEventListener('click', newGame);
ovNew.addEventListener('click', newGame);
ovContinue.addEventListener('click', () => {
  keepPlaying = true;
  sndClick();
  hideOverlay();
});

sizeSeg.addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  const n = parseInt(btn.dataset.size, 10);
  if (n === size) return;
  sndClick();
  size = n;
  localStorage.setItem('a1024-size', size);
  sizeSeg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', +b.dataset.size === size));
  setup();
});

function renderSound() {
  btnSound.textContent = soundOn ? '♪ ON' : '♪ OFF';
}
btnSound.addEventListener('click', () => {
  soundOn = !soundOn;
  localStorage.setItem('a1024-sound', soundOn ? '1' : '0');
  renderSound();
  sndClick();
});

// ---------- 启动 ----------
size = parseInt(localStorage.getItem('a1024-size'), 10) === 5 ? 5 : 4;
sizeSeg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', +b.dataset.size === size));
renderSound();
setup();
