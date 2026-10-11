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
  hyphens:true, indent:true, flip:'curl', flipSpeed:520, autoPct:25, dim:100 };

let S = Object.assign({}, DEF, JSON.parse(localStorage.getItem('reader.settings') || '{}'));
delete S.autoSpeed;                       // старая шкала строк/мин больше не используется
/* Шкала автопрокрутки. 0 % — на 30 % медленнее прежнего минимума (Марат просил
   растянуть низ), 100 % — вчетверо быстрее прежнего минимума. */
const AUTO_BASE = 40, AUTO_MIN = 0.7, AUTO_MAX = 4;
const autoLines = () => AUTO_BASE * (AUTO_MIN + (AUTO_MAX - AUTO_MIN) * clamp(S.autoPct, 0, 100) / 100);
const saveSettings = () => localStorage.setItem('reader.settings', JSON.stringify(S));
/* прежнее значение переводим в новую шкалу один раз, чтобы скорость не прыгнула */
if (!S.spd3) {
  const was = 1 + 3 * clamp(S.autoPct, 0, 100) / 100;          // во сколько раз быстрее базы
  S.autoPct = Math.round(clamp((was - AUTO_MIN) / (AUTO_MAX - AUTO_MIN) * 100, 0, 100));
  S.spd3 = true; saveSettings();
}

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
      // одна и та же книга, добавленная заново, должна лечь поверх старой,
      // иначе закладка остаётся у прежней записи, а читаешь ты новую
      book.key = [book.title, book.author, f.size].join('|');
      const twin = (await DB.all('books')).find(b => b.key === book.key);
      book.id = twin ? twin.id : 'b' + Date.now() + Math.random().toString(36).slice(2, 7);
      book.addedAt = twin ? twin.addedAt : Date.now();
      // blob-URL обложки в хранилище не живёт — только data:
      if (book.cover && !/^data:/.test(book.cover)) book.cover = null;
      await DB.put('books', book);
      toast((twin ? 'Обновил: ' : 'Добавлено: ') + book.title);
    } catch (err) {
      console.error(err);
      toast('Не вышло открыть ' + f.name + ': ' + err.message, 3600);
    }
    loader(false);
  }
  renderShelf();
};

$('#installHint').onclick = () => toast('Safari → «Поделиться» → «На экран «Домой»». Дальше читалка открывается как приложение и работает без интернета.', 5200);

/* ====================== состояние чтения ======================
   Книга — один сплошной поток. Главы склеены в <section class="ch">,
   нумерация страниц сквозная по всей книге: страница не обязана начинаться
   с главы, и граница глав ничем не отличается от любой другой строки.
   Оглавление остаётся: у каждой главы известны её страница и смещение. */
let book = null, ci = 0, pi = 0;         // pi — сквозной номер страницы книги
let total = 1;                            // всего страниц при текущих метриках
let chHTML = [];                           // главы как куски разметки
let chMeta = [];                           // по главам: { page, top } в постраничной вёрстке
let svMeta = null;
let ciHint = null;                         // куда шли из оглавления                         // по главам: смещение в свитке, px
let measured = false;
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
  if (key !== metricsKey) { metricsKey = key; measured = false; svMeta = null; }
}

function innerOf(layer) {
  let fl = layer.querySelector('.flow');
  let inner = fl.querySelector('.inner');
  if (!inner) { inner = document.createElement('div'); inner.className = 'inner'; fl.appendChild(inner); }
  return inner;
}

function buildFlow() {
  /* Перед каждой главой — пустая метка нулевой высоты. По ней мы узнаём,
     где глава начинается: у самой главы, разрезанной колонками, прямоугольник
     склеен из кусков, и верх по нему не прочитать. */
  chHTML = book.chapters.map((c, i) =>
    '<div class="chm" data-ci="' + i + '"></div>' +
    '<section class="ch" data-ci="' + i + '">' + (c.html || '') + '</section>');
  chMeta = []; svMeta = null; measured = false;
}

const colCss = () => 'width:' + W + 'px;height:' + H + 'px;column-width:' + W +
  'px;column-gap:' + G + 'px;column-fill:auto;transform:translateX(0)';

/* первый фрагмент элемента: у разрезанного колонками блока
   getBoundingClientRect склеивает все куски, нам нужен самый первый */
function firstRect(el) {
  const rs = el.getClientRects();
  return rs.length ? rs[0] : el.getBoundingClientRect();
}

/* метки начала глав — они не разрезаются, их место точно */
const chMarks = root => [...root.querySelectorAll('.chm')];

/* Полная вёрстка книги один раз на набор метрик: сквозное число страниц
   и место каждой главы. Считаем на «тыльном» слое — его всё равно перезальём. */
function measurePages() {
  if (measured) return;
  const inner = innerOf(layers.next);
  inner.innerHTML = chHTML.join('');
  inner.style.cssText = colCss();
  layers.next.dataset.win = 'master';
  const ir = inner.getBoundingClientRect();
  total = Math.max(1, Math.round((inner.scrollWidth + G) / (W + G)));
  chMeta = chMarks(inner).map(m => {
    const r = m.getBoundingClientRect();
    return {
      page: clamp(Math.round((r.left - ir.left) / (W + G)), 0, total - 1),
      top: Math.max(0, Math.round(r.top - ir.top))
    };
  });
  if (!chMeta.length) chMeta = [{ page:0, top:0 }];
  measured = true;
  watchFonts();
  watchImages(inner);
}

/* Шрифт в момент первой вёрстки может быть ещё не готов — тогда строки шире
   или уже, и разбивка на страницы уезжает (на книге в 800 страниц — на страницу).
   Дожидаемся шрифтов один раз на набор метрик и пересчитываем. */
let fontWaitKey = '';
function watchFonts() {
  if (!document.fonts || document.fonts.status === 'loaded') return;
  if (fontWaitKey === metricsKey) return;
  fontWaitKey = metricsKey;
  document.fonts.ready.then(() => { if (book) relayout(); });
}

/* Картинки до загрузки занимают нулевую высоту, и вся разбивка уезжает.
   Дожидаемся их один раз на набор метрик и пересчитываем вёрстку. */
let imgWaitKey = '';
function watchImages(inner) {
  if (imgWaitKey === metricsKey) return;
  const imgs = [...inner.querySelectorAll('img')].filter(im => !im.complete);
  if (!imgs.length) return;
  imgWaitKey = metricsKey;
  let left = imgs.length;
  const done = () => { if (--left === 0) relayout(); };
  imgs.forEach(im => {
    im.addEventListener('load', done, { once:true });
    im.addEventListener('error', done, { once:true });
  });
}

/* какая глава идёт на странице p */
function chapterAt(p) {
  let c = 0;
  for (let i = 0; i < chMeta.length; i++) { if (chMeta[i].page <= p) c = i; else break; }
  // переход из оглавления: если на странице началось несколько глав, показываем ту, куда шли
  if (ciHint != null && chMeta[ciHint] && chMeta[ciHint].page === p) c = ciHint;
  return c;
}

/* Окно глав для страницы p. Назад берём главу, начавшуюся раньше этой страницы
   (её хвост лежит на этой же странице), вперёд — то, что начинается на следующей
   странице и ещё одну главу сверху: заголовок с «break-after:avoid» смотрит вперёд,
   и без запаса он уехал бы в другую колонку, чем в полной вёрстке.
   Отступ сверху равен тому, что в полной вёрстке занято до начала окна, —
   поэтому разрывы строк и колонок совпадают с полной вёрсткой до пикселя. */
function windowFor(p) {
  let first = chapterAt(p);
  while (first > 0 && chMeta[first].page >= p) first--;
  let last = chapterAt(p + 1);
  if (last + 1 < chMeta.length) last++;
  if (last < first) last = first;
  return { first, last };
}

/* Главы после текущей нужны только затем, чтобы заголовок с «break-after:avoid»
   не уехал в другую колонку, чем в полной вёрстке: ему важен следующий блок,
   а не вся глава. Оставляем от них несколько блоков — вёрстка та же, а копий
   страницы для мягкого листа (их 28) браузер считает вдвое меньше. */
const AHEAD_BLOCKS = 4;
function trimAhead(inner, curCi) {
  inner.querySelectorAll('section.ch').forEach(sec => {
    if (+sec.dataset.ci <= curCi) return;
    const kids = [...sec.children];
    kids.slice(AHEAD_BLOCKS).forEach(n => n.remove());
  });
}

/* наполнить слой так, чтобы он показывал сквозную страницу p */
function fillLayer(layer, p) {
  measurePages();
  p = clamp(p, 0, total - 1);
  const w = windowFor(p);
  const key = w.first + ':' + w.last + ':' + metricsKey;
  const inner = innerOf(layer);
  if (layer.dataset.win !== key) {
    const pad = chMeta[w.first].top;
    inner.innerHTML = (pad > 0 ? '<div class="chpad" style="height:' + pad + 'px"></div>' : '') +
      chHTML.slice(w.first, w.last + 1).join('');
    trimAhead(inner, chapterAt(p));
    inner.style.cssText = colCss();
    layer.dataset.win = key;
    layer.dataset.base = String(chMeta[w.first].page);
  }
  const base = +layer.dataset.base || 0;
  inner.style.transform = 'translateX(' + (-(p - base) * (W + G)) + 'px)';
  layer.dataset.pi = String(p);
  return p;
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
  measurePages();
  pi = fillLayer(layers.cur, pi);
  if (pi + 1 < total) { fillLayer(layers.next, pi + 1); layers.next.style.visibility = 'visible'; }
  else layers.next.style.visibility = 'hidden';
  if (pi - 1 >= 0) { fillLayer(layers.prev, pi - 1); layers.prev.style.visibility = 'visible'; }
  else layers.prev.style.visibility = 'hidden';
  ci = chapterAt(pi);
  resetTransforms();
  updateStatus();
  saveProgress();
  scheduleBend();
}

function renderScroll() {
  measureBox();
  const inner = innerOf(sv);
  const key = 'all:' + metricsKey;
  if (sv.dataset.win !== key) {
    inner.innerHTML = chHTML.join('');
    inner.style.cssText = '';
    sv.dataset.win = key;
    svMeta = null;
    watchFonts();
    watchImages(inner);
  }
  updateStatus();
  saveProgress();
}

/* смещения глав в свитке — для оглавления и строки состояния */
function svTops() {
  if (!svMeta) {
    const inner = innerOf(sv);
    if (!inner.firstChild) return [0];
    const base = sv.getBoundingClientRect().top - sv.scrollTop;
    svMeta = chMarks(inner).map(m => Math.max(0, Math.round(m.getBoundingClientRect().top - base)));
    if (!svMeta.length) svMeta = [0];
  }
  return svMeta;
}

function globalProgress() {
  if (S.flip === 'scroll') {
    const max = svMax();
    return clamp(max > 0 ? sv.scrollTop / max : 0, 0, 1);
  }
  return clamp(total > 1 ? pi / (total - 1) : 0, 0, 1);
}

function updateStatus() {
  if (S.flip === 'scroll') {
    const tops = svTops();
    let c = 0;
    for (let i = 0; i < tops.length; i++) { if (tops[i] <= sv.scrollTop + 8) c = i; else break; }
    ci = c;
    $('#stPage').textContent = 'гл. ' + (ci + 1) + ' / ' + book.chapters.length;
  } else {
    $('#stPage').textContent = (pi + 1) + ' / ' + total;
  }
  $('#stChapter').textContent = ((book.chapters[ci] || {}).title || '').slice(0, 42);
  const g = globalProgress();
  $('#seek').value = Math.round(g * 1000);
  $('#hudPos').textContent = Math.round(g * 100) + '%';
  $('#hudTitle').textContent = book.title;
}

let saveT, saveLast = 0;
function stateNow() {
  return { id:book.id, v:2, mk:metricsKey, ci, pi, progress:globalProgress(),
    scroll: S.flip === 'scroll' ? sv.scrollTop : 0, at: Date.now() };
}
function saveProgress(now) {
  if (!now && Date.now() - saveLast < 400) return;   // автопрокрутка зовёт это каждый кадр
  saveLast = Date.now();
  const st = stateNow();
  localStorage.setItem('reader.last', JSON.stringify(st));   // запись мгновенная
  clearTimeout(saveT);
  if (now) { DB.put('state', st); return; }
  saveT = setTimeout(() => DB.put('state', st), 400);
}

/* ====================== переход страниц ====================== */
let animating = false;

function neighbor(dir) {
  const t = pi + dir;
  return (t >= 0 && t < total) ? t : null;
}

function go(dir) {
  if (animating || !book) return;
  ciHint = null; pendingSt = null;
  if (S.flip === 'scroll') { scrollPage(dir); return; }
  const t = neighbor(dir);
  if (t == null) { toast(dir > 0 ? 'Это конец книги' : 'Это начало книги', 1200); return; }
  animate(dir, 1, () => { pi = t; render(); });
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
    if (n == null) { drag = null; return; }
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
    if (commit) pi = d.target;
    render();
  });
}, { passive:true });

/* тапы */
$('#tapLeft').onclick  = () => go(-1);
$('#tapRight').onclick = () => go(1);
$('#tapMid').onclick   = () => toggleHud();

/* ====================== свиток и автопрокрутка ======================
   Книга в свитке смонтирована целиком, поэтому прокрутка через границу главы
   ничем не отличается от прокрутки внутри главы: ни подмены содержимого,
   ни прыжков. */
function scrollPage(dir) {
  const step = sv.clientHeight * 0.9 * dir;
  sv.scrollBy({ top:step, behavior:'smooth' });
}

const svMax = () => Math.max(0, sv.scrollHeight - sv.clientHeight);

sv.addEventListener('scroll', () => {
  if (!book) return;
  updateStatus(); saveProgress();
}, { passive:true });

let autoOn = false, autoRaf = 0, autoLast = 0, autoY = 0;

/* Округляем до физического пикселя: на дробных смещениях глифы мылятся
   и текст тянет за собой шлейф. */
function autoApply() {
  const dpr = window.devicePixelRatio || 1;
  sv.scrollTop = Math.round(autoY * dpr) / dpr;
}
function autoStart() {
  if (!book) return;
  if (S.flip !== 'scroll') {
    S.flip = 'scroll'; saveSettings(); applyStyleVars(); syncSheet();
    renderScroll();
    toast('Включил «Свиток» — автопрокрутка работает в нём');
  }
  autoY = sv.scrollTop;
  autoOn = true; autoLast = 0;
  sv.style.overflowY = 'hidden';          // чтобы палец и автопрокрутка не спорили
  $('#autoBar').classList.add('show');
  document.body.classList.add('auto');
  $('#autoBtn').textContent = '❚❚';
  const tick = ts => {
    if (!autoOn) return;
    if (autoLast) {
      const lh = S.fsize * (S.lheight / 100);
      autoY += lh * autoLines() / 60000 * Math.min(100, ts - autoLast);
      const max = svMax();
      if (autoY >= max) {
        autoY = max; autoApply(); autoStop(); toast('Книга дочитана'); return;
      }
      autoApply();
      updateStatus(); saveProgress();
    }
    autoLast = ts;
    autoRaf = requestAnimationFrame(tick);
  };
  autoRaf = requestAnimationFrame(tick);
}
function autoStop() {
  const was = autoOn;
  autoOn = false; cancelAnimationFrame(autoRaf);
  sv.style.overflowY = '';
  $('#autoBar').classList.remove('show');
  document.body.classList.remove('auto');
  $('#autoBtn').textContent = '▶';
  if (was) saveProgress(true);
}
$('#autoBtn').onclick = () => autoOn ? autoStop() : autoStart();
$('#autoStop').onclick = autoStop;
const speedLabel = () => $('#autoVal').textContent = S.autoPct + '%';
const setSpeed = v => {
  S.autoPct = clamp(+v, 0, 100);
  $('#autoSpeed').value = S.autoPct; $('#autoSpeed2').value = S.autoPct;
  speedLabel(); saveSettings();
};
$('#autoSpeed').oninput = e => setSpeed(e.target.value);
$('#autoSpeed2').oninput = e => setSpeed(e.target.value);

/* ====================== HUD, листы ====================== */
function hud(on) {
  $('#hud').classList.toggle('show', !!on);
  // полоса скорости живёт отдельно от HUD — прячем её тем же тапом
  document.body.classList.toggle('ui-off', !on);
}
const toggleHud = () => hud(!$('#hud').classList.contains('show'));

/* ====================== во весь экран ======================
   На айфоне Safari не умеет раскрывать произвольный элемент (Fullscreen API
   есть только у видео), зато из «на экран «Домой»» приложение и так стартует
   без адресной строки. Поэтому: где API есть — зовём его, где нет — честно
   говорим, что делать. */
const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches)
  || navigator.standalone === true;
const fullNow = () => document.fullscreenElement || document.webkitFullscreenElement;
function syncFullBtn() {
  const b = $('#fullBtn');
  if (standalone()) { b.style.display = 'none'; return; }
  b.textContent = fullNow() ? '⤡' : '⛶';
}
$('#fullBtn').onclick = async () => {
  const el = document.documentElement;
  try {
    if (fullNow()) {
      await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!req) return toast('Safari на айфоне не раскрывает страницу на весь экран. ' +
        'Добавь читалку на домашний экран — запустится без адресной строки.', 4200);
      await req.call(el);
    }
  } catch (e) { toast('Не вышло развернуть: ' + e.message, 2600); }
  syncFullBtn();
};
document.addEventListener('fullscreenchange', syncFullBtn);
document.addEventListener('webkitfullscreenchange', syncFullBtn);
syncFullBtn();

$('#backBtn').onclick = () => {
  $('#sheetWrap').classList.remove('show');
  autoStop();
  if (book) saveProgress(true);
  localStorage.setItem('reader.openLast', '0');   // ушёл в библиотеку — с неё и начнём
  document.body.dataset.screen = 'library';
  renderShelf();
};
$('#setBtn').onclick = () => $('#sheetWrap').classList.add('show');
$('#sheetClose').onclick = () => $('#sheetWrap').classList.remove('show');
$('#sheetWrap').onclick = e => { if (e.target.id === 'sheetWrap') $('#sheetWrap').classList.remove('show'); };
$('#tocClose').onclick = () => $('#tocWrap').classList.remove('show');
$('#tocWrap').onclick = e => { if (e.target.id === 'tocWrap') $('#tocWrap').classList.remove('show'); };
$('#tocBtn').onclick = () => {
  $('#sheetWrap').classList.remove('show');     // оглавление открывается поверх меню
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
      gotoChapter(i);
    };
    list.appendChild(a);
  });
  $('#tocWrap').classList.add('show');
};
$$('.sheet-tabs .tab').forEach(t => t.onclick = () => {
  $$('.sheet-tabs .tab').forEach(x => x.classList.toggle('active', x === t));
  $$('.tabpane').forEach(p => p.classList.toggle('active', p.dataset.pane === t.dataset.tab));
});

/* переход к главе из оглавления: сквозной текст, но навигация по главам жива */
function gotoChapter(i) {
  if (!book) return;
  autoStop();
  pendingSt = null;
  if (S.flip === 'scroll') {
    renderScroll();
    const tops = svTops();
    sv.scrollTop = clamp(tops[i] || 0, 0, svMax());
    updateStatus(); saveProgress(true);
  } else {
    measureBox(); measurePages();
    ciHint = i;
    pi = clamp((chMeta[i] || { page:0 }).page, 0, total - 1);
    render();
  }
}

$('#seek').oninput = e => {
  if (!book) return;
  ciHint = null; pendingSt = null;
  const g = clamp(+e.target.value / 1000, 0, 1);
  if (S.flip === 'scroll') {
    sv.scrollTop = Math.round(g * svMax());
  } else {
    measureBox(); measurePages();
    pi = clamp(Math.round(g * (total - 1)), 0, total - 1);
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
      const g = book ? globalProgress() : 0;
      S.flip = f.id; saveSettings(); applyStyleVars(); syncSheet();
      if (!book) return;
      metricsKey = ''; measured = false; svMeta = null;
      if (S.flip === 'scroll') {
        renderScroll();
        sv.scrollTop = Math.round(g * svMax());
        updateStatus();
      } else {
        measureBox(); measurePages();
        pi = clamp(Math.round(g * (total - 1)), 0, total - 1);
        render();
      }
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
  $('#autoSpeed').value = S.autoPct; $('#autoSpeed2').value = S.autoPct;
  speedLabel();
}
let relayoutT, pendingSt = null, pendingTill = 0;
function relayout() {
  clearTimeout(relayoutT);
  relayoutT = setTimeout(() => {
    if (!book) return;
    if (pendingSt && Date.now() > pendingTill) pendingSt = null;
    if (pendingSt) {                      // пересчёты сразу после открытия книги
      const st = pendingSt;
      metricsKey = ''; measured = false; svMeta = null;
      [layers.prev, layers.cur, layers.next].forEach(l => l.dataset.win = '');
      sv.dataset.win = '';
      restoreState(st);
      return;
    }
    const g = globalProgress();
    metricsKey = ''; measured = false; svMeta = null;
    [layers.prev, layers.cur, layers.next].forEach(l => l.dataset.win = '');
    sv.dataset.win = '';
    if (S.flip === 'scroll') {
      renderScroll();
      sv.scrollTop = Math.round(g * svMax());
      updateStatus();
    } else {
      measureBox(); measurePages();
      pi = clamp(Math.round(g * (total - 1)), 0, total - 1);
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
/* Вернуть книгу на сохранённое место. Номер страницы годится только при тех же
   метриках (шрифт, размер, поля); иначе ведём по доле прочитанного. */
function restoreState(st) {
  measureBox();
  const exact = st.v === 2 && st.mk === metricsKey;
  const g = clamp(st.progress || 0, 0, 1);
  const c = clamp(st.ci || 0, 0, chHTML.length - 1);
  if (S.flip === 'scroll') {
    renderScroll();
    let y;
    if (exact) y = st.scroll || 0;
    else if (st.v === 2) y = g * svMax();
    else y = (svTops()[c] || 0) + (st.scroll || 0);     // старая запись: смещение внутри главы
    sv.scrollTop = clamp(Math.round(y), 0, svMax());
    updateStatus(); saveProgress(true);
  } else {
    measurePages();
    if (exact) pi = clamp(st.pi || 0, 0, total - 1);
    else if (st.v === 2) pi = clamp(Math.round(g * (total - 1)), 0, total - 1);
    else pi = clamp((chMeta[c] || { page:0 }).page + (st.pi || 0), 0, total - 1);
    render();
  }
}

async function openBook(id) {
  loader(true, 'Открываю…');
  book = await DB.get('books', id);
  if (!book) { loader(false); return toast('Книга не найдена'); }
  let st = await DB.get('state', id) || { ci:0, pi:0 };
  try {                                   // localStorage мог успеть записать позже
    const q = JSON.parse(localStorage.getItem('reader.last') || 'null');
    if (q && q.id === id && (q.at || 0) > (st.at || 0)) st = q;
  } catch (e) { /* неважно */ }
  document.body.dataset.screen = 'reader';
  localStorage.setItem('reader.openLast', '1');
  applyStyleVars();
  buildFlow();
  metricsKey = '';
  [layers.prev, layers.cur, layers.next].forEach(l => l.dataset.win = '');
  sv.dataset.win = '';
  ci = clamp(st.ci || 0, 0, book.chapters.length - 1);
  pendingSt = st; pendingTill = Date.now() + 2000;
  requestAnimationFrame(() => {
    restoreState(st);
    loader(false);
    hud(true);
    /* Первая вёрстка почти всегда «предварительная»: шрифт ещё не готов, картинки
       (в том числе data:-обложка) ещё не декодированы и занимают нулевую высоту —
       на книге в 800 страниц разбивка уезжает на страницу. Пересчитываем, когда
       всё устоялось, и возвращаемся на сохранённое место точно. */
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => relayout());
    setTimeout(relayout, 700);
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

/* iOS выкидывает хранилище «неважных» сайтов — просим пометить наше как нужное */
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted().then(ok => ok || navigator.storage.persist()).catch(() => {});
}

/* сохраняем позицию сразу, как только приложение уходит из виду:
   iOS закрывает вкладку без предупреждения, отложенная запись пропадёт */
const flush = () => { if (book) saveProgress(true); };
window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

applyStyleVars();
buildSheet();
syncSheet();
renderShelf().then(async () => {
  // открываем последнюю книгу там же, где закрыли
  try {
    const q = JSON.parse(localStorage.getItem('reader.last') || 'null');
    if (localStorage.getItem('reader.openLast') !== '0' &&
        q && q.id && await DB.get('books', q.id)) openBook(q.id);
  } catch (e) { /* остаёмся в библиотеке */ }
});

/* ручка для автотеста: состояние движка и шаги без касаний экрана */
window.RDR = {
  state: () => ({ ci, pi, total, flip:S.flip, autoPct:S.autoPct, lines:autoLines(),
    scroll: sv.scrollTop, max: svMax(), chMeta, progress: globalProgress(),
    chapters: book ? book.chapters.length : 0,
    page: () => innerOf(layers.cur).textContent }),
  go, gotoChapter, openBook, render, relayout,
  set: (k, v) => { S[k] = v; saveSettings(); applyStyleVars(); },
  seek: g => { $('#seek').value = Math.round(g * 1000); $('#seek').oninput({ target:$('#seek') }); },
  autoStart, autoStop, saveProgress, DB
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
})();
