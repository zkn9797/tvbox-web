'use strict';
// Worker thread hosting TVBox JS spiders (drpy2 / catvod ESM) in vm contexts.
// Spiders call a *synchronous* req(); we bridge it to the main thread's async fetch with
// Atomics.wait + receiveMessageOnPort.
const { parentPort, workerData, receiveMessageOnPort } = require('node:worker_threads');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { transform } = require('./esm');

const ASSETS = workerData.assetsDir;
const DEBUG = !!process.env.SPIDER_DEBUG;
const flag = new Int32Array(workerData.sab);
const reqPort = workerData.port;
let seq = 0;

function syncCall(payload, timeoutMs) {
  const id = ++seq;
  Atomics.store(flag, 0, 0);
  reqPort.postMessage({ id, ...payload });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) return { error: 'timeout' };
    Atomics.wait(flag, 0, 0, left);
    let m;
    while ((m = receiveMessageOnPort(reqPort))) { if (m.message.id === id) return m.message; }
    Atomics.store(flag, 0, 0);
  }
}

// ---------- source loading ----------
const srcCache = new Map(); // url -> transformed source
function assetPath(name) {
  const p = path.join(ASSETS, 'js', 'lib', path.basename(name));
  return fs.existsSync(p) ? p : null;
}
function fetchSource(url) {
  if (srcCache.has(url)) { const v = srcCache.get(url); if (v instanceof Error) throw v; return v; }
  let src = null;
  if (url.startsWith('assets://')) {
    let nm = url.split('?')[0].replace(/^assets:\/\/(js\/lib\/)?/, ''); try { nm = decodeURIComponent(nm); } catch {}
    const p = assetPath(nm) || assetPath(nm.split('/').pop());
    if (p) src = fs.readFileSync(p, 'utf8');
  }
  if (src === null && /^https?:/.test(url)) {
    // prefer bundled copies of well-known libs (fast, works offline / behind GFW)
    const base = decodeURIComponent(url.split('?')[0].split('/').pop());
    const known = ['cheerio.min.js', 'crypto-js.js', 'node-rsa.js', 'pako.min.js', '模板.js', 'gbk.js', 'json5.js', 'jinja.js', 'uri.min.js'];
    if (known.includes(base)) { const p = assetPath(base); if (p) src = fs.readFileSync(p, 'utf8'); }
    if (src === null) {
      const r = syncCall({ op: 'fetch', url, opts: { timeout: 15000 }, cache: true }, 35000);
      if (r.error || !r.content || r.status >= 400 || /^\s*<(!doctype|html)/i.test(r.content)) {
        const p = assetPath(base);
        if (p) src = fs.readFileSync(p, 'utf8'); else { const er = new Error('load failed ' + url + ' ' + (r.error || r.status)); srcCache.set(url, er); setTimeout(() => srcCache.delete(url), 600e3); throw er; }
      } else src = r.content;
    }
  }
  if (src === null) throw new Error('cannot load ' + url);
  srcCache.set(url, src);
  return src;
}

// ---------- shared cheerio (main realm) for pdfh/pdfa natives ----------
let C = null;
function cheerioLib() {
  if (C) return C;
  const code = transform(fs.readFileSync(path.join(ASSETS, 'js', 'lib', 'cheerio.min.js'), 'utf8'));
  C = vm.runInThisContext(code)({}, () => ({}));
  return C;
}

const NO_FIRST = /:eq|:lt|:gt|:first|:last|^body$|^#/;
function applyPart($, cur, part, takeFirst) {
  part = part.trim();
  const toks = part.split(/(:eq\(-?\d+\))/);
  let sel = '';
  for (const t of toks) {
    const m = /^:eq\((-?\d+)\)$/.exec(t);
    if (m) {
      if (sel.trim()) cur = cur.find(sel.trim());
      let n = parseInt(m[1], 10); if (n < 0) n = cur.length + n;
      cur = cur.eq(n); sel = '';
    } else sel += t;
  }
  if (sel.trim()) cur = cur.find(sel.trim());
  if (takeFirst && !NO_FIRST.test(part)) cur = cur.first();
  return cur;
}
function loadDoc(html) {
  const $ = cheerioLib().load(String(html || ''), { decodeEntities: false }, String(html || '').trim().startsWith('<') && !/<html|<body/i.test(String(html).slice(0, 200)) ? false : true);
  return $;
}
function pdfa(html, rule) {
  if (!html || !rule) return [];
  const $ = loadDoc(html);
  const parts = String(rule).split('&&');
  let cur = $.root();
  parts.forEach((p, i) => { cur = applyPart($, cur, p, i < parts.length - 1); });
  return cur.toArray().map(e => $.html(e));
}
function attrOf($, el, attr) {
  if (!el || !el.length) return '';
  if (attr === 'Text') return el.text().replace(/[\s\u00a0]+/g, ' ').trim();
  if (attr === 'Html') return el.html() || '';
  for (const a of attr.split('||')) { const v = el.attr(a.trim()); if (v) return v.trim(); }
  return '';
}
function pdfh(html, rule) {
  if (!html || !rule) return '';
  const $ = loadDoc(html);
  let parts = String(rule).split('&&');
  let attr = parts.pop().trim();
  let regex = null;
  const rx = attr.split('##'); if (rx.length > 1) { attr = rx[0]; regex = rx.slice(1); }
  let cur = $.root();
  if (!parts.length && !/^(Text|Html)$/.test(attr) && /[.#\s\[:>]/.test(attr)) { parts = [attr]; attr = 'Text'; }
  parts.forEach(p => { cur = applyPart($, cur, p, true); });
  if (!parts.length && !/^(Text|Html)$/.test(attr)) cur = $.root().children().first();
  let v = cur.length ? attrOf($, cur.first(), attr) : '';
  if (regex && v) { try { v = v.replace(new RegExp(regex[0]), regex[1] || ''); } catch {} }
  return v;
}
function joinUrl(base, rel) { if (!rel) return base || ''; try { return new URL(rel, base).href; } catch { return rel; } }

// ---------- per-site contexts ----------
const local = new Map(Object.entries(workerData.local || {}));
const sites = new Map(); // siteId -> {ctx, inst, lastUse}
const MAX_SITES = Number(process.env.JS_MAX_CONTEXTS || 6);

function makeReq(siteHeaders) {
  return function req(url, opt) {
    opt = opt || {};
    const headers = Object.assign({}, opt.headers || {});
    let body; const method = (opt.method || 'GET').toUpperCase();
    let data = opt.data !== undefined ? opt.data : opt.body;
    if (data !== undefined && data !== null && method !== 'GET') {
      const ctKey = Object.keys(headers).find(k => k.toLowerCase() === 'content-type');
      const ct = ctKey ? headers[ctKey] : '';
      if (typeof data === 'object') {
        if (opt.postType === 'form' || /form/.test(ct)) {
          body = Object.entries(data).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
          if (!ctKey) headers['Content-Type'] = 'application/x-www-form-urlencoded';
        } else { body = JSON.stringify(data); if (!ctKey) headers['Content-Type'] = 'application/json'; }
      } else body = String(data);
    }
    const gh = /githubusercontent|github\.com/.test(String(url));
    const r = syncCall({ op: 'fetch', url: String(url), opts: { method, headers, body, timeout: Number(opt.timeout) || 10000, encoding: opt.encoding, buffer: opt.buffer, redirect: opt.redirect } }, gh ? 32000 : (Number(opt.timeout) || 10000) + 3000);
    if (r.error) return { content: '', headers: {}, code: 0, error: r.error };
    return { content: r.content, headers: r.headers || {}, code: r.status };
  };
}

function createContext(siteId, site) {
  const g = {
    console: { log: DEBUG ? (...a) => console.log('[js]', ...a) : () => {}, error: DEBUG ? console.error : () => {}, warn: () => {}, info: () => {} },
    req: makeReq(site.header),
    pdfh, pdfa,
    pd: (html, rule, base) => { const v = pdfh(html, rule); return v && !/^(ftp|magnet|thunder|ws|data):/.test(v) ? joinUrl(base || g.MY_URL || g.HOST || '', v) : v; },
    joinUrl,
    local: {
      get: (k, n) => { const v = local.get(k + '\u0001' + n); return v === undefined ? '' : v; },
      set: (k, n, v) => { local.set(k + '\u0001' + n, String(v)); parentPort.postMessage({ type: 'local', k: k + '\u0001' + n, v: String(v) }); },
      delete: (k, n) => { local.delete(k + '\u0001' + n); parentPort.postMessage({ type: 'local', k: k + '\u0001' + n, v: null }); },
    },
    getProxy: () => `/api/spproxy/${encodeURIComponent(siteId)}?do=js`,
    md5X: s => crypto.createHash('md5').update(String(s)).digest('hex'),
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL, URLSearchParams,
    atob: s => Buffer.from(String(s), 'base64').toString('latin1'),
    btoa: s => Buffer.from(String(s), 'latin1').toString('base64'),
  };
  g.globalThis = g; g.window = g; g.self = g;
  const ctx = vm.createContext(g, { name: 'spider:' + siteId });
  const modCache = new Map();
  const importer = (baseUrl) => (spec) => {
    let url = spec;
    if (spec === 'assets://js/lib/cat.js') return catShim(ctx, importer(baseUrl));
    if (!/^(https?|assets):\/\//.test(spec)) url = joinUrl(baseUrl, spec);
    if (modCache.has(url)) return modCache.get(url);
    const exp = {};
    modCache.set(url, exp);
    const fn = vm.runInContext(transform(fetchSource(url)), ctx, { filename: url });
    fn.call(ctx, exp, importer(url));
    return exp;
  };
  return { ctx, importer };
}

function catShim(ctx, imp) {
  // FongMi cat.js equivalents built from bundled libs.
  const cheerio = imp('assets://js/lib/cheerio.min.js');
  imp('assets://js/lib/crypto-js.js');
  return { load: cheerio.load, Crypto: ctx.CryptoJS, _: {}, default: {} };
}

function J(s) { if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch { return s; } }

async function getInstance(siteId, site) {
  let e = sites.get(siteId);
  if (e) { e.lastUse = Date.now(); return e; }
  // LRU evict
  if (sites.size >= MAX_SITES) {
    const oldest = [...sites.entries()].sort((a, b) => a[1].lastUse - b[1].lastUse)[0];
    sites.delete(oldest[0]);
  }
  let { ctx, importer } = createContext(siteId, site);
  let exp;
  try { exp = importer(site.api)(site.api); }
  catch (err) {
    if (site.kind !== 'drpy') throw err;
    // drpy engine host unreachable: fall back to the bundled drpy2 engine
    ({ ctx, importer } = createContext(siteId, site));
    exp = importer('assets://js/lib/drpy2.min.js')('assets://js/lib/drpy2.min.js');
  }
  let inst;
  if (site.kind === 'drpy') inst = exp.default;
  else if (typeof exp.__jsEvalReturn === 'function') inst = exp.__jsEvalReturn();
  else inst = exp.default && exp.default.init ? exp.default : exp;
  if (!inst || typeof inst.init !== 'function') throw new Error('spider has no init()');
  const ext = site.ext && typeof site.ext === 'object' ? JSON.stringify(site.ext) : (site.ext || '');
  if (site.kind === 'drpy') {
    // drpy2 expects key global for RKEY
    ctx.key = site.key;
    await inst.init(ext);
  } else {
    await inst.init(site.kind === 'catjs' ? { skey: site.key, stype: site.type, ext: site.ext } : ext);
  }
  e = { ctx, inst, lastUse: Date.now() };
  sites.set(siteId, e);
  return e;
}

async function call(msg) {
  const { siteId, site, method, args } = msg;
  const e = await getInstance(siteId, site);
  const fn = e.inst[method];
  if (typeof fn !== 'function') throw new Error('method not supported: ' + method);
  let r = await fn.apply(e.inst, args || []);
  r = J(r);
  if (method === 'proxy' && Array.isArray(r)) {
    // [code, mime, body(, headers)] ; body may be string or base64 marker
    return { code: r[0], mime: r[1], body: typeof r[2] === 'string' ? r[2] : JSON.stringify(r[2]), headers: r[3] || null };
  }
  return r;
}

parentPort.on('message', async (msg) => {
  if (msg.type === 'call') {
    try { const result = await call(msg); parentPort.postMessage({ type: 'result', id: msg.id, result }); }
    catch (err) { parentPort.postMessage({ type: 'result', id: msg.id, error: String(err && err.message || err).slice(0, 300) + ' @ ' + String(err && err.stack || '').split('\n').slice(1,3).join(' ').slice(0, 300) }); }
  } else if (msg.type === 'drop') {
    sites.delete(msg.siteId);
  }
});
