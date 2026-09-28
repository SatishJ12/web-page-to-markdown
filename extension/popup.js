/* popup.js — preview, settings, copy & download */
const DEFAULTS = { images: 'keep', links: 'inline', fence: '```', codeLang: true, bullet: '-', frontMatter: false, titleHeading: true };
const $ = (s) => document.querySelector(s);
const preview = $('#preview'), stats = $('#stats');
let opt = { ...DEFAULTS }, tabId = null, selFrame = 0, mode = 'article', title = 'page', seq = 0;

function setStats(text, err) { stats.textContent = text; stats.className = err ? 'err' : ''; }

function updateStats() {
  const md = preview.value;
  const words = (md.match(/\S+/g) || []).length;
  setStats(words.toLocaleString() + ' words · ' + md.length.toLocaleString() + ' chars · ~' + Math.ceil(md.length / 4).toLocaleString() + ' tokens');
}

function setMode(m) {
  mode = m;
  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
}

// Inject into every frame we're allowed to (selections often live in iframes: editors, embeds, docs viewers).
async function inject() {
  try { await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['turndown_parser.js'] }); }
  catch (e) { await chrome.scripting.executeScript({ target: { tabId }, files: ['turndown_parser.js'] }); }
}

async function findSelectionFrame() {
  let results = [];
  try {
    results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => !!(globalThis.W2MD && globalThis.W2MD.hasSelection()) });
  } catch (e) {
    results = await chrome.scripting.executeScript({ target: { tabId }, func: () => !!(globalThis.W2MD && globalThis.W2MD.hasSelection()) });
  }
  const hit = results.find(r => r.result);
  return hit ? hit.frameId : -1;
}

async function convert() {
  const my = ++seq;
  preview.value = ''; preview.placeholder = 'Converting…';
  try {
    if (mode === 'selection') { const f = await findSelectionFrame(); if (f >= 0) selFrame = f; }
    const frameIds = [mode === 'selection' ? selFrame : 0];
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId, frameIds }, func: (m, o) => globalThis.W2MD.convert(m, o), args: [mode, opt]
    });
    if (my !== seq) return;
    title = result.title || 'page';
    if (result.empty) {
      preview.placeholder = 'No text is selected on this page.\n\n1. Close this popup\n2. Highlight the part of the page you want\n3. Click the extension icon again (or right-click → "Copy selection as Markdown")';
      setStats('Tip: select text first, then open the popup — it will switch to Selection automatically.');
      return;
    }
    preview.value = result.markdown;
    updateStats();
  } catch (e) {
    setStats('Conversion failed: ' + e.message, true);
  }
}

async function init() {
  opt = Object.assign({}, DEFAULTS, await chrome.storage.sync.get(DEFAULTS));
  for (const el of document.querySelectorAll('#settings [name]')) {
    if (el.type === 'checkbox') el.checked = !!opt[el.name]; else el.value = opt[el.name];
    el.addEventListener('change', async () => {
      opt[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      await chrome.storage.sync.set({ [el.name]: opt[el.name] });
      convert();
    });
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab && tab.id;
  if (!tab || !/^(https?|file):/.test(tab.url || '')) {
    preview.placeholder = 'This page can’t be converted (browser pages, the Web Store and PDFs are protected by Chrome).';
    setStats('Open a regular web page and try again.', true);
    document.querySelectorAll('button:not(#toggleSettings):not(#supportToggle)').forEach(b => { b.disabled = true; });
    return;
  }
  try {
    await inject();
    selFrame = await findSelectionFrame();
    const sel = selFrame >= 0;
    if (!sel) selFrame = 0;
    $('.seg [data-mode="selection"]').title = sel ? 'Convert only the highlighted text' : 'Highlight text on the page first, then reopen';
    setMode(sel ? 'selection' : 'article');
    convert();
  } catch (e) {
    preview.placeholder = 'Chrome blocked access to this page.';
    setStats(e.message, true);
  }
}

document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.mode === mode) return;
  setMode(b.dataset.mode); convert();
}));

$('#toggleSettings').addEventListener('click', (e) => {
  const s = $('#settings'); s.hidden = !s.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!s.hidden));
});

preview.addEventListener('input', updateStats);

function flash(btn, text) {
  const old = btn.textContent; btn.textContent = text; btn.classList.add('done');
  setTimeout(() => { btn.textContent = old; btn.classList.remove('done'); }, 1400);
}

$('#copy').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  try { await navigator.clipboard.writeText(preview.value); }
  catch (err) { preview.select(); document.execCommand('copy'); }
  flash(btn, 'Copied ✓');
});

$('#download').addEventListener('click', (e) => {
  const name = title.replace(/[\\/:*?"<>|#\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'page';
  const url = URL.createObjectURL(new Blob([preview.value], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name + '.md'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  flash(e.currentTarget, 'Saved ✓');
});

$('#supportToggle').addEventListener('click', (e) => {
  const p = $('#supportPanel'); p.hidden = !p.hidden;
  document.body.classList.toggle('tip', !p.hidden);
  e.currentTarget.setAttribute('aria-expanded', String(!p.hidden));
  e.currentTarget.textContent = p.hidden ? '☕ Enjoying it? Support the developer' : 'Close ✕';
  if (!p.hidden) p.scrollIntoView({ block: 'nearest' });
});

init();
