/*
 * turndown_parser.js — DOM Parser Engine (zero dependencies)
 * 1) Readability-style extraction: scores content blocks, strips nav/ads/sidebars.
 * 2) HTML -> GitHub-flavoured Markdown (headings, lists, tasks, code w/ language, tables).
 * Runs 100% locally inside the page; nothing leaves the browser.
 */
(() => {
  if (globalThis.W2MD) return;

  const DEFAULTS = {
    images: 'keep',        // keep | link | strip
    links: 'inline',       // inline | reference | strip
    fence: '```',          // ``` | ~~~
    codeLang: true,        // keep language tags on fenced code
    bullet: '-',           // - | * | +
    frontMatter: false,    // YAML front matter (Obsidian)
    titleHeading: true     // prepend "# Title" in page modes
  };

  const BLOCK = new Set(('ADDRESS ARTICLE ASIDE BLOCKQUOTE BODY CENTER DD DETAILS DIALOG DIR DIV DL DT FIELDSET ' +
    'FIGCAPTION FIGURE FOOTER FORM H1 H2 H3 H4 H5 H6 HEADER HGROUP HR HTML LEGEND LI MAIN MENU NAV OL P PRE ' +
    'SECTION SUMMARY TABLE TBODY TD TFOOT TH THEAD TR UL CAPTION').split(' '));
  const BLOCK_SEL = [...BLOCK].map(t => t.toLowerCase()).join(',');
  const SKIP = new Set('SCRIPT STYLE NOSCRIPT TEMPLATE IFRAME OBJECT EMBED CANVAS SVG BUTTON SELECT TEXTAREA LINK META VIDEO AUDIO MAP HEAD'.split(' '));
  const JUNK_SEL = 'script,style,noscript,template,iframe,object,embed,canvas,svg,button,select,textarea,link,meta,dialog,' +
    'input:not([type=checkbox]),[hidden],[aria-hidden="true"],[role=dialog],[role=alert],[role=search]';
  const CLEAN_SEL = 'nav,aside,footer,[role=navigation],[role=banner],[role=contentinfo],[role=complementary],form';
  const NEG = /(^|[-_\s])(ads?|adv|advert\w*|banner|breadcrumbs?|combx|comments?|cookie|consent|disqus|footer|footnote-ref|masthead|menu|modal|nav|navbar|newsletter|outbrain|pager|pagination|popup|promo\w*|related|share|sharing|shoutbox|social|sidebar|skyscraper|sponsor\w*|subscribe|taboola|toolbar|tools|widget)([-_\s]|$)/i;
  const POS = /(^|[-_\s])(article|body|content|entry|hentry|main|page|post|text|blog|story|prose|markdown|docs?)([-_\s]|$)/i;
  const GUTTER = /(^|[-_\s])(line-?numbers?|gutter|lineno|linenos|copy-?button|code-?toolbar)([-_\s]|$)/i;

  const cls = el => ((typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || ''));
  const textLen = el => (el.textContent || '').replace(/\s+/g, ' ').trim().length;
  const linkDensity = el => {
    const t = textLen(el); if (!t) return 0;
    let l = 0; el.querySelectorAll('a').forEach(a => { l += textLen(a); });
    return l / t;
  };

  /* ---------------------------- Readability ---------------------------- */
  function classWeight(el) {
    const c = cls(el); let w = 0;
    if (NEG.test(c)) w -= 25;
    if (POS.test(c)) w += 25;
    return w;
  }

  function findMain(doc) {
    const scores = new Map();
    const init = el => {
      if (scores.has(el)) return;
      let s = classWeight(el);
      switch (el.tagName) {
        case 'ARTICLE': s += 10; break;
        case 'MAIN': case 'DIV': s += 5; break;
        case 'PRE': case 'TD': case 'BLOCKQUOTE': s += 3; break;
        case 'OL': case 'UL': case 'DL': case 'LI': case 'FORM': s -= 3; break;
        case 'TH': case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': s -= 5; break;
      }
      scores.set(el, s);
    };
    const nodes = doc.body.querySelectorAll('p,pre,td,blockquote,div,section,li');
    for (const n of nodes) {
      if ((n.tagName === 'DIV' || n.tagName === 'SECTION' || n.tagName === 'LI') && n.querySelector(BLOCK_SEL)) continue;
      if (n.closest('nav,aside,footer,header,[role=navigation],[role=complementary]')) continue;
      const t = (n.textContent || '').trim();
      if (t.length < 25) continue;
      const score = 1 + (t.split(/[,，、]/).length - 1) + Math.min(Math.floor(t.length / 100), 3);
      let a = n.parentElement, lvl = 0;
      while (a && lvl < 3 && a !== doc.documentElement) {
        init(a);
        scores.set(a, scores.get(a) + score / (lvl === 0 ? 1 : lvl === 1 ? 2 : lvl * 3));
        a = a.parentElement; lvl++;
      }
    }
    let top = null, best = -Infinity;
    for (const [el, s] of scores) {
      const f = s * (1 - linkDensity(el));
      scores.set(el, f);
      if (f > best) { best = f; top = el; }
    }
    const isArticle = el => el.tagName === 'ARTICLE' || el.getAttribute('itemprop') === 'articleBody';
    if (!top || textLen(top) < 250) return doc.querySelector('article, [itemprop=articleBody], main, [role=main]') || doc.body;
    // If the winner lives in a landmark only a bit larger than itself, take the landmark (keeps intros/headings).
    const landmark = top.closest('article, [itemprop=articleBody]') || top.closest('main, [role=main]');
    if (landmark && textLen(top) > textLen(landmark) * 0.6) top = landmark;
    // Walk up while the parent adds little besides this node (never past an <article> or into chrome like comments).
    while (!isArticle(top) && top.parentElement && top.parentElement !== doc.body && top.parentElement.tagName !== 'HTML' &&
           textLen(top) > textLen(top.parentElement) * 0.85 &&
           ![...top.parentElement.children].some(c => c !== top && NEG.test(cls(c)))) top = top.parentElement;
    // Merge qualifying siblings (content split across containers).
    const parent = top.parentElement;
    if (!parent || top === doc.body) return top;
    const threshold = Math.max(10, best * 0.2);
    const keep = [...parent.children].filter(sib => {
      if (sib === top) return true;
      if (NEG.test(cls(sib)) || /^(NAV|ASIDE|FOOTER|HEADER|SCRIPT|STYLE|FORM)$/.test(sib.tagName)) return false;
      if ((scores.get(sib) || 0) >= threshold) return true;
      if (sib.tagName === 'P') { const l = textLen(sib); return (l > 80 && linkDensity(sib) < 0.25) || (l > 0 && l < 80 && linkDensity(sib) === 0 && /\.( |$)/.test(sib.textContent)); }
      return false;
    });
    return keep.length === 1 ? top : keep;
  }

  /* Clone subtree while fixing URLs / lazy images and dropping invisible nodes (uses live computed styles). */
  function cloneClean(roots, deep) {
    const wrap = document.createElement('div');
    for (const root of roots) {
      const copy = root.cloneNode(true);
      const orig = [root, ...root.querySelectorAll('*')];
      const dup = [copy, ...copy.querySelectorAll('*')];
      const drop = [];
      const limit = Math.min(orig.length, 20000);
      for (let i = 0; i < limit; i++) {
        const o = orig[i], d = dup[i];
        if (!d) break;
        if (i && o.getClientRects && orig.length < 8000) {
          const cs = getComputedStyle(o);
          if (cs.display === 'none' || cs.visibility === 'hidden') { drop.push(d); continue; }
        }
        if (o.tagName === 'A') { if (o.href) d.setAttribute('href', o.href); }
        else if (o.tagName === 'IMG') {
          let src = o.currentSrc || o.src;
          const lazy = o.getAttribute('data-src') || o.getAttribute('data-lazy-src') || o.getAttribute('data-original');
          if ((!src || src.startsWith('data:')) && lazy) src = abs(lazy);
          if ((!src || src.startsWith('data:')) && o.getAttribute('data-srcset')) src = abs(o.getAttribute('data-srcset').split(/\s+/)[0]);
          d.setAttribute('src', src || '');
        }
      }
      drop.forEach(n => n.remove());
      wrap.appendChild(copy);
    }
    wrap.querySelectorAll(JUNK_SEL).forEach(n => n.remove());
    wrap.querySelectorAll('*').forEach(n => { if (GUTTER.test(cls(n)) && n.closest('pre, [class*=highlight], [class*=code]')) n.remove(); });
    if (deep) {
      const total = textLen(wrap) || 1;
      wrap.querySelectorAll(CLEAN_SEL).forEach(n => { if (textLen(n) < total * 0.5) n.remove(); });
      wrap.querySelectorAll('header').forEach(n => { if (!n.querySelector('h1,h2') && textLen(n) < total * 0.5) n.remove(); });
      wrap.querySelectorAll('div,section,span,ul,ol,p,aside,figure,li,a').forEach(n => {
        if (!wrap.contains(n) || n.closest('pre,code,table')) return;
        if (NEG.test(cls(n)) && !POS.test(cls(n)) && textLen(n) < total * 0.3 && !n.querySelector('pre,table,h1,h2')) n.remove();
      });
    }
    return wrap;
  }

  function abs(u) { try { return new URL(u, document.baseURI).href; } catch (e) { return u; } }

  /* ---------------------------- Markdown ---------------------------- */
  function escapeText(s) {
    return s.replace(/\\/g, '\\\\').replace(/([*`])/g, '\\$1')
      .replace(/(^|[^\w\\])_/g, '$1\\_').replace(/_(?=$|[^\w])/g, '\\_');
  }
  function escapeLineStart(line) {
    return line.replace(/^(\s*)(#{1,6}\s|>|[-+]\s|=+\s*$|-{3,}\s*$)/, '$1\\$2').replace(/^(\s*\d+)([.)]\s)/, '$1\\$2');
  }
  const encUrl = u => u.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');

  function isBlockNode(n) {
    if (n.nodeType !== 1) return false;
    if (BLOCK.has(n.tagName)) return true;
    // Inline wrappers (a, span...) that contain block elements act as blocks.
    return !SKIP.has(n.tagName) && n.tagName !== 'IMG' && n.tagName !== 'BR' && !!n.querySelector(BLOCK_SEL);
  }

  // Convert children of a container: inline runs are merged, blocks are separated by `joiner`.
  function blocks(el, ctx, joiner = '\n\n') {
    const parts = []; let buf = '';
    const flush = () => {
      if (!buf) return;
      let t = buf.replace(/[ \t ]+/g, m => (m.includes(' ') && m.length > 1 ? ' ' : ' '));
      t = t.split('\n').map(l => l.trim()).join('\n').trim();
      if (t && !ctx.noEscape) t = t.split('\n').map(escapeLineStart).join('\n');
      if (t) parts.push(t);
      buf = '';
    };
    for (const c of el.childNodes) {
      if (isBlockNode(c)) { flush(); const b = block(c, ctx); if (b && b.trim()) parts.push(b); }
      else buf += inline(c, ctx);
    }
    flush();
    return parts.join(joiner);
  }

  const flat = (el, ctx) => blocks(el, Object.assign({}, ctx, { noEscape: true })).replace(/\s*\n+\s*/g, ' ').trim();

  function inline(n, ctx) {
    if (n.nodeType === 3) {
      if (ctx.pre) return n.nodeValue;
      return escapeText(n.nodeValue.replace(/[\r\n\t ]+/g, ' '));
    }
    if (n.nodeType !== 1 || SKIP.has(n.tagName)) return '';
    const kids = () => { let s = ''; for (const c of n.childNodes) s += inline(c, ctx); return s; };
    const wrap = (m) => {
      const s = kids(); const t = s.trim();
      if (!t) return s.length ? ' ' : '';
      return (s.match(/^\s*/)[0] ? ' ' : '') + m + t + m + (s.match(/\s*$/)[0] ? ' ' : '');
    };
    switch (n.tagName) {
      case 'BR': return ctx.table ? '<br>' : '\n';
      case 'STRONG': case 'B': return ctx.heading ? kids() : wrap('**');
      case 'EM': case 'I': case 'CITE': case 'DFN': return wrap('*');
      case 'DEL': case 'S': case 'STRIKE': return wrap('~~');
      case 'CODE': case 'KBD': case 'SAMP': case 'TT': {
        const code = n.textContent.replace(/\s+/g, ' ');
        if (!code.trim()) return '';
        const runs = code.match(/`+/g) || [];
        const tick = '`'.repeat(Math.max(0, ...runs.map(r => r.length)) + 1);
        const pad = /^`|`$/.test(code) ? ' ' : '';
        return tick + pad + code + pad + tick;
      }
      case 'SUP': { const s = kids().trim(); return s ? (/^\[?\d+\]?$/.test(s) ? '[^' + s.replace(/[\[\]]/g, '') + ']' : '^' + s) : ''; }
      case 'SUB': return kids();
      case 'INPUT': return n.type === 'checkbox' ? (n.checked || n.hasAttribute('checked') ? '[x] ' : '[ ] ') : '';
      case 'IMG': return image(n, ctx);
      case 'A': return link(n, kids(), ctx);
      default: return kids();
    }
  }

  function image(n, ctx) {
    const src = n.getAttribute('src') || '';
    const alt = (n.getAttribute('alt') || '').replace(/[\[\]\n]/g, ' ').replace(/\s+/g, ' ').trim();
    if (ctx.opt.images === 'strip' || !src || src.startsWith('data:')) return '';
    if (n.getAttribute('width') === '1' || n.getAttribute('height') === '1') return '';
    if (ctx.opt.images === 'link') return '[' + (alt || 'image') + '](' + encUrl(src) + ')';
    return '![' + alt + '](' + encUrl(src) + ')';
  }

  function link(n, content, ctx) {
    const href = n.getAttribute('href') || '';
    const t = content.trim();
    if (!t) return content;
    if (/^[#¶§🔗]$/.test(t)) return '';
    if (!href || /^javascript:/i.test(href) || ctx.opt.links === 'strip' || ctx.inLink) return content;
    const lead = /^\s/.test(content) ? ' ' : '', trail = /\s$/.test(content) ? ' ' : '';
    if (ctx.opt.links === 'reference') {
      let i = ctx.refs.indexOf(href); if (i < 0) { ctx.refs.push(href); i = ctx.refs.length - 1; }
      return lead + '[' + t + '][' + (i + 1) + ']' + trail;
    }
    if (t === href || t === href.replace(/^https?:\/\//, '')) return lead + '<' + href + '>' + trail;
    return lead + '[' + t + '](' + encUrl(href) + ')' + trail;
  }

  function block(n, ctx) {
    switch (n.tagName) {
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
        const t = flat(n, Object.assign({}, ctx, { heading: true }));
        return t ? '#'.repeat(+n.tagName[1]) + ' ' + t : '';
      }
      case 'HR': return '---';
      case 'PRE': return codeBlock(n, ctx);
      case 'BLOCKQUOTE': {
        const t = blocks(n, ctx);
        return t ? t.split('\n').map(l => (l ? '> ' + l : '>')).join('\n') : '';
      }
      case 'UL': case 'OL': case 'MENU': case 'DIR': return list(n, ctx);
      case 'LI': return listItem(n, ctx.opt.bullet, ctx);
      case 'TABLE': return table(n, ctx);
      case 'SUMMARY': case 'DT': { const t = flat(n, ctx); return t ? '**' + t + '**' : ''; }
      case 'FIGCAPTION': case 'CAPTION': { const t = blocks(n, ctx); return t && !t.includes('\n') ? '*' + t + '*' : t; }
      case 'A': {
        // Card-style links wrapping blocks: link the first line of text.
        const t = blocks(n, Object.assign({}, ctx, { inLink: true }));
        const href = n.getAttribute('href');
        if (!t || !href || ctx.opt.links === 'strip' || /^javascript:/i.test(href)) return t;
        const lines = t.split('\n');
        const i = lines.findIndex(l => /\w/.test(l) && !/^!\[/.test(l));
        if (i < 0) return t;
        const m = lines[i].match(/^(#{1,6} |> )?(.*)$/);
        lines[i] = (m[1] || '') + link(n, m[2], ctx);
        return lines.join('\n');
      }
      default: return blocks(n, ctx);
    }
  }

  function list(n, ctx) {
    const ordered = n.tagName === 'OL';
    let num = parseInt(n.getAttribute('start'), 10); if (isNaN(num)) num = 1;
    const items = []; let loose = false;
    for (const c of n.children) {
      if (c.tagName === 'LI') {
        const out = listItem(c, ordered ? (num++) + '.' : ctx.opt.bullet, ctx);
        if (out) { items.push(out); if (/\n\n/.test(out) && c.querySelector(':scope > p ~ p, :scope > p ~ pre')) loose = true; }
      } else if (/^(UL|OL)$/.test(c.tagName) && items.length) {
        // Invalid but common: nested list directly inside a list.
        const sub = list(c, ctx);
        if (sub) items[items.length - 1] += '\n' + indent(sub, ordered ? 3 : 2);
      } else if (c.nodeType === 1) {
        const t = blocks(c, ctx); if (t) items.push(ctx.opt.bullet + ' ' + t);
      }
    }
    return items.join(loose ? '\n\n' : '\n');
  }

  const indent = (s, w) => s.split('\n').map(l => (l ? ' '.repeat(w) + l : l)).join('\n');

  function listItem(li, marker, ctx) {
    const hasP = !!li.querySelector(':scope > p ~ p');
    let t = blocks(li, ctx, hasP ? '\n\n' : '\n');
    if (!t) return '';
    const w = marker.length + 1;
    const lines = t.split('\n');
    return marker + ' ' + lines[0] + (lines.length > 1 ? '\n' + indent(lines.slice(1).join('\n'), w) : '');
  }

  function codeLang(pre) {
    if (!pre) return '';
    const code = pre.querySelector('code');
    const candidates = [pre, code, pre.parentElement, pre.parentElement && pre.parentElement.parentElement].filter(Boolean);
    for (const el of candidates) {
      const a = el.getAttribute('data-lang') || el.getAttribute('data-language') || el.getAttribute('lang');
      if (a && a.length < 20) return clean(a);
      const m = cls(el).match(/(?:^|\s)(?:language-|lang-|highlight-source-|highlight-|brush:\s*|sourceCode\s+)([a-z0-9_+#.-]+)/i);
      if (m) return clean(m[1]);
    }
    return '';
    function clean(l) { l = l.toLowerCase().replace(/[^a-z0-9_+#.-]/g, ''); return /^(plain|plaintext|text|none|nohighlight|txt|default)$/.test(l) ? '' : l; }
  }

  function preText(n) {
    let s = '';
    for (const c of n.childNodes) {
      if (c.nodeType === 3) s += c.nodeValue;
      else if (c.nodeType === 1) {
        if (c.tagName === 'BR') { s += '\n'; continue; }
        if (SKIP.has(c.tagName)) continue;
        const inner = preText(c);
        s += inner;
        if (/^(DIV|P|LI|TR)$/.test(c.tagName) && inner && !inner.endsWith('\n')) s += '\n';
      }
    }
    return s;
  }

  function codeBlock(pre, ctx) {
    let code = preText(pre).replace(/ /g, ' ').replace(/^\n/, '').replace(/\s+$/, '');
    if (!code.trim()) return '';
    const lang = ctx.opt.codeLang ? codeLang(pre) : '';
    const ch = ctx.opt.fence[0];
    const runs = code.match(new RegExp('^\\s*' + (ch === '`' ? '`' : '~') + '{3,}', 'gm')) || [];
    const len = Math.max(3, ...runs.map(r => r.trim().length + 1));
    const f = ch.repeat(len);
    return f + lang + '\n' + code + '\n' + f;
  }

  function table(t, ctx) {
    if (t.querySelector('table')) return blocks(t, ctx); // layout table
    const rows = [...t.rows];
    if (!rows.length) return '';
    const cctx = Object.assign({}, ctx, { table: true });
    const cell = c => blocks(c, cctx).replace(/\n+/g, '<br>').replace(/\|/g, '\\|').trim();
    const grid = [], span = [];
    let headerRows = 0;
    rows.forEach((r, ri) => {
      const row = []; let col = 0;
      const put = v => { while (span[col] && span[col].n > 0) { row.push(span[col].v); span[col].n--; col++; } row[col++] = v; };
      for (const c of r.cells) {
        const v = cell(c);
        const cs = Math.min(parseInt(c.getAttribute('colspan'), 10) || 1, 50);
        const rs = Math.min(parseInt(c.getAttribute('rowspan'), 10) || 1, 500);
        for (let k = 0; k < cs; k++) { const at = col; put(k ? '' : v); if (rs > 1) span[at] = { v: '', n: rs - 1 }; }
      }
      while (span[col] && span[col].n > 0) { row.push(span[col].v); span[col].n--; col++; }
      if ((r.parentElement && r.parentElement.tagName === 'THEAD') || ([...r.cells].every(c => c.tagName === 'TH') && ri === headerRows)) headerRows = ri + 1;
      grid.push(row);
    });
    const cols = Math.max(...grid.map(r => r.length));
    if (!cols) return '';
    if (grid.length === 1 && cols === 1) return blocks(rows[0].cells[0], ctx);
    const body = grid.filter((r, i) => i === 0 || r.some(v => v));
    const align = [...(rows[0].cells)].flatMap(c => {
      const a = (c.getAttribute('align') || c.style.textAlign || '').toLowerCase();
      const s = a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---';
      return Array(parseInt(c.getAttribute('colspan'), 10) || 1).fill(s);
    });
    const line = r => '| ' + Array.from({ length: cols }, (_, i) => r[i] || '').join(' | ') + ' |';
    const out = [line(body[0]), '| ' + Array.from({ length: cols }, (_, i) => align[i] || '---').join(' | ') + ' |'];
    body.slice(1).forEach(r => out.push(line(r)));
    const cap = t.caption ? flat(t.caption, ctx) : '';
    return (cap ? '*' + cap + '*\n\n' : '') + out.join('\n');
  }

  /* ---------------------------- Public API ---------------------------- */
  function getSelectionRoot() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !sel.toString().trim()) return null;
    const wrap = document.createElement('div');
    for (let i = 0; i < sel.rangeCount; i++) {
      const r = sel.getRangeAt(i);
      let frag = r.cloneContents();
      let anc = r.commonAncestorContainer; if (anc.nodeType !== 1) anc = anc.parentElement;
      // Preserve context when the selection sits inside code / lists / tables.
      const nest = (outer, inner) => { inner.appendChild(frag); if (outer !== inner) outer.appendChild(inner); frag = outer; };
      const pre = anc && anc.closest('pre');
      if (pre) {
        const p = pre.cloneNode(false); p.setAttribute('data-lang', codeLang(pre) || 'text');
        const code = anc.closest('code'); nest(p, code ? code.cloneNode(false) : p);
      } else if (anc && anc.tagName === 'CODE') nest(anc.cloneNode(false), anc.cloneNode(false));
      else if (anc && /^(UL|OL)$/.test(anc.tagName)) nest(anc.cloneNode(false), anc.cloneNode(false));
      else if (anc && /^(TABLE|TBODY|THEAD|TFOOT|TR)$/.test(anc.tagName)) {
        const tbl = anc.closest('table').cloneNode(false);
        nest(tbl, anc.tagName === 'TR' ? anc.cloneNode(false) : tbl);
      }
      wrap.appendChild(frag);
    }
    // Fix relative URLs in the detached fragment.
    wrap.querySelectorAll('a[href]').forEach(a => a.setAttribute('href', abs(a.getAttribute('href'))));
    wrap.querySelectorAll('img').forEach(img => {
      const s = img.getAttribute('data-src') || img.getAttribute('src'); if (s) img.setAttribute('src', abs(s));
    });
    wrap.querySelectorAll(JUNK_SEL).forEach(n => n.remove());
    return wrap;
  }

  function meta(name) {
    const m = document.querySelector('meta[property="' + name + '"],meta[name="' + name + '"]');
    return m ? (m.getAttribute('content') || '').trim() : '';
  }

  function pageTitle() {
    return (meta('og:title') || document.title || (document.querySelector('h1') || {}).textContent || location.hostname || 'Untitled').replace(/\s+/g, ' ').trim();
  }

  // Selected text inside <textarea>/<input> is invisible to getSelection(); read it directly.
  function fieldSelection() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    if (!el || !/^(TEXTAREA|INPUT)$/.test(el.tagName)) return '';
    try { return (el.value || '').slice(el.selectionStart, el.selectionEnd); } catch (e) { return ''; }
  }
  function hasSelection() {
    const s = getSelection();
    return !!((s && !s.isCollapsed && s.toString().trim()) || fieldSelection().trim());
  }

  /**
   * mode: 'auto' | 'selection' | 'article' | 'page'
   */
  function convert(mode, options) {
    const opt = Object.assign({}, DEFAULTS, options || {});
    if (mode === 'auto') mode = hasSelection() ? 'selection' : 'article';
    let root = null;
    if (mode === 'selection') {
      const field = fieldSelection();
      if (field.trim()) return { markdown: field.trim() + '\n', title: pageTitle(), url: location.href, mode, hasSelection: true };
      root = getSelectionRoot();
      if (!root) return { markdown: '', title: pageTitle(), url: location.href, mode, hasSelection: false, empty: true };
    }
    if (!root) {
      const main = mode === 'article' ? findMain(document) : document.body;
      root = cloneClean(Array.isArray(main) ? main : [main], mode === 'article');
    }
    const ctx = { opt, refs: [] };
    let md = blocks(root, ctx);
    const title = pageTitle();
    if (mode !== 'selection' && opt.titleHeading && !/^# /.test(md)) md = '# ' + title + '\n\n' + md;
    if (ctx.refs.length) md += '\n\n' + ctx.refs.map((u, i) => '[' + (i + 1) + ']: ' + encUrl(u)).join('\n');
    md = md.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim() + '\n';
    if (opt.frontMatter) {
      const q = s => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
      const fm = ['---', 'title: ' + q(title), 'source: ' + q(location.href)];
      const author = meta('author') || meta('article:author');
      if (author && !/^https?:/.test(author)) fm.push('author: ' + q(author));
      const desc = meta('description') || meta('og:description');
      if (desc) fm.push('description: ' + q(desc.slice(0, 300)));
      fm.push('captured: ' + new Date().toISOString().slice(0, 10), '---', '');
      md = fm.join('\n') + '\n' + md;
    }
    return { markdown: md, title, url: location.href, mode, hasSelection: hasSelection() };
  }

  globalThis.W2MD = { convert, hasSelection, DEFAULTS };
})();
