'use strict';
// Shared helpers: HTTP fetch with timeout/charset, TTL cache, concurrency limiter.
const crypto = require('node:crypto');

const UA_OK = 'okhttp/3.12.0';
const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Normalise an URL that may contain IDN (Chinese) host names or spaces.
function normUrl(u) {
  try { return new URL(String(u).trim()).href; } catch { return String(u).trim(); }
}

function decodeBody(buf, contentType, forced) {
  let cs = forced || '';
  if (!cs) {
    const m = /charset=([\w-]+)/i.exec(contentType || '');
    if (m) cs = m[1];
  }
  cs = (cs || 'utf-8').toLowerCase();
  if (cs === 'utf8') cs = 'utf-8';
  try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

const zlib = require('node:zlib');
const netx = require('./net');

function decompress(buf, enc) {
  enc = String(enc || '').toLowerCase().trim();
  try {
    if (enc === 'gzip' || enc === 'x-gzip') return zlib.gunzipSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    if (enc === 'deflate') { try { return zlib.inflateSync(buf); } catch { return zlib.inflateRawSync(buf); } }
    if (enc === 'br') return zlib.brotliDecompressSync(buf);
  } catch {}
  return buf;
}

// One request incl. body. Resolves {res, buf} (buf null for a redirect to follow).
function fetchOnce(u, o, rotate, ctl) {
  const end = Date.now() + o.timeout;
  return netx.request(u, { method: o.method, headers: o.headers, body: o.body, timeout: o.timeout, noProxy: o.noProxy, rotate, ctl }).then(res => {
    const st = res.statusCode;
    if (o.follow && [301, 302, 303, 307, 308].includes(st) && res.headers.location) { res.resume(); res.on('error', () => {}); return { res, buf: null }; }
    return new Promise((resolve, reject) => {
      const chunks = []; let n = 0;
      const to = setTimeout(() => { res.destroy(new Error('timeout')); }, Math.max(300, end - Date.now()));
      res.on('data', c => { n += c.length; if (n > o.maxBytes) { res.destroy(new Error('response too large')); return; } chunks.push(c); });
      res.on('end', () => { clearTimeout(to); resolve(Buffer.concat(chunks)); });
      res.on('error', e => { clearTimeout(to); reject(e); });
      res.on('close', () => { clearTimeout(to); if (!res.complete) reject(new Error(ctl.cancelled ? 'cancelled' : 'ECONNRESET')); });
    }).then(b => ({ res, buf: decompress(b, res.headers['content-encoding']) }));
  });
}
// Hedged GET for direct connections on lossy links: if no complete answer after HEDGE_MS, start another attempt
// (rotated to the next address); first complete response wins, the others are cancelled.
const HEDGE = (process.env.HEDGE_MS || '1500,3500,6000').split(',').map(Number).filter(x => x > 0);
function hedged(u, o) {
  const t0 = Date.now();
  const canHedge = !o.noHedge && (o.method || 'GET') === 'GET' && o.body == null && !netx.isInternalHost(u.hostname) && !netx.viaProxy(u.hostname) && HEDGE.length;
  if (!canHedge) return fetchOnce(u, o, 0, {});
  return new Promise((resolve, reject) => {
    const ctls = []; let done = false, running = 0, launched = 0, lastErr; const timers = [];
    const finish = (err, r, mine) => {
      if (done) return; done = true; timers.forEach(clearTimeout);
      for (const c of ctls) if (c !== mine) netx.cancel(c);
      err ? reject(err) : resolve(r);
    };
    const launch = () => {
      if (done) return;
      const left = o.timeout - (Date.now() - t0); if (left < 800) { if (!running) finish(lastErr || new Error('timeout')); return; }
      const ctl = {}; ctls.push(ctl); running++; const n = launched++;
      fetchOnce(u, Object.assign({}, o, { timeout: left }), n, ctl).then(r => { running--; finish(null, r, ctl); },
        e => { running--; if (done) return; lastErr = e; if (launched <= HEDGE.length) { launch(); } else if (!running) finish(e); });
    };
    launch();
    HEDGE.forEach(ms => timers.push(setTimeout(() => { if (!done && launched < HEDGE.length + 1) launch(); }, ms)));
  });
}

/**
 * HTTP client (node:net/tls based, see net.js): resilient direct connect, optional upstream proxy.
 * opts: {method, headers, body, timeout(ms), encoding, raw(bool), redirect, maxBytes, noProxy}
 * returns {status, headers(object lowercase), text|buf, url}
 */
async function httpFetch(url, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  for (const k of Object.keys(headers)) if (headers[k] === undefined || headers[k] === null) delete headers[k];
  if (!Object.keys(headers).some(k => k.toLowerCase() === 'user-agent')) headers['User-Agent'] = UA_OK;
  const total = opts.timeout || 10000;
  const t0 = Date.now();
  const maxBytes = opts.maxBytes || 32 * 1024 * 1024;
  let cur = normUrl(url), method = opts.method || 'GET', body = opts.body;
  for (let hop = 0; hop < 8; hop++) {
    let u;
    try { u = new URL(cur); } catch { throw new Error('Invalid URL'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('unsupported protocol ' + u.protocol);
    const left = total - (Date.now() - t0);
    if (left <= 0) throw new Error('timeout');
    const { res, buf } = await hedged(u, { method, headers, body, timeout: left, noProxy: opts.noProxy, maxBytes, follow: opts.redirect !== false, noHedge: !!opts.raw && !opts.hedge });
    const st = res.statusCode;
    if (buf === null) { // redirect
      const next = new URL(res.headers.location, u).href;
      if (st === 303 || ((st === 301 || st === 302) && method === 'POST')) { method = 'GET'; body = undefined; for (const k of Object.keys(headers)) if (/^content-(type|length)$/i.test(k)) delete headers[k]; }
      if (new URL(next).host !== u.host) for (const k of Object.keys(headers)) if (/^host$/i.test(k)) delete headers[k];
      cur = next; continue;
    }
    const h = {};
    for (const [k, v] of Object.entries(res.headers)) h[k] = Array.isArray(v) ? v.join(k === 'set-cookie' ? '; ' : ', ') : v;
    if (h['content-encoding']) { delete h['content-encoding']; delete h['content-length']; }
    const out = { status: st, headers: h, url: cur, buf };
    if (!opts.raw) out.text = decodeBody(buf, h['content-type'], opts.encoding);
    return out;
  }
  throw new Error('too many redirects');
}

class TTLCache {
  constructor(max = 300) { this.max = max; this.m = new Map(); }
  get(k) {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (e.exp < Date.now()) { this.m.delete(k); return undefined; }
    this.m.delete(k); this.m.set(k, e); // LRU touch
    return e.v;
  }
  set(k, v, ttlMs) {
    this.m.delete(k);
    this.m.set(k, { v, exp: Date.now() + ttlMs });
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value);
    return v;
  }
  del(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

// Simple concurrency limiter (p-limit style).
function limiter(n) {
  let active = 0; const q = [];
  const next = () => {
    if (active >= n || !q.length) return;
    active++;
    const { fn, res, rej } = q.shift();
    Promise.resolve().then(fn).then(res, rej).finally(() => { active--; next(); });
  };
  return fn => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); });
}

function withTimeout(p, ms, msg = 'timeout') {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
}

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }
function randHex(n) { return crypto.randomBytes(n).toString('hex'); }

function joinUrl(base, rel) {
  if (!rel) return base || '';
  try { return new URL(rel, base).href; } catch { return rel; }
}

// Normalise a title for cross-site matching.
function normTitle(s) {
  return String(s || '').toLowerCase()
    .replace(/[\s·・:：,，.。!！?？'"“”‘’()（）\[\]【】《》<>\-_—|/\\]+/g, '')
    .replace(/(国语|粤语|中字|高清|蓝光|hd|4k|1080p|完结|更新至.*)$/g, '');
}

// ---- GitHub raw mirrors (raw.githubusercontent / ghproxy-style prefixes are often blocked in CN) ----
const GH_MIRRORS = (process.env.GH_MIRRORS || 'https://gh-proxy.com/,jsdelivr').split(',').map(x => x.trim()).filter(Boolean);
const badHost = new TTLCache(100);
function githubParts(url) {
  let m = /raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(.+)$/.exec(url);
  if (m) {
    let rest = m[3]; let branch;
    const rh = /^refs\/heads\/([^/]+)\/(.+)$/.exec(rest);
    if (rh) { branch = rh[1]; rest = rh[2]; } else { const i = rest.indexOf('/'); branch = rest.slice(0, i); rest = rest.slice(i + 1); }
    return { user: m[1], repo: m[2], branch, path: rest };
  }
  m = /github\.com\/([^/]+)\/([^/]+)\/(?:raw|blob)\/([^/]+)\/(.+)$/.exec(url);
  if (m) return { user: m[1], repo: m[2], branch: m[3].replace(/^refs\/heads\//, ''), path: m[4] };
  return null;
}
function githubCandidates(url) {
  const g = githubParts(url);
  if (!g) return [url];
  const raw = `https://raw.githubusercontent.com/${g.user}/${g.repo}/${g.branch}/${g.path}`;
  const list = [url];
  if (url !== raw) list.push(raw);
  for (const m of GH_MIRRORS) list.push(m === 'jsdelivr' ? `https://cdn.jsdelivr.net/gh/${g.user}/${g.repo}@${g.branch}/${g.path}` : m + raw);
  return [...new Set(list)];
}
function looksBad(r, url) {
  if (!r || r.status >= 400) return true;
  const head = (r.text !== undefined ? r.text : r.buf.slice(0, 200).toString('latin1')).slice(0, 200).trim();
  return /\.(js|json|txt|py)(\?|$)/i.test(url) && /^<(!doctype|html|head)/i.test(head);
}
// fetch with GitHub mirror fallback: staggered parallel race (next mirror starts after 1.5s or on failure);
// remembers dead hosts for 30 min.
async function smartFetch(url, opts = {}) {
  const cands = githubCandidates(url).filter(u => { let host = ''; try { host = new URL(normUrl(u)).host; } catch {} return !badHost.get(host); });
  if (cands.length <= 1) return httpFetch(cands[0] || url, opts);
  return new Promise((resolve, reject) => {
    let i = 0, pending = 0, done = false, last, timer;
    const start = () => {
      clearTimeout(timer);
      if (done || i >= cands.length) { if (!done && !pending) { done = true; last instanceof Error || !last ? reject(last || new Error('fetch failed')) : resolve(last); } return; }
      const u = cands[i++]; pending++;
      let host = ''; try { host = new URL(normUrl(u)).host; } catch {}
      httpFetch(u, Object.assign({}, opts, { timeout: Math.min(opts.timeout || 10000, 9000) })).then(r => {
        pending--;
        if (done) return;
        if (!looksBad(r, url)) { done = true; clearTimeout(timer); return resolve(r); }
        last = r; if (r.status < 400 || r.status >= 500) badHost.set(host, 1, 30 * 60e3);
        start();
      }, e => { pending--; if (done) return; if (!(last && !(last instanceof Error))) last = e; badHost.set(host, 1, 30 * 60e3); start(); });
      timer = setTimeout(start, 1500);
    };
    start();
  });
}

module.exports = { netx, smartFetch, githubCandidates, UA_OK, UA_PC, sleep, normUrl, httpFetch, decodeBody, TTLCache, limiter, withTimeout, md5, randHex, joinUrl, normTitle };
