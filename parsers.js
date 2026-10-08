/* ============================================================
   parsers.js — разбор EPUB и FB2 в единую структуру книги
   { title, author, cover (dataURL|null), chapters:[{title, html}] }
   ============================================================ */
(function (global) {
  'use strict';

  const dec = (buf, enc) => new TextDecoder(enc || 'utf-8', { fatal: false }).decode(buf);

  /* ---------- общее: чистка html ---------- */
  function sanitize(root) {
    root.querySelectorAll('script,style,link,meta,iframe,object,embed,form,input,button').forEach(n => n.remove());
    root.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(a => {
        const n = a.name.toLowerCase();
        if (n.startsWith('on') || (n === 'href' && /^javascript:/i.test(a.value))) el.removeAttribute(a.name);
        if (n === 'style' && /position|z-index|width:\s*\d{3,}/i.test(a.value)) el.removeAttribute('style');
      });
    });
    return root;
  }

  /* ============================================================
     EPUB
     ============================================================ */
  async function parseEpub(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const xml = async p => new DOMParser().parseFromString(await zip.file(p).async('string'), 'application/xml');

    // 1. корневой OPF
    const container = await xml('META-INF/container.xml');
    const opfPath = container.querySelector('rootfile').getAttribute('full-path');
    const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const opf = await xml(opfPath);

    const meta = t => {
      const el = opf.getElementsByTagName('dc:' + t)[0] || opf.getElementsByTagName(t)[0];
      return el ? el.textContent.trim() : '';
    };
    const title = meta('title') || 'Без названия';
    const author = meta('creator') || '';

    // 2. манифест
    const manifest = {};
    [...opf.getElementsByTagName('item')].forEach(it => {
      manifest[it.getAttribute('id')] = {
        href: resolve(base, it.getAttribute('href')),
        type: it.getAttribute('media-type') || '',
        props: it.getAttribute('properties') || ''
      };
    });

    // 3. ресурсы (картинки) → blob URL
    const resMap = {};
    await Promise.all(Object.values(manifest)
      .filter(m => /^image\//.test(m.type))
      .map(async m => {
        const f = zip.file(m.href);
        if (!f) return;
        resMap[m.href] = URL.createObjectURL(new Blob([await f.async('arraybuffer')], { type: m.type }));
      }));

    // 4. обложка
    let cover = null;
    const coverMeta = [...opf.getElementsByTagName('meta')].find(m => m.getAttribute('name') === 'cover');
    const coverId = coverMeta && coverMeta.getAttribute('content');
    const coverItem = (coverId && manifest[coverId]) ||
      Object.values(manifest).find(m => /cover-image/.test(m.props));
    if (coverItem && resMap[coverItem.href]) cover = resMap[coverItem.href];

    // 5. содержание (nav / ncx) → href → заголовок
    const tocTitles = {};
    try {
      const navItem = Object.values(manifest).find(m => /\bnav\b/.test(m.props));
      if (navItem && zip.file(navItem.href)) {
        const doc = new DOMParser().parseFromString(await zip.file(navItem.href).async('string'), 'text/html');
        const navBase = navItem.href.includes('/') ? navItem.href.slice(0, navItem.href.lastIndexOf('/') + 1) : '';
        doc.querySelectorAll('nav a[href]').forEach(a => {
          const h = resolve(navBase, a.getAttribute('href').split('#')[0]);
          if (!tocTitles[h]) tocTitles[h] = a.textContent.trim();
        });
      } else {
        const ncx = Object.values(manifest).find(m => /ncx/.test(m.type));
        if (ncx && zip.file(ncx.href)) {
          const doc = await xml(ncx.href);
          const nb = ncx.href.includes('/') ? ncx.href.slice(0, ncx.href.lastIndexOf('/') + 1) : '';
          [...doc.getElementsByTagName('navPoint')].forEach(np => {
            const c = np.getElementsByTagName('content')[0];
            const l = np.getElementsByTagName('text')[0];
            if (!c || !l) return;
            const h = resolve(nb, c.getAttribute('src').split('#')[0]);
            if (!tocTitles[h]) tocTitles[h] = l.textContent.trim();
          });
        }
      }
    } catch (e) { /* содержание не критично */ }

    // 6. spine → главы
    const spine = [...opf.getElementsByTagName('itemref')]
      .map(r => manifest[r.getAttribute('idref')])
      .filter(m => m && /html|xml/.test(m.type));

    const chapters = [];
    for (const item of spine) {
      const f = zip.file(item.href);
      if (!f) continue;
      const raw = await f.async('string');
      const doc = new DOMParser().parseFromString(raw, 'text/html');
      const body = doc.body;
      if (!body) continue;
      sanitize(body);

      const dir = item.href.includes('/') ? item.href.slice(0, item.href.lastIndexOf('/') + 1) : '';
      body.querySelectorAll('img,image').forEach(img => {
        const attr = img.hasAttribute('src') ? 'src' : 'xlink:href';
        const src = img.getAttribute('src') || img.getAttribute('xlink:href') || img.getAttribute('href');
        if (!src) return img.remove();
        const url = resMap[resolve(dir, src)];
        if (url) img.setAttribute(attr === 'src' ? 'src' : 'src', url);
        else img.remove();
        if (img.tagName.toLowerCase() === 'image') {
          const n = doc.createElement('img'); n.src = url; img.replaceWith(n);
        }
      });
      body.querySelectorAll('a[href]').forEach(a => { a.removeAttribute('href'); });
      body.querySelectorAll('[srcset]').forEach(n => n.removeAttribute('srcset'));

      const html = body.innerHTML.trim();
      if (!html || !body.textContent.trim()) continue;

      const head = body.querySelector('h1,h2,h3,h4');
      chapters.push({
        title: tocTitles[item.href] || (head ? head.textContent.trim().slice(0, 80) : '') ||
               ('Часть ' + (chapters.length + 1)),
        html
      });
    }

    if (!chapters.length) throw new Error('В EPUB не нашлось текста');
    return { title, author, cover, chapters, format: 'epub' };
  }

  function resolve(base, href) {
    if (!href) return '';
    if (/^(https?|data):/.test(href)) return href;
    let p = (base + decodeURIComponent(href)).replace(/\\/g, '/');
    const out = [];
    p.split('/').forEach(s => {
      if (s === '.' || s === '') { if (!out.length && s === '') out.push(''); return; }
      if (s === '..') out.pop(); else out.push(s);
    });
    return out.join('/').replace(/^\//, '');
  }

  /* ============================================================
     FB2
     ============================================================ */
  async function parseFb2(buffer, name) {
    let buf = buffer;
    // .fb2.zip
    const sig = new Uint8Array(buffer.slice(0, 2));
    if (sig[0] === 0x50 && sig[1] === 0x4b) {
      const zip = await JSZip.loadAsync(buffer);
      const entry = Object.values(zip.files).find(f => !f.dir && /\.fb2$/i.test(f.name)) ||
                    Object.values(zip.files).find(f => !f.dir);
      if (!entry) throw new Error('В архиве нет .fb2');
      buf = await entry.async('arraybuffer');
    }

    // кодировка из XML-декларации
    const probe = dec(buf.slice(0, 300), 'utf-8');
    const m = probe.match(/encoding=["']([\w-]+)["']/i);
    let enc = (m ? m[1] : 'utf-8').toLowerCase();
    if (enc === 'cp1251' || enc === 'windows-1251cyrillic') enc = 'windows-1251';
    let text = dec(buf, enc);
    if (text.indexOf('�') > -1 && enc !== 'windows-1251') text = dec(buf, 'windows-1251');

    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('FB2 повреждён или не распознан');

    const T = (sel, root) => { const e = (root || doc).querySelector(sel); return e ? e.textContent.trim() : ''; };
    const ti = doc.querySelector('title-info');
    const title = (ti && T('book-title', ti)) || (name || '').replace(/\.[^.]+$/, '') || 'Без названия';
    let author = '';
    const a = ti && ti.querySelector('author');
    if (a) author = ['first-name', 'middle-name', 'last-name']
      .map(t => T(t, a)).filter(Boolean).join(' ');

    // бинарники
    const bin = {};
    [...doc.getElementsByTagName('binary')].forEach(b => {
      const id = b.getAttribute('id');
      const ct = b.getAttribute('content-type') || 'image/jpeg';
      if (id) bin[id] = 'data:' + ct + ';base64,' + b.textContent.replace(/\s+/g, '');
    });
    const href = el => {
      const h = el.getAttribute('l:href') || el.getAttribute('xlink:href') || el.getAttribute('href') || '';
      return bin[h.replace(/^#/, '')] || null;
    };

    let cover = null;
    const cp = doc.querySelector('coverpage image');
    if (cp) cover = href(cp);

    // тело
    const bodies = [...doc.getElementsByTagName('body')];
    const main = bodies.find(b => !b.getAttribute('name')) || bodies[0];
    if (!main) throw new Error('В FB2 не нашлось текста');

    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    function inline(node) {
      let out = '';
      node.childNodes.forEach(n => {
        if (n.nodeType === 3) { out += esc(n.nodeValue); return; }
        if (n.nodeType !== 1) return;
        const t = n.nodeName.toLowerCase();
        const inner = inline(n);
        if (t === 'emphasis') out += '<em>' + inner + '</em>';
        else if (t === 'strong') out += '<strong>' + inner + '</strong>';
        else if (t === 'strikethrough') out += '<s>' + inner + '</s>';
        else if (t === 'sub') out += '<sub>' + inner + '</sub>';
        else if (t === 'sup') out += '<sup>' + inner + '</sup>';
        else if (t === 'code') out += '<code>' + inner + '</code>';
        else if (t === 'style') out += inner;
        else if (t === 'a') out += '<i>' + inner + '</i>';
        else if (t === 'image') { const u = href(n); if (u) out += '<img src="' + u + '">'; }
        else out += inner;
      });
      return out;
    }

    function block(node) {
      let out = '';
      node.childNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        const t = n.nodeName.toLowerCase();
        switch (t) {
          case 'p': out += '<p>' + inline(n) + '</p>'; break;
          case 'empty-line': out += '<p style="height:.7em"></p>'; break;
          case 'subtitle': out += '<h3>' + inline(n) + '</h3>'; break;
          case 'title': out += '<h2 class="chapter-title">' +
            [...n.getElementsByTagName('p')].map(p => inline(p)).join('<br>') + '</h2>'; break;
          case 'epigraph': out += '<div class="epigraph">' + block(n) + '</div>'; break;
          case 'cite': out += '<blockquote>' + block(n) + '</blockquote>'; break;
          case 'poem': out += '<div class="poem">' + block(n) + '</div>'; break;
          case 'stanza': out += block(n) + '<p style="height:.5em"></p>'; break;
          case 'v': out += '<p>' + inline(n) + '</p>'; break;
          case 'text-author': out += '<p class="epigraph">' + inline(n) + '</p>'; break;
          case 'image': { const u = href(n); if (u) out += '<img src="' + u + '">'; break; }
          case 'table': out += '<p>' + inline(n) + '</p>'; break;
          case 'section': out += block(n); break;
          case 'annotation': out += '<div class="epigraph">' + block(n) + '</div>'; break;
          default: out += block(n);
        }
      });
      return out;
    }

    const secTitle = s => {
      const t = s.querySelector(':scope > title');
      if (!t) return '';
      return [...t.getElementsByTagName('p')].map(p => p.textContent.trim()).join(' ').slice(0, 80);
    };

    let tops = [...main.children].filter(c => c.nodeName.toLowerCase() === 'section');
    const chapters = [];

    // титульная страница: автор, название, аннотация
    const ann = doc.querySelector('annotation');
    const annHtml = ann ? block(ann).replace(/<[^>]*>/g, m => m).slice(0, 1800) : '';
    chapters.push({
      title: 'Титул',
      html: '<div class="titlepage">' +
            (author ? '<div class="tp-author">' + esc(author) + '</div>' : '') +
            '<h1 class="tp-title">' + esc(title) + '</h1>' +
            '<div class="tp-rule"></div>' +
            (annHtml ? '<div class="epigraph" style="text-align:center">' + annHtml + '</div>' : '') +
            '</div>'
    });

    if (!tops.length) {
      chapters.push({ title: title, html: block(main) });
    } else {
      // если верхний уровень — одна «часть» с вложенными главами, спускаемся
      if (tops.length === 1 && tops[0].querySelectorAll(':scope > section').length > 1) {
        const inner = [...tops[0].children].filter(c => c.nodeName.toLowerCase() === 'section');
        const head = secTitle(tops[0]);
        if (head) chapters.push({ title: head, html: '<h2 class="chapter-title">' + esc(head) + '</h2>' });
        tops = inner;
      }
      tops.forEach((s, i) => {
        const html = block(s);
        if (!html.replace(/<[^>]+>/g, '').trim()) return;
        chapters.push({ title: secTitle(s) || 'Глава ' + (i + 1), html });
      });
    }

    if (!chapters.length) throw new Error('В FB2 не нашлось текста');
    return { title, author, cover, chapters, format: 'fb2' };
  }

  /* ============================================================
     точка входа
     ============================================================ */
  async function parseBook(file) {
    const buf = await file.arrayBuffer();
    const n = file.name.toLowerCase();
    if (n.endsWith('.epub')) return parseEpub(buf);
    if (n.endsWith('.fb2') || n.endsWith('.fb2.zip')) return parseFb2(buf, file.name);
    // по сигнатуре
    const sig = new Uint8Array(buf.slice(0, 2));
    if (sig[0] === 0x50 && sig[1] === 0x4b) {
      try { return await parseEpub(buf); } catch (e) { return parseFb2(buf, file.name); }
    }
    return parseFb2(buf, file.name);
  }

  global.Parsers = { parseBook };
})(window);
