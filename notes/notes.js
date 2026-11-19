/*
 * Review notes layer for the concept pages.
 * Reviewers sign in with a name and the shared password, then pin notes to a spot
 * on the page or to a piece of selected text. Everything is drawn inside a shadow
 * root so the page's own styles and the notes never affect each other.
 */
(function () {
'use strict';
if (window.__gobNotes) return;
window.__gobNotes = true;

var script = document.currentScript;
var API = script && script.src ? new URL('api.php', script.src).href : 'notes/api.php';
var PAGE = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
if (!/^[a-z0-9][a-z0-9-]{0,40}\.html$/.test(PAGE)) PAGE = 'index.html';
var PAGES = {
  'index.html': 'Concepts menu',
  'dark.html': 'Dark Luxury, dark',
  'contrast.html': 'Dark Luxury, dark and light',
  'light.html': 'Dark Luxury, light',
  'modern-classic.html': 'Modern Classic',
  'contemporary.html': 'Contemporary',
  'gallery.html': 'Gallery'
};
var PAGE_ORDER = Object.keys(PAGES);

var store = {
  get: function (k) { try { return localStorage.getItem('gobNotes.' + k); } catch (e) { return null; } },
  set: function (k, v) { try { if (v == null) localStorage.removeItem('gobNotes.' + k); else localStorage.setItem('gobNotes.' + k, v); } catch (e) {} }
};

var S = {
  token: store.get('token') || '',
  name: store.get('name') || '',
  notes: [],
  num: {},
  loaded: false,
  show: store.get('show') !== '0',
  adding: false,
  panel: false,
  tab: 'page',
  filter: 'open',
  open: null,
  draft: null,
  modal: null,
  busy: false,
  pendingAdd: false
};

/* ---------- small helpers ---------- */

function h(tag, attrs, kids) {
  var el = document.createElement(tag), k, v;
  if (attrs) for (k in attrs) {
    v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  (kids || []).forEach(function (c) {
    if (c == null || c === false) return;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return el;
}

/* Icons are fixed strings written here, never built from note content. */
var ICON = {
  note: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z"></path></svg>',
  plus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>',
  eye: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"></path><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6A16.800 16.800 0 0 0 2 12s3.600 7 10 7a10 10 0 0 0 4.200-.900"></path></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>',
  lock: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>',
  check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.500l4.500 4.500L19 7.500"></path></svg>'
};
function icon(name) { return h('span', { class: 'ic', html: ICON[name] }); }

function phone() { return window.innerWidth < 640; }
function device(vw) { return vw && vw < 600 ? 'Phone' : vw && vw < 1000 ? 'Tablet' : 'Desktop'; }
function leftOn(vw) { return vw && vw < 600 ? 'Left on a phone' : vw && vw < 1000 ? 'Left on a tablet' : 'Left on a computer'; }
function touch() { return !!(window.matchMedia && window.matchMedia('(hover: none)').matches); }
function ago(ts) {
  var s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function stamp(ts) { return new Date(ts * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function byId(id) { for (var i = 0; i < S.notes.length; i++) if (S.notes[i].id === id) return S.notes[i]; return null; }
function notesOn(page) { return S.notes.filter(function (n) { return n.page === page; }); }
function openCount(list) { return list.filter(function (n) { return !n.resolved; }).length; }
function snippet(el) {
  var t = el.getAttribute && el.getAttribute('alt') || el.textContent || '';
  return t.replace(/\s+/g, ' ').trim().slice(0, 80);
}

/* ---------- talking to the server ---------- */

function api(action, data) {
  var body = { action: action, token: S.token || '' }, k;
  for (k in (data || {})) body[k] = data[k];
  return fetch(API, {
    method: 'POST', cache: 'no-store', credentials: 'omit',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(function (r) {
    return r.json().catch(function () { return { error: 'The notes server did not answer. Please try again.' }; }).then(function (j) {
      if (r.status === 401 && j.auth) { signOut(); S.modal = { kind: 'signin', error: 'Please sign in again.' }; renderAll(); }
      if (!r.ok || j.error) throw new Error(j.error || 'Something went wrong. Please try again.');
      return j;
    });
  }, function () { throw new Error('No connection. Please try again.'); });
}

function setNotes(list) {
  S.notes = Array.isArray(list) ? list : [];
  S.loaded = true;
  S.num = {};
  var seen = {};
  S.notes.forEach(function (n) { seen[n.page] = (seen[n.page] || 0) + 1; S.num[n.id] = seen[n.page]; });
  if (S.open && !byId(S.open)) S.open = null;
}

function refresh(quiet) {
  if (!S.token) return Promise.resolve();
  return api('list').then(function (j) {
    setNotes(j.notes);
    if (quiet && typing()) { renderDock(); renderPanel(); layout(); }
    else renderAll();
  }).catch(function (e) { if (!quiet) toast(e.message); });
}

function act(action, data, after) {
  if (S.busy) return;
  S.busy = true;
  api(action, data).then(function (j) {
    S.busy = false;
    setNotes(j.notes);
    if (after) after(j);
    renderAll();
  }).catch(function (e) { S.busy = false; toast(e.message); });
}

function signOut() {
  S.token = ''; store.set('token', null);
  S.notes = []; S.num = {}; S.loaded = false;
  S.open = null; S.draft = null; S.adding = false; S.panel = false;
}

/* ---------- anchoring notes to the page ---------- */

function cssPath(el) {
  var parts = [];
  while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && document.querySelectorAll('#' + el.id).length === 1) {
      parts.unshift('#' + el.id);
      return parts.join(' > ');
    }
    var tag = el.localName, i = 1, s = el;
    while ((s = s.previousElementSibling)) if (s.localName === tag) i++;
    parts.unshift(tag + ':nth-of-type(' + i + ')');
    el = el.parentElement;
  }
  parts.unshift('body');
  return parts.join(' > ');
}

function anchorFromPoint(el, cx, cy) {
  if (!el || el.nodeType !== 1 || el === document.documentElement) el = document.body;
  var svg = el.closest && el.closest('svg');
  if (svg) el = svg;
  var r = el.getBoundingClientRect();
  var fx = r.width ? (cx - r.left) / r.width : 0, fy = r.height ? (cy - r.top) / r.height : 0;
  return { sel: cssPath(el), fx: Math.max(0, Math.min(1, fx)), fy: Math.max(0, Math.min(1, fy)), text: snippet(el), quote: '', qs: 0 };
}

function anchorFromRange(range) {
  var c = range.commonAncestorContainer, el = c.nodeType === 1 ? c : c.parentElement;
  if (!el) return null;
  var pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return { sel: cssPath(el), fx: 0, fy: 0, text: snippet(el), quote: range.toString(), qs: pre.toString().length };
}

function rangeFor(el, start, len) {
  var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), n, pos = 0, r = document.createRange(), started = false, end = start + len;
  while ((n = w.nextNode())) {
    var L = n.data.length;
    if (!started && start < pos + L) { r.setStart(n, start - pos); started = true; }
    if (started && end <= pos + L) { r.setEnd(n, end - pos); return r; }
    pos += L;
  }
  return null;
}

function mergeRects(list) {
  var out = [], i, j, r, skip;
  for (i = 0; i < list.length && out.length < 60; i++) {
    r = list[i];
    if (r.width < 1 || r.height < 1) continue;
    skip = false;
    for (j = 0; j < out.length; j++) {
      var o = out[j];
      if (r.left >= o.left - 1 && r.right <= o.right + 1 && r.top >= o.top - 1 && r.bottom <= o.bottom + 1) { skip = true; break; }
      if (o.left >= r.left - 1 && o.right <= r.right + 1 && o.top >= r.top - 1 && o.bottom <= r.bottom + 1) { out[j] = r; skip = true; break; }
    }
    if (!skip) out.push(r);
  }
  return out;
}

/* Finds where a note sits right now, in viewport coordinates. Null when its part of the page is not showing. */
function locate(a) {
  var el = null;
  try { el = document.querySelector(a.sel); } catch (e) {}
  if (!el || el === host) return null;
  var r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  var res = { x: r.left + a.fx * r.width, y: r.top + a.fy * r.height, rects: null, changed: false };
  if (a.quote) {
    var t = el.textContent, s = t.substr(a.qs, a.quote.length) === a.quote ? a.qs : t.indexOf(a.quote);
    if (s < 0) { res.changed = true; res.x = r.left; res.y = r.top; }
    else {
      var rg = rangeFor(el, s, a.quote.length), rs = rg ? mergeRects(rg.getClientRects()) : [];
      if (rs.length) { res.rects = rs; res.x = rs[0].left; res.y = rs[0].top; }
    }
  } else if (a.text && snippet(el) !== a.text) res.changed = true;
  return res;
}

/* ---------- the shadow root and its fixed slots ---------- */

var CSS = [
':host{--a:#D8381E;--a2:#B92D16;--ink:#16161A;--mut:#5F5F6B;--line:#E3E3E9;--soft:#F4F4F7;--ok:#2A7A53}',
'*{box-sizing:border-box}',
'.layer,.ui{font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);-webkit-text-size-adjust:100%;text-align:left;letter-spacing:0}',
'.layer,.ui{position:absolute;left:0;top:0;width:0;height:0}',
'button{font:inherit;color:inherit;cursor:pointer;border:0;background:none;padding:0;margin:0;-webkit-tap-highlight-color:transparent}',
'button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #6AA8FF;outline-offset:2px}',
'button[disabled]{opacity:.55;cursor:default}',
'input,textarea{font:inherit;font-size:16px;color:var(--ink);width:100%;border:1px solid #C9C9D3;border-radius:8px;padding:10px 12px;background:#fff;margin:0}',
'textarea{display:block;resize:vertical;min-height:84px;line-height:1.4}',
'label{display:block;font-size:13px;font-weight:600;margin:0 0 6px}',
'.ic{display:inline-flex}',
'.hide{display:none!important}',

'.hl{position:absolute;background:rgba(255,193,7,.4);box-shadow:0 2px 0 #D99A00;pointer-events:none;border-radius:2px}',
'.hl.done{background:rgba(42,122,83,.22);box-shadow:0 2px 0 var(--ok)}',
'.pin{position:absolute;width:28px;height:28px;margin-top:-28px;border-radius:50% 50% 50% 4px;background:var(--a);color:#fff;border:2px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.45);font-weight:700;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center;transform-origin:0 100%;transition:transform .12s ease}',
'.pin::after{content:"";position:absolute;inset:-10px}',
'.pin:hover,.pin.on{transform:scale(1.18)}',
'.pin.on{box-shadow:0 0 0 3px rgba(216,56,30,.35),0 2px 10px rgba(0,0,0,.45)}',
'.pin.done{background:var(--ok)}',
'.pin.draft{background:var(--ink)}',

'.dock{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));max-width:calc(100vw - 24px);display:flex;align-items:center;gap:4px;padding:5px;background:var(--ink);color:#fff;border-radius:999px;box-shadow:0 8px 28px rgba(0,0,0,.4),0 0 0 1px rgba(255,255,255,.18)}',
'.dock button{height:44px;min-width:44px;padding:0 16px;border-radius:999px;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:600;white-space:nowrap}',
'.dock button:hover{background:rgba(255,255,255,.12)}',
'.dock .pri{background:var(--a)}.dock .pri:hover{background:var(--a2)}',
'.dock .sq{padding:0}',
'.dock .ghost{background:rgba(255,255,255,.16)}',
'.dock .hint{padding:4px 10px 4px 14px;font-weight:500;line-height:1.25}',
'.badge{min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:#fff;color:var(--ink);font-size:12px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}',


'.bubble{position:absolute;height:40px;padding:0 14px;border-radius:999px;background:var(--ink);color:#fff;font-weight:600;display:flex;align-items:center;gap:8px;box-shadow:0 6px 20px rgba(0,0,0,.4),0 0 0 1px rgba(255,255,255,.18);white-space:nowrap}',

'.pop{position:absolute;width:340px;max-height:min(560px,86vh);display:flex;flex-direction:column;background:#fff;border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.32),0 0 0 1px rgba(0,0,0,.1);overflow:hidden}',
'.pop.sheet{position:fixed;left:0;right:0;bottom:0;top:auto;width:auto;max-height:70vh;border-radius:18px 18px 0 0;padding-bottom:env(safe-area-inset-bottom,0px)}',
'.pop.side{position:fixed;top:16px;width:360px;max-height:calc(100vh - 32px)}',
'.pop.side.r{max-height:calc(100vh - 104px)}',
'.hd{display:flex;align-items:center;gap:10px;padding:12px 8px 12px 16px;border-bottom:1px solid var(--line);flex:none}',
'.hd h2{margin:0;font-size:15px;font-weight:700;flex:1;min-width:0}',
'.x{width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--mut);flex:none}.x:hover{background:var(--soft);color:var(--ink)}',
'.num{width:24px;height:24px;border-radius:50% 50% 50% 3px;background:var(--a);color:#fff;font-size:12px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex:none}',
'.num.done{background:var(--ok)}',
'.tag{font-size:12px;font-weight:600;color:var(--mut);background:var(--soft);border-radius:6px;padding:2px 7px;white-space:nowrap}',
'.body{padding:14px 16px;overflow:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:14px;flex:1 1 auto;min-height:0}',
'.ctx{margin:0;padding:8px 10px;border-left:3px solid #D99A00;background:#FFF6DA;border-radius:0 6px 6px 0;font-size:13px;color:#4A3A00;overflow-wrap:anywhere}',
'.ctx.plain{border-left-color:#C9C9D3;background:var(--soft);color:var(--mut)}',
'.warn{margin:0;font-size:13px;color:#7A4B00;background:#FFF4DC;border-radius:6px;padding:8px 10px}',
'.msg{display:flex;flex-direction:column;gap:3px}',
'.msg + .msg{margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}',
'.who{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}',
'.who b{font-weight:700}.who span{font-size:12px;color:var(--mut)}',
'.who .del{font-size:12px;color:var(--mut);text-decoration:underline;padding:10px 8px;margin:-10px 0}.who .del:hover{color:var(--a2)}',
'.txt{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}',
'.res{margin:0;display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--ok)}',
'.ft{padding:12px 16px 14px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:10px;flex:none;background:#fff}',
'.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
'.btn{height:44px;padding:0 16px;border-radius:10px;font-weight:600;background:var(--soft);color:var(--ink);display:inline-flex;align-items:center;justify-content:center;gap:8px}',
'.btn:hover{background:#E9E9EF}',
'.btn.pri{background:var(--a);color:#fff}.btn.pri:hover{background:var(--a2)}',
'.btn.grow{flex:1}',
'.as{font-size:12px;color:var(--mut);margin:0}',
'.link{color:var(--mut);text-decoration:underline;font-size:13px;padding:12px 0}.link:hover{color:var(--ink)}',

'.panel{position:fixed;top:0;right:0;bottom:0;width:400px;max-width:100vw;display:flex;flex-direction:column;background:#fff;box-shadow:-10px 0 44px rgba(0,0,0,.3)}',
'.panel.sheet{top:auto;left:0;width:auto;height:80vh;border-radius:18px 18px 0 0;box-shadow:0 -10px 44px rgba(0,0,0,.3);padding-bottom:env(safe-area-inset-bottom,0px)}',
'.seg{display:flex;margin:12px 16px 0;border:1px solid #C9C9D3;border-radius:10px;overflow:hidden;flex:none}',
'.seg button{flex:1;height:44px;font-weight:600;font-size:13px;color:var(--mut)}',
'.seg button + button{border-left:1px solid #C9C9D3}',
'.seg button:hover{background:var(--soft)}',
'.seg button[aria-pressed="true"]{background:var(--ink);color:#fff}',
'.filt{display:flex;gap:20px;padding:2px 16px 0;border-bottom:1px solid var(--line);flex:none}',
'.filt button{height:44px;font-weight:600;font-size:13px;color:var(--mut);border-bottom:2px solid transparent}',
'.filt button[aria-pressed="true"]{color:var(--ink);border-bottom-color:var(--a)}',
'.list{overflow:auto;-webkit-overflow-scrolling:touch;flex:1 1 auto;min-height:0;padding:6px 0}',
'.grp{margin:0;padding:14px 16px 6px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);display:flex;justify-content:space-between;gap:8px;align-items:baseline}',
'.grp a{color:var(--mut);text-transform:none;letter-spacing:0;font-weight:600}',
'.item{display:flex;gap:12px;width:100%;padding:12px 16px;text-align:left;align-items:flex-start;color:var(--ink);text-decoration:none}',
'.item:hover{background:var(--soft)}',
'.item.cur{background:#FBEDEA}',
'.item .col{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}',
'.item .clip{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}',
'.item .meta{font-size:12px;color:var(--mut);display:flex;gap:6px;flex-wrap:wrap;align-items:center}',
'.empty{padding:28px 20px;color:var(--mut);text-align:center;margin:0}',
'.pf{padding:10px 16px 12px;border-top:1px solid var(--line);flex:none;display:flex;flex-direction:column;gap:2px}',
'.pf .row{gap:0 18px}',
'.pf .top{display:flex;align-items:center;justify-content:space-between;gap:12px}',

'.scrim{position:fixed;inset:0;background:rgba(10,10,16,.55);display:flex;align-items:center;justify-content:center;padding:16px}',
'.card{width:380px;max-width:100%;max-height:100%;overflow:auto;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.4);padding:22px;display:flex;flex-direction:column;gap:16px}',
'.card h2{margin:0;font-size:19px;font-weight:700}',
'.card p{margin:0;color:var(--mut)}',
'.err{margin:0;color:#A32612!important;font-weight:600}',
'.toast{position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);width:max-content;max-width:calc(100vw - 24px);display:flex;align-items:center;gap:14px;padding:12px 18px;border-radius:12px;background:var(--ink);color:#fff;font-weight:500;box-shadow:0 8px 28px rgba(0,0,0,.4),0 0 0 1px rgba(255,255,255,.18)}',
'.toast button{height:36px;padding:0 12px;border-radius:8px;background:rgba(255,255,255,.18);font-weight:700;flex:none}',
'@media (max-width:639px){.dock{right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px))}.dock button{padding:0 14px}}',
'@media (prefers-reduced-motion:reduce){.pin{transition:none}}'
].join('\n');

var host = document.createElement('gob-notes');
host.style.cssText = 'all:initial;display:block;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483000';
var root = host.attachShadow({ mode: 'open' });
var layer = h('div', { class: 'layer' });
var ui = h('div', { class: 'ui' });
var dockEl = h('div'), bubbleEl = h('div'), popEl = h('div'), panelEl = h('div'), modalEl = h('div'), toastEl = h('div');
[popEl, bubbleEl, dockEl, panelEl, modalEl, toastEl].forEach(function (e) { ui.appendChild(e); });
root.appendChild(h('style', { text: CSS }));
root.appendChild(layer);
root.appendChild(ui);

var pageStyle = h('style', { text: 'html.gob-notes-adding,html.gob-notes-adding *{cursor:crosshair!important}' });

function inUI(e) { return e.composedPath ? e.composedPath().indexOf(host) >= 0 : host.contains(e.target); }
function origin() { var r = host.getBoundingClientRect(); return { x: r.left, y: r.top }; }
function typing() {
  var a = root.activeElement;
  if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) return true;
  var t = popEl.querySelector('textarea');
  return !!(t && t.value);
}

var toastTimer = 0;
function toast(msg, label, fn) {
  toastEl.className = 'toast';
  toastEl.setAttribute('role', 'status');
  toastEl.textContent = '';
  toastEl.appendChild(h('span', { text: msg }));
  if (label) toastEl.appendChild(h('button', { type: 'button', text: label, onclick: function () { toastEl.className = 'hide'; fn(); } }));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toastEl.className = 'hide'; }, label ? 8000 : 4200);
}

/* ---------- pins and highlights ---------- */

var pins = {}, marks = {};

function visibleNotes() {
  if (!S.token || !S.show) return [];
  return notesOn(PAGE).filter(function (n) { return !n.resolved || n.id === S.open || S.filter === 'resolved'; });
}

function layout() {
  var o = origin(), want = {}, docW = document.documentElement.clientWidth;
  var list = visibleNotes().map(function (n) { return { id: n.id, a: n.anchor, label: String(S.num[n.id] || ''), done: n.resolved, note: n }; });
  if (S.draft) list.push({ id: 'draft', a: S.draft.anchor, label: '+', draft: true });
  var popAt = null, popKey = S.draft ? 'draft' : S.open;

  list.forEach(function (it) {
    var p = locate(it.a);
    if (it.note) it.note._lost = !p; if (it.note) it.note._changed = !!(p && p.changed);
    if (!p) return;
    want[it.id] = true;
    var x = Math.max(2, Math.min(docW - 36, p.x - o.x)), y = Math.max(40, p.y - o.y);
    var pin = pins[it.id];
    if (!pin) {
      pin = pins[it.id] = h('button', { type: 'button' });
      if (!it.draft) pin.addEventListener('click', (function (id) { return function () { openNote(id, false); }; })(it.id));
      layer.appendChild(pin);
    }
    pin.className = 'pin' + (it.done ? ' done' : '') + (it.draft ? ' draft' : '') + (it.id === S.open ? ' on' : '');
    pin.textContent = it.label;
    pin.setAttribute('aria-label', it.draft ? 'New note' : 'Note ' + it.label + (it.note ? ' from ' + it.note.author : ''));
    pin.style.left = x + 'px';
    pin.style.top = y + 'px';
    if (it.id === popKey) popAt = { vx: p.x };

    var sig = p.rects ? p.rects.map(function (r) { return [Math.round(r.left - o.x), Math.round(r.top - o.y), Math.round(r.width), Math.round(r.height)].join(','); }).join(';') + (it.done ? 'd' : '') : '';
    var mk = marks[it.id];
    if (mk && mk.sig !== sig) { layer.removeChild(mk.el); mk = marks[it.id] = null; }
    if (sig && !mk) {
      var box = h('div');
      p.rects.forEach(function (r) {
        box.appendChild(h('div', { class: 'hl' + (it.done ? ' done' : ''), style: 'left:' + (r.left - o.x) + 'px;top:' + (r.top - o.y) + 'px;width:' + r.width + 'px;height:' + r.height + 'px' }));
      });
      layer.insertBefore(box, layer.firstChild);
      marks[it.id] = { sig: sig, el: box };
    }
  });

  Object.keys(pins).forEach(function (id) { if (!want[id]) { layer.removeChild(pins[id]); delete pins[id]; } });
  Object.keys(marks).forEach(function (id) { if (marks[id] && !want[id]) { layer.removeChild(marks[id].el); delete marks[id]; } });
  placePop(popAt, docW);
}

/* The thread opens as a card on the side of the screen away from its pin, so it never covers what is being discussed. */
var popSide = 'r';
function placePop(at, docW) {
  if (popEl.classList.contains('hide')) return;
  popEl.style.left = popEl.style.right = '';
  popEl.classList.remove('sheet', 'side', 'r');
  if (phone()) { popEl.classList.add('sheet'); return; }
  var panelW = S.panel ? 400 : 0;
  if (at) popSide = at.vx < (docW - panelW) / 2 ? 'r' : 'l';
  popEl.classList.add('side');
  if (popSide === 'r') { popEl.classList.add('r'); popEl.style.right = (16 + panelW) + 'px'; }
  else popEl.style.left = '16px';
}

var raf = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; layout(); }); }

/* ---------- thread and composer ---------- */

function contextLine(a, changed, lost) {
  var out = [];
  if (a.quote) out.push(h('p', { class: 'ctx', text: '“' + a.quote.replace(/\s+/g, ' ').trim() + '”' }));
  else if (a.text) out.push(h('p', { class: 'ctx plain', text: 'Pinned to: “' + a.text + (a.text.length >= 80 ? '…' : '') + '”' }));
  if (lost) out.push(h('p', { class: 'warn', text: 'The part of the page this note is pinned to is not showing at this screen size.' }));
  else if (changed) out.push(h('p', { class: 'warn', text: 'This part of the page looks different now. Another shop may be selected, or the wording has changed.' }));
  return out;
}

function message(m, noteId, isReply) {
  return h('div', { class: 'msg' }, [
    h('div', { class: 'who' }, [
      h('b', { text: m.author }),
      h('span', { text: ago(m.ts), title: stamp(m.ts) }),
      h('button', { type: 'button', class: 'del', text: 'Delete', onclick: function () {
        if (!window.confirm(isReply ? 'Delete this reply?' : 'Delete this note and its replies?')) return;
        act('delete', isReply ? { id: noteId, rid: m.id } : { id: noteId }, function () { if (!isReply) S.open = null; });
      } })
    ]),
    h('p', { class: 'txt', text: m.body })
  ]);
}

function renderPop() {
  var keep = popEl.querySelector('textarea'), kept = keep ? keep.value : '';
  var sameKey = popEl.getAttribute('data-key');
  popEl.textContent = '';
  var note = S.open ? byId(S.open) : null;
  if (!S.draft && !note) { popEl.className = 'hide'; popEl.removeAttribute('data-key'); return; }
  var key = S.draft ? 'draft' : note.id;
  if (key !== sameKey) kept = '';
  popEl.setAttribute('data-key', key);
  popEl.className = 'pop';
  popEl.setAttribute('role', 'dialog');

  var ta = h('textarea', { rows: '3', maxlength: '4000', 'aria-label': S.draft ? 'Your note' : 'Your reply', placeholder: S.draft ? 'What would you change here?' : 'Reply' });
  ta.value = kept;
  ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } });
  var sendBtn = h('button', { type: 'button', class: 'btn pri grow', text: S.draft ? 'Post note' : 'Reply', onclick: function () { send(); } });
  function live() { sendBtn.disabled = !ta.value.trim(); }
  ta.addEventListener('input', live);
  live();

  function send() {
    var body = ta.value.trim();
    if (!body) { ta.focus(); return; }
    if (S.draft) {
      act('add', { page: PAGE, author: S.name, body: body, anchor: S.draft.anchor, vw: window.innerWidth }, function (j) { ta.value = ''; S.draft = null; S.open = j.id || null; S.filter = 'open'; });
    } else {
      act('reply', { id: note.id, author: S.name, body: body }, function () { ta.value = ''; });
    }
  }

  if (S.draft) {
    popEl.setAttribute('aria-label', 'New note');
    popEl.appendChild(h('div', { class: 'hd' }, [
      h('span', { class: 'num', style: 'background:var(--ink)', text: '+' }),
      h('h2', { text: 'New note' }),
      h('button', { type: 'button', class: 'x', 'aria-label': 'Cancel note', onclick: closePop }, [icon('close')])
    ]));
    var ctx = contextLine(S.draft.anchor, false, false);
    popEl.appendChild(h('div', { class: 'ft', style: 'border-top:0' }, ctx.concat([
      ta,
      h('div', { class: 'row' }, [
        sendBtn,
        h('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: closePop })
      ]),
      h('p', { class: 'as', text: 'Posting as ' + S.name })
    ])));
    return;
  }

  var n = S.num[note.id];
  popEl.setAttribute('aria-label', 'Note ' + n);
  popEl.appendChild(h('div', { class: 'hd' }, [
    h('span', { class: 'num' + (note.resolved ? ' done' : ''), text: String(n) }),
    h('h2', { text: 'Note ' + n }),
    h('span', { class: 'tag', text: leftOn(note.vw), title: 'The screen was ' + note.vw + 'px wide' }),
    h('button', { type: 'button', class: 'x', 'aria-label': 'Close note', onclick: closePop }, [icon('close')])
  ]));
  var body = h('div', { class: 'body' }, contextLine(note.anchor, note._changed, note._lost));
  var thread = h('div', {}, [message(note, note.id, false)].concat((note.replies || []).map(function (r) { return message(r, note.id, true); })));
  body.appendChild(thread);
  if (note.resolved) body.appendChild(h('p', { class: 'res' }, [icon('check'), 'Marked as done' + (note.rby ? ' by ' + note.rby : '') + (note.rts ? ', ' + ago(note.rts) : '')]));
  popEl.appendChild(body);
  popEl.appendChild(h('div', { class: 'ft' }, [
    ta,
    h('div', { class: 'row' }, [
      sendBtn,
      h('button', { type: 'button', class: 'btn', text: note.resolved ? 'Reopen' : 'Mark as done', onclick: function () {
        var to = !note.resolved, id = note.id;
        act('resolve', { id: id, resolved: to, author: S.name }, function () {
          if (!to) return;
          S.open = null;
          toast('Note ' + n + ' marked as done.', 'Undo', function () { act('resolve', { id: id, resolved: false, author: S.name }, function () { S.open = id; }); });
        });
      } })
    ])
  ]));
  body.scrollTop = body.scrollHeight;
}

function closePop() { S.open = null; S.draft = null; renderAll(); }

function openNote(id, scroll) {
  var note = byId(id);
  if (!note) return;
  S.draft = null; S.adding = false;
  S.open = id;
  if (phone()) S.panel = false;
  renderAll();
  var p = locate(note.anchor);
  if (!p) return;
  var top = p.y + window.scrollY, vh = window.innerHeight;
  if (scroll || p.y < 90 || p.y > vh * (phone() ? 0.25 : 0.7)) {
    window.scrollTo({ top: Math.max(0, top - vh * (phone() ? 0.2 : 0.32)), behavior: 'smooth' });
  }
}

function startDraft(anchor) {
  S.adding = false; S.open = null;
  S.draft = { anchor: anchor };
  if (phone()) S.panel = false;
  renderAll();
  var p = locate(anchor);
  if (p && phone() && p.y > window.innerHeight * 0.25) window.scrollTo({ top: Math.max(0, p.y + window.scrollY - window.innerHeight * 0.2), behavior: 'smooth' });
  var ta = popEl.querySelector('textarea');
  if (ta) ta.focus({ preventScroll: true });
}

/* ---------- dock, banner, panel ---------- */

function needSignIn(thenAdd) {
  S.pendingAdd = !!thenAdd;
  S.modal = { kind: 'signin' };
  renderAll();
}

function toggleAdd() {
  if (!S.token) return needSignIn(true);
  S.adding = !S.adding;
  if (S.adding) { S.show = true; store.set('show', '1'); S.open = null; S.draft = null; S.panel = false; }
  renderAll();
}

function renderDock() {
  dockEl.textContent = '';
  dockEl.style.right = '';
  var hideAll = S.modal || (phone() && (S.panel || S.draft || S.open));
  if (hideAll) { dockEl.className = 'hide'; return; }
  dockEl.className = 'dock';
  if (S.panel && !phone()) dockEl.style.right = '416px';
  if (!S.token) {
    dockEl.appendChild(h('button', { type: 'button', class: 'pri', onclick: function () { needSignIn(false); } }, [icon('note'), 'Notes']));
    return;
  }
  var open = openCount(notesOn(PAGE));
  if (S.adding) {
    dockEl.appendChild(h('span', { class: 'hint', role: 'status', text: (touch() ? 'Tap' : 'Click') + ' the spot you want to comment on' }));
    dockEl.appendChild(h('button', { type: 'button', class: 'ghost', text: 'Cancel', onclick: toggleAdd }));
    return;
  }
  if (!S.show) {
    dockEl.appendChild(h('button', { type: 'button', 'aria-label': 'Show notes, ' + open + ' open on this page', onclick: function () { S.show = true; store.set('show', '1'); renderAll(); } }, [icon('note'), phone() ? null : 'Show notes', h('span', { class: 'badge', text: String(open) })]));
    return;
  }
  dockEl.appendChild(h('button', { type: 'button', class: 'pri', onclick: toggleAdd }, [icon('plus'), 'Add note']));
  dockEl.appendChild(h('button', { type: 'button', 'aria-expanded': S.panel ? 'true' : 'false', 'aria-label': 'Notes list, ' + open + ' open on this page', onclick: function () { S.panel = !S.panel; if (S.panel && phone()) { S.open = null; S.draft = null; } renderAll(); } }, [phone() ? icon('note') : 'Notes', h('span', { class: 'badge', text: String(open) })]));
  dockEl.appendChild(h('button', { type: 'button', class: phone() ? 'sq' : '', 'aria-label': 'Hide notes', title: 'Hide the notes and pins', onclick: function () {
    S.show = false; store.set('show', '0');
    S.adding = false; S.open = null; S.draft = null; S.panel = false;
    renderAll();
  } }, [icon('eyeOff'), phone() ? null : 'Hide']));
}

function listItem(n, showPage) {
  var here = n.page === PAGE;
  var inner = [
    h('span', { class: 'num' + (n.resolved ? ' done' : ''), text: String(S.num[n.id]) }),
    h('span', { class: 'col' }, [
      h('span', { class: 'meta' }, [h('b', { style: 'color:var(--ink);font-size:14px', text: n.author }), ago(n.ts)]),
      h('span', { class: 'clip', text: n.body }),
      (n.replies && n.replies.length) ? h('span', { class: 'meta', text: n.replies.length + (n.replies.length === 1 ? ' reply' : ' replies') }) : null
    ])
  ];
  if (here) return h('button', { type: 'button', class: 'item' + (n.id === S.open ? ' cur' : ''), onclick: function () { openNote(n.id, true); } }, inner);
  return h('a', { class: 'item', href: n.page + '#note-' + n.id }, inner);
}

function renderPanel() {
  var listEl = panelEl.querySelector('.list'), keepScroll = listEl ? listEl.scrollTop : 0;
  panelEl.textContent = '';
  if (!S.panel || !S.token) { panelEl.className = 'hide'; return; }
  panelEl.className = 'panel' + (phone() ? ' sheet' : '');
  panelEl.setAttribute('role', 'dialog');
  panelEl.setAttribute('aria-label', 'Notes');
  var mine = notesOn(PAGE), want = S.filter === 'resolved';
  var scope = S.tab === 'page' ? mine : S.notes;
  var shown = scope.filter(function (n) { return !!n.resolved === want; });

  panelEl.appendChild(h('div', { class: 'hd' }, [
    h('h2', { text: 'Notes' }),
    h('button', { type: 'button', class: 'x', 'aria-label': 'Close the list', onclick: function () { S.panel = false; renderAll(); } }, [icon('close')])
  ]));
  function tab(label, on, fn) { return h('button', { type: 'button', 'aria-pressed': on ? 'true' : 'false', text: label, onclick: function () { fn(); renderAll(); } }); }
  panelEl.appendChild(h('div', { class: 'seg' }, [
    tab('This page', S.tab === 'page', function () { S.tab = 'page'; }),
    tab('All pages', S.tab === 'all', function () { S.tab = 'all'; })
  ]));
  panelEl.appendChild(h('div', { class: 'filt' }, [
    tab('Open (' + openCount(scope) + ')', !want, function () { S.filter = 'open'; }),
    tab('Done (' + (scope.length - openCount(scope)) + ')', want, function () { S.filter = 'resolved'; S.open = null; })
  ]));

  var list = h('div', { class: 'list' });
  if (!shown.length) {
    list.appendChild(h('p', { class: 'empty', text: want ? 'Nothing marked as done yet.' : (S.tab === 'page' ? 'No open notes on this page. Choose Add note, then click the spot you want to comment on.' : 'No open notes on any page.') }));
  } else if (S.tab === 'page') {
    shown.forEach(function (n) { list.appendChild(listItem(n, false)); });
  } else {
    PAGE_ORDER.concat(Object.keys(shown.reduce(function (m, n) { if (!PAGES[n.page]) m[n.page] = 1; return m; }, {}))).forEach(function (pg) {
      var group = shown.filter(function (n) { return n.page === pg; });
      if (!group.length) return;
      list.appendChild(h('p', { class: 'grp' }, [PAGES[pg] || pg, pg === PAGE ? h('span', { text: 'This page', style: 'text-transform:none;letter-spacing:0;font-weight:600' }) : h('a', { href: pg, text: 'Open page' })]));
      group.forEach(function (n) { list.appendChild(listItem(n, true)); });
    });
  }
  panelEl.appendChild(list);
  list.scrollTop = keepScroll;

  var admin = /[?&]notes-admin\b/.test(location.search);
  panelEl.appendChild(h('div', { class: 'pf' }, [
    h('div', { class: 'top' }, [
      h('p', { class: 'as', text: 'Posting as ' + S.name }),
      h('button', { type: 'button', class: 'link', text: 'Sign out', onclick: function () { signOut(); renderAll(); } })
    ]),
    h('div', { class: 'row' }, [
      h('button', { type: 'button', class: 'link', text: 'Change name', onclick: function () { S.modal = { kind: 'name' }; renderAll(); } }),
      h('button', { type: 'button', class: 'link', text: 'Download notes', onclick: download }),
      admin ? h('button', { type: 'button', class: 'link', text: 'Change password', onclick: function () { S.modal = { kind: 'passwd' }; renderAll(); } }) : null
    ])
  ]));
}

function download() {
  var lines = ['Gents of Brooklyn website concepts: review notes', 'Downloaded ' + stamp(Date.now() / 1000), ''];
  var pagesWith = PAGE_ORDER.concat(S.notes.map(function (n) { return n.page; }).filter(function (p, i, a) { return !PAGES[p] && a.indexOf(p) === i; }));
  pagesWith.forEach(function (pg) {
    var group = notesOn(pg);
    if (!group.length) return;
    lines.push('== ' + (PAGES[pg] || pg) + ' (' + pg + ') ==', '');
    group.forEach(function (n) {
      lines.push(S.num[n.id] + '. [' + (n.resolved ? 'Done' : 'Open') + '] ' + n.author + ', ' + stamp(n.ts) + ', ' + device(n.vw));
      if (n.anchor.quote) lines.push('   On the words: "' + n.anchor.quote.replace(/\s+/g, ' ').trim() + '"');
      else if (n.anchor.text) lines.push('   Pinned to: "' + n.anchor.text + '"');
      n.body.split('\n').forEach(function (l) { lines.push('   ' + l); });
      (n.replies || []).forEach(function (r) {
        lines.push('     Reply from ' + r.author + ', ' + stamp(r.ts) + ':');
        r.body.split('\n').forEach(function (l) { lines.push('       ' + l); });
      });
      lines.push('');
    });
  });
  if (!S.notes.length) lines.push('No notes yet.');
  var url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' }));
  var a = h('a', { href: url, download: 'gents-of-brooklyn-notes.txt' });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
}

/* ---------- sign in, name and password dialogs ---------- */

function field(id, label, type, value, extra) {
  var input = h('input', { id: id, type: type, value: value || '', autocapitalize: type === 'password' ? 'none' : 'words', autocorrect: 'off', spellcheck: 'false' });
  if (extra) for (var k in extra) input.setAttribute(k, extra[k]);
  return h('div', {}, [h('label', { for: id, text: label }), input]);
}

function renderModal() {
  var m = S.modal;
  modalEl.textContent = '';
  if (!m) { modalEl.className = 'hide'; return; }
  modalEl.className = 'scrim';
  var kids, submit;
  function close() { S.modal = null; S.pendingAdd = false; renderAll(); }
  function val(id) { var e = modalEl.querySelector('#' + id); return e ? e.value.trim() : ''; }
  function fail(msg) { m.error = msg; var e = modalEl.querySelector('.err'); if (e) { e.textContent = msg; e.classList.remove('hide'); } }

  if (m.kind === 'signin') {
    kids = [
      h('h2', { text: 'Leave notes on these designs' }),
      h('p', { text: 'Enter your name and the review password you were sent. Then pin a note to any spot, or select some wording to comment on it.' }),
      field('gn-name', 'Your name', 'text', S.name, { maxlength: '40', autocomplete: 'name' }),
      field('gn-pass', 'Review password', 'password', '', { autocomplete: 'off' })
    ];
    submit = function () {
      var name = val('gn-name'), pass = val('gn-pass');
      if (!name) return fail('Add your name so others know who left the note.');
      if (!pass) return fail('Enter the review password.');
      if (S.busy) return;
      S.busy = true;
      api('auth', { password: pass }).then(function (j) {
        S.busy = false;
        S.token = j.token; store.set('token', j.token);
        S.name = name; store.set('name', name);
        S.modal = null;
        var add = S.pendingAdd; S.pendingAdd = false;
        S.show = true; store.set('show', '1');
        refresh(false).then(function () { if (add) { S.adding = true; renderAll(); } else followHash(); });
      }).catch(function (e) { S.busy = false; fail(e.message); });
    };
  } else if (m.kind === 'name') {
    kids = [h('h2', { text: 'Change your name' }), h('p', { text: 'New notes and replies will carry this name.' }), field('gn-name', 'Your name', 'text', S.name, { maxlength: '40', autocomplete: 'name' })];
    submit = function () {
      var name = val('gn-name');
      if (!name) return fail('Add a name.');
      S.name = name; store.set('name', name); S.modal = null; renderAll();
    };
  } else {
    kids = [
      h('h2', { text: 'Change the review password' }),
      h('p', { text: 'Everyone will need the new password the next time they open the notes.' }),
      field('gn-cur', 'Current password', 'password', '', { autocomplete: 'off' }),
      field('gn-new', 'New password, at least 8 characters', 'password', '', { autocomplete: 'off' })
    ];
    submit = function () {
      var cur = val('gn-cur'), nw = val('gn-new');
      if (!cur || nw.length < 8) return fail('Enter the current password and a new one of at least 8 characters.');
      if (S.busy) return;
      S.busy = true;
      api('passwd', { current: cur, password: nw }).then(function (j) {
        S.busy = false; S.token = j.token; store.set('token', j.token); S.modal = null; renderAll(); toast('Password changed.');
      }).catch(function (e) { S.busy = false; fail(e.message); });
    };
  }
  kids.push(h('p', { class: 'err' + (m.error ? '' : ' hide'), role: 'alert', text: m.error || '' }));
  kids.push(h('div', { class: 'row' }, [
    h('button', { type: 'submit', class: 'btn pri grow', text: m.kind === 'signin' ? 'Open notes' : 'Save' }),
    h('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: close })
  ]));
  var form = h('form', { class: 'card', role: 'dialog', 'aria-modal': 'true', novalidate: true }, kids);
  form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
  modalEl.appendChild(form);
  modalEl.onclick = function (e) { if (e.target === modalEl) close(); };
  var first = form.querySelector(m.kind === 'signin' && S.name ? '#gn-pass' : 'input');
  if (first) first.focus();
}

/* ---------- commenting on selected text ---------- */

var selRange = null, selTimer = 0;
function snapWords(r) {
  var re = /[A-Za-z0-9\u00C0-\u024F'\u2019]/, sc = r.startContainer, ec = r.endContainer, i;
  if (sc.nodeType === 3) { i = r.startOffset; if (i < sc.data.length && re.test(sc.data.charAt(i))) { while (i > 0 && re.test(sc.data.charAt(i - 1))) i--; r.setStart(sc, i); } }
  if (ec.nodeType === 3) { i = r.endOffset; if (i > 0 && re.test(ec.data.charAt(i - 1))) { while (i < ec.data.length && re.test(ec.data.charAt(i))) i++; r.setEnd(ec, i); } }
  return r;
}
function hideBubble() { bubbleEl.className = 'hide'; selRange = null; }
function checkSelection() {
  if (!S.token || !S.show || S.draft || S.modal) return hideBubble();
  var sel = document.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return hideBubble();
  var r = sel.getRangeAt(0), c = r.commonAncestorContainer, el = c.nodeType === 1 ? c : c.parentElement;
  if (!el || el === host || host.contains(el) || !document.body.contains(el)) return hideBubble();
  if (r.toString().trim().length < 2) return hideBubble();
  var rects = r.getClientRects();
  if (!rects.length) return hideBubble();
  var first = rects[0], last = rects[rects.length - 1], o = origin(), docW = document.documentElement.clientWidth;
  selRange = snapWords(r.cloneRange());
  bubbleEl.className = 'bubble';
  var above = !touch() && first.top > 56;
  bubbleEl.style.left = Math.max(8, Math.min(docW - 150, (above ? first.left : last.right - 60) - o.x)) + 'px';
  bubbleEl.style.top = (above ? first.top - o.y - 50 : last.bottom - o.y + 14) + 'px';
}

var bubbleBtn = h('button', { type: 'button', style: 'height:40px;display:flex;align-items:center;gap:8px;font-weight:600' }, [icon('note'), 'Comment']);
bubbleEl.appendChild(bubbleBtn);
bubbleEl.className = 'hide';
bubbleEl.addEventListener('mousedown', function (e) { e.preventDefault(); });
bubbleBtn.addEventListener('click', function () {
  if (!selRange) return;
  if (selRange.toString().length > 500) { toast('Select a shorter passage, up to 500 characters.'); return; }
  var a = anchorFromRange(selRange);
  var sel = document.getSelection();
  if (sel) sel.removeAllRanges();
  hideBubble();
  if (a) startDraft(a);
});

/* ---------- wiring ---------- */

function renderAll() {
  document.documentElement.classList.toggle('gob-notes-adding', !!S.adding);
  renderDock(); renderPanel(); renderPop(); renderModal(); layout();
}

function followHash() {
  var m = /^#note-(n\d+)$/.exec(location.hash);
  if (!m) return;
  var note = byId(m[1]);
  if (!note || note.page !== PAGE) return;
  if (note.resolved) S.filter = 'resolved';
  S.show = true;
  setTimeout(function () { openNote(note.id, true); }, 350);
}

document.addEventListener('click', function (e) {
  if (!S.adding || inUI(e)) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  var t = e.target;
  if (t && t.nodeType !== 1) t = t.parentElement;
  startDraft(anchorFromPoint(t, e.clientX, e.clientY));
}, true);

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (S.modal) { S.modal = null; S.pendingAdd = false; }
  else if (S.adding) S.adding = false;
  else if (S.draft || S.open) { S.draft = null; S.open = null; }
  else if (S.panel) S.panel = false;
  else return;
  renderAll();
});

document.addEventListener('selectionchange', function () { clearTimeout(selTimer); selTimer = setTimeout(checkSelection, 280); });
window.addEventListener('resize', function () { hideBubble(); renderDock(); renderPanel(); if (!typing()) renderPop(); schedule(); });
window.addEventListener('scroll', schedule, { passive: true });
window.addEventListener('load', schedule);
window.addEventListener('hashchange', followHash);
document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(true); });

function start() {
  document.head.appendChild(pageStyle);
  document.body.appendChild(host);
  if (window.MutationObserver) new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  if (window.ResizeObserver) new ResizeObserver(schedule).observe(document.body);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  renderAll();
  if (S.token) refresh(false).then(followHash);
  else if (/^#note-n\d+$/.test(location.hash)) needSignIn(false);
  setInterval(function () { if (!document.hidden && !S.busy) refresh(true); }, 30000);
}
if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
