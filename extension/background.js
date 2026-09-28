/* background.js — Context Menu Handler (MV3 service worker) */
const DEFAULTS = { images: 'keep', links: 'inline', fence: '```', codeLang: true, bullet: '-', frontMatter: false, titleHeading: true };

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    const add = (id, title, contexts) => chrome.contextMenus.create({ id, title, contexts });
    add('copy-selection', 'Copy selection as Markdown', ['selection']);
    add('copy-page', 'Copy page as Markdown', ['page']);
    add('download-page', 'Download full page as Markdown', ['page', 'selection']);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;
  const frameId = info.frameId || 0;
  if (info.menuItemId === 'copy-selection') run(tab.id, frameId, 'selection', 'copy');
  else if (info.menuItemId === 'copy-page') run(tab.id, 0, 'article', 'copy');
  else if (info.menuItemId === 'download-page') run(tab.id, 0, 'article', 'download');
});

chrome.commands.onCommand.addListener((cmd, tab) => {
  if (cmd === 'copy-markdown' && tab && tab.id) run(tab.id, 0, 'auto', 'copy');
});

async function run(tabId, frameId, mode, action) {
  const opt = Object.assign({}, DEFAULTS, await chrome.storage.sync.get(DEFAULTS));
  const target = { tabId, frameIds: [frameId] };
  try {
    await chrome.scripting.executeScript({ target, files: ['turndown_parser.js'] });
    await chrome.scripting.executeScript({ target, func: pageAction, args: [mode, opt, action] });
  } catch (e) {
    console.warn('Markdown conversion unavailable on this page:', e.message);
  }
}

/* Injected into the page (isolated world). Converts, then copies or downloads, then shows a toast. */
async function pageAction(mode, opt, action) {
  const toast = (msg) => {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px';
    const root = host.attachShadow({ mode: 'closed' });
    const box = document.createElement('div');
    box.textContent = msg;
    box.style.cssText = 'font:500 13px/1.4 system-ui,sans-serif;color:#fff;background:#111827;padding:10px 14px;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.25);border-left:4px solid #4f46e5';
    root.appendChild(box);
    document.documentElement.appendChild(host);
    setTimeout(() => host.remove(), 2200);
  };
  let res;
  try { res = globalThis.W2MD.convert(mode, opt); } catch (e) { toast('Markdown conversion failed'); return; }
  if (res.empty) { toast('No text selected — highlight something first'); return; }
  if (action === 'download') {
    const name = (res.title || 'page').replace(/[\\/:*?"<>|#\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'page';
    const url = URL.createObjectURL(new Blob([res.markdown], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = name + '.md'; a.style.display = 'none';
    document.documentElement.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Downloaded ' + name + '.md');
    return;
  }
  let ok = false;
  try { await navigator.clipboard.writeText(res.markdown); ok = true; } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = res.markdown; ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
    document.documentElement.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    ta.remove();
  }
  const words = (res.markdown.match(/\S+/g) || []).length;
  toast(ok ? 'Copied ' + (res.mode === 'selection' ? 'selection' : 'page') + ' as Markdown (' + words.toLocaleString() + ' words)' : 'Copy failed — use the toolbar popup');
}
