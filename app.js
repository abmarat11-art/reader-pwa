/* ============================================================
   app.js — читалка: библиотека, движок страниц, настройки
   ============================================================ */
(function () {
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ====================== настройки ====================== */
const THEMES = [
  { id:'light', name:'Светлый', bg:'#ffffff', fg:'#17171a' },
  { id:'soft',  name:'Мягкий',  bg:'#f6f1e7', fg:'#38322a' },
  { id:'sepia', name:'Сепия',   bg:'#efe0c4', fg:'#4a3a22' },
  { id:'mint',  name:'Мята',    bg:'#e3eee6', fg:'#20352a' },
  { id:'grey',  name:'Серый',   bg:'#3a3d42', fg:'#dcdee3' },
  { id:'night', name:'Ночной',  bg:'#1b1d21', fg:'#c6c9d1' },
  { id:'black', name:'Чёрный',  bg:'#000000', fg:'#a9aeb8' }
];
const FONTS = [
  { id:'ny',    name:'New York',  ff:'ui-serif,"New York",Georgia,serif' },
  { id:'geo',   name:'Georgia',   ff:'Georgia,"Times New Roman",serif' },
  { id:'iowan', name:'Iowan',     ff:'"Iowan Old Style",Georgia,serif' },
  { id:'pal',   name:'Palatino',  ff:'"Palatino Linotype",Palatino,"Book Antiqua",serif' },
  { id:'bask',  name:'Baskerville', ff:'Baskerville,Georgia,serif' },
  { id:'chart', name:'Charter',   ff:'Charter,Georgia,serif' },
  { id:'sf',    name:'San Francisco', ff:'-apple-system,system-ui,BlinkMacSystemFont,sans-serif' },
  { id:'aven',  name:'Avenir',    ff:'"Avenir Next",Avenir,"Helvetica Neue",sans-serif' }
];
const FLIPS = [
  { id:'curl',  name:'Страница' },
  { id:'slide', name:'Сдвиг' },
  { id:'fade',  name:'Плавно' },
  { id:'scroll',name:'Свиток' }
];

const DEF = { theme:'soft', font:'ny', fsize:20, lheight:160, margin:24, justify:true,
  hyphens:true, indent:true, flip:'curl', flipSpeed:520, autoSpeed:12, dim:100 };

let S = Object.assign({}, DEF, JSON.parse(localStorage.getItem('reader.settings') || '{}'));
const saveSettings = () => localStorage.setItem('reader.settings', JSON.stringify(S));

/* ====================== хранилище ====================== */
const DB = (() => {
  let db;
  const open = () => new Promise((res, rej) => {
    if (db) return res(db);
    const r = indexedDB.open('reader-db', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath:'id' });
      if (!d.objectStoreNames.contains('state')) d.createObjectStore('state', { keyPath:'id' });
    };
    r.onsuccess = () => { db = r.result; res(db); };
    r.onerror = () => rej(r.error);
  });
  const tx = async (store, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const rq = fn(t.objectStore(store));
      t.oncomplete = () => res(rq && rq.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    put:    (s, v) => tx(s, 'readwrite', st => st.put(v)),
    get:    (s, k) => tx(s, 'readonly',  st => st.get(k)),
    all:    (s)    => tx(s, 'readonly',  st => st.getAll()),
    del:    (s, k) => tx(s, 'readwrite', st => st.delete(k))
  };
})();

/* ====================== мелкий UI ====================== */
let toastT;
function toast(msg, ms) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms || 2200);
}
const loader = (on, txt) => { $('#loaderTxt').textContent = txt || 'Открываю…'; $('#loader').classList.toggle('show', !!on); };

/* ====================== библиотека ====================== */
async function renderShelf() {
  const books = await DB.all('books');
  books.sort((a, b) => b.addedAt - a.addedAt);
  const shelf = $('#shelf'); shelf.innerHTML = '';
  $('#libEmpty').style.display = books.length ? 'none' : 'block';
  for (const b of books) {
    const st = await DB.get('state', b.id) || { progress:0 };
    const pct = Math.round((st.progress || 0) * 100);
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML =
      '<button class="del" aria-label="Удалить">×</button>' +
      (b.cover ? '<img class="cover" src="' + b.cover + '" alt="">' : '') +
      '<h3></h3><p class="auth"></p>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="pct">' + (pct ? pct + '% · ' : '') + b.chapters.length + ' гл. · ' + b.format.toUpperCase() + '</div>';
    el.querySelector('h3').textContent = b.title;
    el.querySelector('.auth').textContent = b.author || '—';
    el.querySelector('.del').onclick = async e => {
      e.stopPropagation();
      if (!confirm('Удалить «' + b.title + '» из библиотеки?')) return;
      await DB.del('books', b.id); await DB.del('state', b.id); renderShelf();
    };
    el.onclick = () => openBook(b.id);
    shelf.appendChild(el);
  }
}

$('#filePick').onchange = async e => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) {
    loader(true, 'Разбираю «' + f.name + '»…');
    try {
      const book = await Parsers.parseBook(f);
      book.id = 'b' + Date.now() + Math.random().toString(36).slice(2, 7);
      book.addedAt = Date.now();
      // blob-URL обложки в хранилище не живёт — только data:
      if (book.cover && !/^data:/.test(book.cover)) book.cover = null;
      await DB.put('books', book);
      toast('Добавлено: ' + book.title);
    } catch (err) {
      console.error(err);
      toast('Не вышло открыть ' + f.name + ': ' + err.message, 3600);
    }
    loader(false);
  }
  renderShelf();
};

$('#installHint').onclick = () => toast('Safari → «Поделиться» → «На экран «Домой»». Дальше читалка открывается как приложение и работает без интернета.', 5200);

/* ====================== состояние чтения ====================== */
let book = null, ci = 0, pi = 0;
let pages = {};               // ci → число страниц при текущих метриках
let metricsKey = '';
const layers = { prev: $('.page[data-rel="-1"]'), cur: $('.page[data-rel="0"]'), next: $('.page[data-rel="1"]') };
const sv = $('#scrollView');
let W = 0, H = 0, G = 0, PW = 0;

function applyStyleVars() {
  const r = document.documentElement.style;
  const f = FONTS.find(f => f.id === S.font) || FONTS[0];
  r.setProperty('--ff', f.ff);
  r.setProperty('--fs', S.fsize + 'px');
  r.setProperty('--lh', (S.lheight / 100));
  r.setProperty('--align', S.justify ? 'justify' : 'left');
  r.setProperty('--hyp', S.hyphens ? 'auto' : 'manual');
  r.setProperty('--ind', S.indent ? '1.3em' : '0');
  r.setProperty('--pgap', S.indent ? '0em' : '.7em');
  r.setProperty('--pad-h', S.margin + 'px');
  r.setProperty('--pad-v', Math.max(14, S.margin * 0.8) + 'px');
  r.setProperty('--pad-b', (Math.max(14, S.margin * 0.8) + 20) + 'px');
  r.setProperty('--dimv', (S.dim / 100));
  document.body.dataset.theme = S.theme;
  document.body.dataset.flip = S.flip;
  const tm = THEMES.find(t => t.id === S.theme);
  if (tm) { const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = tm.bg; }
}

function measureBox() {
  const vp = $('#viewport');
  PW = vp.clientWidth;
  W = vp.clientWidth - S.margin * 2;
  H = vp.clientHeight - Math.max(14, S.margin * 0.8) * 2 - 20;
  G = Math.max(16, S.margin);
  const key = [W, H, S.font, S.fsize, S.lheight, S.margin, S.justify, S.hyphens, S.indent].join('|');
  if (key !== metricsKey) { metricsKey = key; pages = {}; }
}

function innerOf(layer) {
  let fl = layer.querySelector('.flow');
  let inner = fl.querySelector('.inner');
  if (!inner) { inner = document.createElement('div'); inner.className = 'inner'; fl.appendChild(inner); }
  return inner;
}

/* наполнить слой главой ci и показать страницу p */
function fillLayer(layer, c, p) {
  const inner = innerOf(layer);
  if (layer.dataset.ch !== String(c) || layer.dataset.mk !== metricsKey) {
    inner.innerHTML = (book.chapters[c] || { html:'' }).html;
    layer.dataset.ch = String(c);
    layer.dataset.mk = metricsKey;
    inner.style.cssText = 'width:' + W + 'px;height:' + H + 'px;column-width:' + W +
      'px;column-gap:' + G + 'px;column-fill:auto;transform:translateX(0)';
    const sw = inner.scrollWidth;
    pages[c] = Math.max(1, Math.round((sw + G) / (W + G)));
  }
  const np = pages[c] || 1;
  p = clamp(p, 0, np - 1);
  inner.style.transform = 'translateX(' + (-p * (W + G)) + 'px)';
  layer.dataset.pi = String(p);
  return p;
}

function pagesOf(c) {
  if (pages[c] != null) return pages[c];
  fillLayer(layers.next, c, 0);     // замер на «тыльном» слое
  return pages[c] || 1;
}

/* соседняя позиция через границы глав */
function neighbor(dir) {
  const np = pagesOf(ci);
  if (dir > 0) {
    if (pi + 1 < np) return { c:ci, p:pi + 1 };
    if (ci + 1 < book.chapters.length) return { c:ci + 1, p:0 };
    return null;
  } else {
    if (pi - 1 >= 0) return { c:ci, p:pi - 1 };
    if (ci - 1 >= 0) return { c:ci - 1, p:pagesOf(ci - 1) - 1 };
    return null;
  }
}

function resetTransforms() {
  [layers.prev, layers.cur, layers.next].forEach(l => {
    l.style.transition = 'none';
    l.style.transform = 'none';
    l.style.opacity = '1';
    l.style.filter = 'none';
    l.classList.remove('lift', 'under');
    l.style.removeProperty('--ushade');
    dropBend(l);
  });
  layers.prev.style.zIndex = 1; layers.cur.style.zIndex = 2; layers.next.style.zIndex = 0;
}

function render() {
  if (!book) return;
  if (S.flip === 'scroll') { renderScroll(); return; }
  measureBox();
  pi = fillLayer(layers.cur, ci, pi);
  const nx = neighbor(1), pv = neighbor(-1);
  if (nx) { fillLayer(layers.next, nx.c, nx.p); layers.next.style.visibility = 'visible'; }
  else layers.next.style.visibility = 'hidden';
  if (pv) { fillLayer(layers.prev, pv.c, pv.p); layers.prev.style.visibility = 'visible'; }
  else layers.prev.style.visibility = 'hidden';
  resetTransforms();
  updateStatus();
  saveProgress();
  scheduleBend();
}

function renderScroll() {
  measureBox();
  const inner = innerOf(sv);
  if (sv.dataset.ch !== String(ci)) {
    inner.innerHTML = book.chapters[ci].html;
    inner.style.cssText = '';
    sv.dataset.ch = String(ci);
    sv.scrollTop = 0;
  }
  updateStatus();
  saveProgress();
}

function globalProgress() {
  const n = book.chapters.length;
  if (S.flip === 'scroll') {
    const max = sv.scrollHeight - sv.clientHeight;
    const f = max > 0 ? sv.scrollTop / max : 0;
    return clamp((ci + f) / n, 0, 1);
  }
  const np = pagesOf(ci);
  return clamp((ci + (np > 1 ? pi / (np - 1 || 1) : 0)) / n, 0, 1);
}

function updateStatus() {
  const np = pages[ci] || 1;
  $('#stChapter').textContent = (book.chapters[ci].title || '').slice(0, 42);
  $('#stPage').textContent = (pi + 1) + ' / ' + np;
  const g = globalProgress();
  $('#seek').value = Math.round(g * 1000);
  $('#hudPos').textContent = Math.round(g * 100) + '%';
  $('#hudTitle').textContent = book.title;
}

let saveT;
function saveProgress() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    DB.put('state', { id:book.id, ci, pi, progress:globalProgress(),
      scroll: S.flip === 'scroll' ? sv.scrollTop : 0 });
  }, 400);
}

/* ====================== переход страниц ====================== */
let animating = false;

function go(dir) {
  if (animating || !book) return;
  if (S.flip === 'scroll') { scrollPage(dir); return; }
  const t = neighbor(dir);
  if (!t) { toast(dir > 0 ? 'Это конец книги' : 'Это начало книги', 1200); return; }
  animate(dir, 1, () => { ci = t.c; pi = t.p; render(); });
}

/* ====================== мягкий лист ======================
   Страница в режиме «Страница» не поворачивается целиком как доска:
   она разрезана на вертикальные полоски, каждая повёрнута на свой угол
   и поставлена встык к предыдущей. Получается изогнутая поверхность —
   у корешка лист почти плоский, к свободному краю загибается сильнее.
   Освещение считается по углу полоски: лицо темнеет, уходя от нас,
   изнанка светлеет, разворачиваясь к нам.                              */

const STRIPS = 14;        // полосок на страницу
const BEND   = 0.80;      // насколько сильно лист гнётся в середине хода
const ZS     = 0.42;      // насколько лист поднимается к читателю (1 — «физически», но слишком)
const smooth = t => t * t * (3 - 2 * t);

function buildBend(layer) {
  dropBend(layer);
  const paper = layer.querySelector('.paper');
  const rig = document.createElement('div');
  rig.className = 'bend';
  const sw = PW / STRIPS;
  for (let i = 0; i < STRIPS; i++) {
    const st = document.createElement('div');
    st.className = 'strip';
    st.style.width = (sw + 1.4) + 'px';           // нахлёст, чтобы не было щелей
    const face = document.createElement('div');
    face.className = 'face';
    const sheet = document.createElement('div');
    sheet.className = 'leaf';
    sheet.style.width = PW + 'px';
    sheet.style.left = (-i * sw) + 'px';
    sheet.appendChild(paper.cloneNode(true));
    face.appendChild(sheet);
    const shade = document.createElement('div'); shade.className = 'shade';
    face.appendChild(shade);
    // изнанка: та же страница просвечивает сквозь бумагу зеркально и еле-еле
    const back = document.createElement('div'); back.className = 'back';
    const bleaf = document.createElement('div');
    bleaf.className = 'leaf through';
    bleaf.style.width = PW + 'px';
    bleaf.style.left = (-i * sw) + 'px';
    bleaf.appendChild(paper.cloneNode(true));
    back.appendChild(bleaf);
    const bshade = document.createElement('div'); bshade.className = 'shade';
    back.appendChild(bshade);
    st.append(face, back);
    rig.appendChild(st);
    st._shade = shade; st._bshade = bshade;
  }
  layer.appendChild(rig);
  layer._strips = [...rig.children];
  applyBend(layer, 0);
}

function dropBend(layer) {
  const rig = layer.querySelector('.bend');
  if (rig) rig.remove();
  layer._strips = null;
  layer.classList.remove('bending');
}

/* q: 0 — лист на месте, 1 — лист перевёрнут налево */
function applyBend(layer, q) {
  const strips = layer._strips;
  if (!strips) return;
  const n = strips.length, L = PW / n;
  const A = Math.PI * q;
  const soft = BEND * Math.pow(Math.sin(Math.PI * q), 1.2) * (1 - 0.3 * q);
  let x = 0, z = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / n;
    const a = A * ((1 - soft) + soft * smooth(t));
    const st = strips[i];
    st.style.transform = 'translate3d(' + x.toFixed(2) + 'px,0,' + z.toFixed(2) + 'px) rotateY(' + (-a * 180 / Math.PI).toFixed(2) + 'deg)';
    const c = Math.cos(a);
    st._shade.style.opacity  = (0.34 * (1 - c) / 2).toFixed(3);
    st._bshade.style.opacity = (0.30 * (1 + c) / 2 + 0.06).toFixed(3);
    x += L * Math.cos(a);
    z += L * Math.sin(a) * ZS;
  }
}

let bendIdle = [];
function scheduleBend() {
  bendIdle.forEach(id => { if (window.cancelIdleCallback) window.cancelIdleCallback(id); else clearTimeout(id); });
  bendIdle = [];
  if (S.flip !== 'curl' || !book) return;
  const idle = window.requestIdleCallback || (f => setTimeout(f, 80));
  [layers.cur, layers.prev].forEach((l, i) => {
    bendIdle.push(idle(() => {
      if (S.flip === 'curl' && book && !l._strips && l.style.visibility !== 'hidden') buildBend(l);
    }, { timeout: 400 + i * 200 }));
  });
}

/* dir: 1 вперёд, -1 назад; to — куда довести (0..1), fromP — откуда */
function animate(dir, to, done, fromP) {
  prepareDrag(dir);
  const from = fromP == null ? (dir > 0 ? 0 : 1) : fromP;
  runFlip(dir, from, to, done);
}

/* собственная докрутка кадрами: CSS-переход не умеет вести изогнутый лист */
let flipRAF = 0;
function runFlip(dir, from, to, done) {
  animating = true;
  cancelAnimationFrame(flipRAF);
  const dist = Math.abs(to - from);
  const dur = Math.max(130, Math.round(S.flipSpeed * (0.4 + 0.6 * dist)));
  const t0 = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 3);       // мягкое торможение
  const tick = now => {
    const t = Math.min(1, (now - t0) / dur);
    applyDrag(dir, from + (to - from) * ease(t));
    if (t < 1) { flipRAF = requestAnimationFrame(tick); return; }
    animating = false;
    done && done();
  };
  flipRAF = requestAnimationFrame(tick);
}

function prepareDrag(dir) {
  const moving = dir > 0 ? layers.cur : layers.prev;
  const under  = dir > 0 ? layers.next : layers.cur;
  moving.style.transition = 'none';
  under.style.transition = 'none';
  moving.style.zIndex = 3; under.style.zIndex = 2;
  (dir > 0 ? layers.prev : layers.next).style.zIndex = 0;
  if (S.flip === 'curl') {
    if (!moving._strips) buildBend(moving);
    moving.classList.add('bending');
    under.classList.add('under');
  } else {
    moving.classList.add('lift');
  }
  applyDrag(dir, dir > 0 ? 0 : 1);
}

/* p: 0 — исходное, 1 — страница перевёрнута */
function applyDrag(dir, p) {
  const moving = dir > 0 ? layers.cur : layers.prev;
  const under  = dir > 0 ? layers.next : layers.cur;
  const q = clamp(p, 0, 1);
  if (S.flip === 'curl') {
    applyBend(moving, q);
    under.style.setProperty('--ushade', (0.4 * Math.sin(Math.PI * q)).toFixed(3));
  } else if (S.flip === 'slide') {
    moving.style.transform = 'translateX(' + (-q * W - q * G) + 'px)';
    moving.style.filter = 'none';
    moving.style.opacity = '1';
  } else { // fade
    moving.style.transform = 'scale(' + (1 - 0.03 * q) + ')';
    moving.style.filter = 'none';
    moving.style.opacity = String(1 - q);
  }
}

/* ====================== жесты ====================== */
let drag = null;
const vp = $('#viewport');

vp.addEventListener('touchstart', e => {
  if (S.flip === 'scroll' || animating || !book) return;
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  drag = { x0:t.clientX, y0:t.clientY, t0:Date.now(), dir:0, moved:false };
}, { passive:true });

vp.addEventListener('touchmove', e => {
  if (!drag || animating) return;
  const t = e.touches[0];
  const dx = t.clientX - drag.x0, dy = t.clientY - drag.y0;
  if (!drag.moved) {
    if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
    drag.dir = dx < 0 ? 1 : -1;
    const n = neighbor(drag.dir);
    if (!n) { drag = null; return; }
    drag.moved = true;
    prepareDrag(drag.dir);
    drag.target = n;
  }
  e.preventDefault();
  const span = S.flip === 'curl' ? PW : (W + G);
  const raw = drag.dir > 0 ? -dx / span : dx / span;
  const p = drag.dir > 0 ? clamp(raw, 0, 1) : clamp(1 - raw, 0, 1);
  drag.p = p;
  if (!drag.raf) drag.raf = requestAnimationFrame(() => {
    if (!drag) return;
    drag.raf = 0;
    applyDrag(drag.dir, drag.p);
  });
}, { passive:false });

vp.addEventListener('touchend', () => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.raf) cancelAnimationFrame(d.raf);
  if (!d.moved) return;
  const travelled = d.dir > 0 ? d.p : 1 - d.p;
  const fast = (Date.now() - d.t0) < 260 && travelled > 0.08;
  const commit = travelled > 0.3 || fast;
  const end = d.dir > 0 ? (commit ? 1 : 0) : (commit ? 0 : 1);
  runFlip(d.dir, d.p, end, () => {
    if (commit) { ci = d.target.c; pi = d.target.p; }
    render();
  });
}, { passive:true });

/* тапы */
$('#tapLeft').onclick  = () => go(-1);
$('#tapRight').onclick = () => go(1);
$('#tapMid').onclick   = () => toggleHud();

/* ====================== свиток и автопрокрутка ====================== */
function scrollPage(dir) {
  const step = sv.clientHeight * 0.9 * dir;
  sv.scrollBy({ top:step, behavior:'smooth' });
}

sv.addEventListener('scroll', () => {
  if (!book) return;
  const max = sv.scrollHeight - sv.clientHeight;
  if (sv.scrollTop >= max - 2 && ci + 1 < book.chapters.length && !svLock) {
    svLock = true;
    ci++; sv.dataset.ch = ''; renderScroll();
    setTimeout(() => svLock = false, 400);
  } else if (sv.scrollTop <= 0 && ci > 0 && !svLock && autoOn === false && lastScrollDir < 0) {
    svLock = true;
    ci--; sv.dataset.ch = ''; renderScroll();
    sv.scrollTop = sv.scrollHeight;
    setTimeout(() => svLock = false, 400);
  }
  lastScrollDir = sv.scrollTop - lastScrollTop; lastScrollTop = sv.scrollTop;
  updateStatus(); saveProgress();
}, { passive:true });
let svLock = false, lastScrollTop = 0, lastScrollDir = 0;

let autoOn = false, autoRaf = 0, autoLast = 0, autoAcc = 0;
function autoStart() {
  if (!book) return;
  if (S.flip !== 'scroll') {
    S.flip = 'scroll'; saveSettings(); applyStyleVars(); syncSheet();
    sv.dataset.ch = ''; renderScroll();
    toast('Включил «Свиток» — автопрокрутка работает в нём');
  }
  autoOn = true; autoLast = 0; autoAcc = 0;
  $('#autoBar').classList.add('show');
  $('#autoBtn').textContent = '❚❚';
  hud(false);
  const tick = ts => {
    if (!autoOn) return;
    if (autoLast) {
      const lh = S.fsize * (S.lheight / 100);
      autoAcc += lh * S.autoSpeed / 60000 * (ts - autoLast);
      if (autoAcc >= 1) {
        const px = Math.floor(autoAcc); autoAcc -= px;
        const before = sv.scrollTop;
        sv.scrollTop = before + px;
        if (sv.scrollTop === before) { // конец главы
          if (ci + 1 < book.chapters.length) { ci++; sv.dataset.ch = ''; renderScroll(); }
          else { autoStop(); toast('Книга дочитана'); return; }
        }
      }
    }
    autoLast = ts;
    autoRaf = requestAnimationFrame(tick);
  };
  autoRaf = requestAnimationFrame(tick);
}
function autoStop() {
  autoOn = false; cancelAnimationFrame(autoRaf);
  $('#autoBar').classList.remove('show');
  $('#autoBtn').textContent = '▶';
}
$('#autoBtn').onclick = () => autoOn ? autoStop() : autoStart();
$('#autoStop').onclick = autoStop;
const speedLabel = () => $('#autoVal').textContent = S.autoSpeed + ' стр/мин';
$('#autoSpeed').oninput = e => { S.autoSpeed = +e.target.value; $('#autoSpeed2').value = S.autoSpeed; speedLabel(); saveSettings(); };
$('#autoSpeed2').oninput = e => { S.autoSpeed = +e.target.value; $('#autoSpeed').value = S.autoSpeed; speedLabel(); saveSettings(); };

/* ====================== HUD, листы ====================== */
let hudT;
function hud(on) {
  $('#hud').classList.toggle('show', !!on);
  clearTimeout(hudT);
  if (on) hudT = setTimeout(() => $('#hud').classList.remove('show'), 4200);
}
const toggleHud = () => hud(!$('#hud').classList.contains('show'));

$('#backBtn').onclick = () => { autoStop(); document.body.dataset.screen = 'library'; renderShelf(); };
$('#setBtn').onclick = () => { $('#sheetWrap').classList.add('show'); hud(false); };
$('#sheetClose').onclick = () => $('#sheetWrap').classList.remove('show');
$('#sheetWrap').onclick = e => { if (e.target.id === 'sheetWrap') $('#sheetWrap').classList.remove('show'); };
$('#tocClose').onclick = () => $('#tocWrap').classList.remove('show');
$('#tocWrap').onclick = e => { if (e.target.id === 'tocWrap') $('#tocWrap').classList.remove('show'); };
$('#tocBtn').onclick = () => {
  const list = $('#tocList'); list.innerHTML = '';
  book.chapters.forEach((c, i) => {
    const a = document.createElement('a');
    a.textContent = c.title || 'Глава ' + (i + 1);
    if (i === ci) a.className = 'on';
    const sp = document.createElement('span');
    sp.textContent = 'Глава ' + (i + 1);
    a.appendChild(sp);
    a.onclick = () => {
      $('#tocWrap').classList.remove('show');
      ci = i; pi = 0; sv.dataset.ch = ''; render(); hud(false);
    };
    list.appendChild(a);
  });
  $('#tocWrap').classList.add('show');
  hud(false);
};
$$('.sheet-tabs .tab').forEach(t => t.onclick = () => {
  $$('.sheet-tabs .tab').forEach(x => x.classList.toggle('active', x === t));
  $$('.tabpane').forEach(p => p.classList.toggle('active', p.dataset.pane === t.dataset.tab));
});

$('#seek').oninput = e => {
  if (!book) return;
  const g = +e.target.value / 1000;
  const n = book.chapters.length;
  let c = clamp(Math.floor(g * n), 0, n - 1);
  const frac = g * n - c;
  ci = c;
  if (S.flip === 'scroll') {
    sv.dataset.ch = ''; renderScroll();
    sv.scrollTop = (sv.scrollHeight - sv.clientHeight) * frac;
  } else {
    pi = 0; render();
    pi = clamp(Math.round(frac * ((pages[ci] || 1) - 1)), 0, (pages[ci] || 1) - 1);
    render();
  }
  hud(true);
};

/* ====================== панель настроек ====================== */
function buildSheet() {
  const th = $('#themes'); th.innerHTML = '';
  THEMES.forEach(t => {
    const b = document.createElement('button');
    b.className = 'swatch' + (S.theme === t.id ? ' on' : '');
    b.style.background = t.bg; b.style.color = t.fg;
    b.textContent = t.name; b.dataset.id = t.id;
    b.onclick = () => { S.theme = t.id; saveSettings(); applyStyleVars(); syncSheet(); };
    th.appendChild(b);
  });
  const fo = $('#fonts'); fo.innerHTML = '';
  FONTS.forEach(f => {
    const b = document.createElement('button');
    b.className = 'fontbtn' + (S.font === f.id ? ' on' : '');
    b.style.fontFamily = f.ff; b.textContent = f.name; b.dataset.id = f.id;
    b.onclick = () => { S.font = f.id; saveSettings(); applyStyleVars(); syncSheet(); relayout(); };
    fo.appendChild(b);
  });
  const fm = $('#flipModes'); fm.innerHTML = '';
  FLIPS.forEach(f => {
    const b = document.createElement('button');
    b.className = (S.flip === f.id ? 'on' : ''); b.textContent = f.name; b.dataset.id = f.id;
    b.onclick = () => {
      autoStop();
      S.flip = f.id; saveSettings(); applyStyleVars(); syncSheet();
      sv.dataset.ch = ''; metricsKey = ''; render();
    };
    fm.appendChild(b);
  });
}
function syncSheet() {
  $$('#themes .swatch').forEach(b => b.classList.toggle('on', b.dataset.id === S.theme));
  $$('#fonts .fontbtn').forEach(b => b.classList.toggle('on', b.dataset.id === S.font));
  $$('#flipModes button').forEach(b => b.classList.toggle('on', b.dataset.id === S.flip));
  $('#fsize').value = S.fsize; $('#lheight').value = S.lheight; $('#margin').value = S.margin;
  $('#justify').checked = S.justify; $('#hyphens').checked = S.hyphens; $('#indent').checked = S.indent;
  $('#flipSpeed').value = S.flipSpeed; $('#dim').value = S.dim;
  $('#autoSpeed').value = S.autoSpeed; $('#autoSpeed2').value = S.autoSpeed;
  speedLabel();
}
let relayoutT;
function relayout() {
  clearTimeout(relayoutT);
  relayoutT = setTimeout(() => {
    if (!book) return;
    const g = globalProgress();
    metricsKey = ''; pages = {};
    [layers.prev, layers.cur, layers.next].forEach(l => l.dataset.ch = '');
    if (S.flip === 'scroll') { renderScroll(); }
    else {
      measureBox();
      const np = pagesOf(ci);
      const n = book.chapters.length;
      const frac = clamp(g * n - ci, 0, 1);
      pi = clamp(Math.round(frac * (np - 1)), 0, np - 1);
      render();
    }
  }, 60);
}
const bind = (sel, key, after) => $(sel).oninput = e => {
  S[key] = +e.target.value; saveSettings(); applyStyleVars(); after && after();
};
bind('#fsize', 'fsize', relayout);
bind('#lheight', 'lheight', relayout);
bind('#margin', 'margin', relayout);
bind('#flipSpeed', 'flipSpeed');
bind('#dim', 'dim');
['justify', 'hyphens', 'indent'].forEach(k => $('#' + k).onchange = e => {
  S[k] = e.target.checked; saveSettings(); applyStyleVars(); relayout();
});

/* ====================== открыть книгу ====================== */
async function openBook(id) {
  loader(true, 'Открываю…');
  book = await DB.get('books', id);
  if (!book) { loader(false); return toast('Книга не найдена'); }
  const st = await DB.get('state', id) || { ci:0, pi:0 };
  ci = clamp(st.ci || 0, 0, book.chapters.length - 1); pi = st.pi || 0;
  document.body.dataset.screen = 'reader';
  applyStyleVars();
  metricsKey = ''; pages = {};
  [layers.prev, layers.cur, layers.next].forEach(l => l.dataset.ch = '');
  sv.dataset.ch = '';
  requestAnimationFrame(() => {
    render();
    if (S.flip === 'scroll' && st.scroll) sv.scrollTop = st.scroll;
    loader(false);
    hud(true);
  });
}

/* ====================== служебное ====================== */
window.addEventListener('resize', relayout);
window.addEventListener('orientationchange', () => setTimeout(relayout, 300));
document.addEventListener('visibilitychange', () => { if (document.hidden) autoStop(); });
document.addEventListener('gesturestart', e => e.preventDefault());
window.addEventListener('keydown', e => {
  if (document.body.dataset.screen !== 'reader') return;
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(1); }
  if (e.key === 'ArrowLeft') go(-1);
  if (e.key === 'Escape') $('#backBtn').click();
});

applyStyleVars();
buildSheet();
syncSheet();
renderShelf();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
})();
