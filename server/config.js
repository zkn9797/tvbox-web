'use strict';
// TVBox config fetching / decoding / normalisation.
const crypto = require('node:crypto');
const { db } = require('./db');
const { smartFetch: httpFetch, TTLCache, joinUrl, UA_OK } = require('./util');

const cache = new TTLCache(50);
const TTL = 30 * 60 * 1000;

// ---------- decoding ----------
function tryB64(s) {
  const t = s.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=_-]{16,}$/.test(t)) return null;
  try {
    const out = Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return /[{\[]/.test(out.slice(0, 50)) ? out : null;
  } catch { return null; }
}

// FongMi style AES config: text starts with "2423" (hex of "$#"), key between $# and #$.
function tryAes(s) {
  try {
    const t = s.trim();
    if (!t.startsWith('2423')) return null;
    const txt = Buffer.from(t, 'hex').toString('latin1');
    // structure: "$#" key "#$" hexdata ... last 13 chars = iv
    const keyStr = txt.slice(2, txt.indexOf('#$'));
    const key = Buffer.from(keyStr.padEnd(16, '0').slice(0, 16));
    const ivStr = t.slice(t.length - 26);
    const iv = Buffer.from(Buffer.from(ivStr, 'hex').toString('latin1').padEnd(16, '0').slice(0, 16));
    const start = t.indexOf('2324') + 4;
    const data = Buffer.from(t.slice(start, t.length - 26), 'hex');
    const d = crypto.createDecipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch { return null; }
}

function stripComments(s) {
  // drop full-line // comments and /* */ blocks, keep URLs intact.
  return s.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !/^\s*(\/\/|#)/.test(l)).join('\n');
}

function parseLenient(s) {
  const t = stripComments(s).replace(/^\uFEFF/, '');
  try { return JSON.parse(t); } catch {}
  // trailing commas / control chars
  const t2 = t.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\t/g, ' ');
  try { return JSON.parse(t2); } catch {}
  // remove // comments at end of lines (not preceded by ':' as in http://)
  const t3 = t2.split('\n').map(l => l.replace(/([^:"'\\])\/\/[^"\n]*$/, '$1')).join('\n').replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(t3);
}

function decodeConfigText(buf) {
  const utf = buf.toString('utf8');
  const trimmed = utf.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  // image header / garbage then "**" + base64
  const latin = buf.toString('latin1');
  const star = latin.indexOf('**');
  if (star >= 0) {
    const after = latin.slice(star + 2).trim();
    const d = tryB64(after);
    if (d) return d;
  }
  const b = tryB64(trimmed);
  if (b) return b;
  const a = tryAes(trimmed);
  if (a) return a;
  // JSON appended after binary (no marker)
  const i = utf.search(/\{\s*"(spider|sites|urls|storeHouse|lives|wallpaper)"/);
  if (i >= 0) return utf.slice(i);
  return trimmed;
}

async function fetchText(url) {
  const r = await httpFetch(url, { headers: { 'User-Agent': UA_OK }, timeout: 20000, raw: true });
  if (r.status >= 400) throw new Error('HTTP ' + r.status);
  return { text: decodeConfigText(r.buf), finalUrl: r.url || url };
}

// ---------- normalisation ----------
function resolveRel(v, base) {
  if (typeof v !== 'string' || !v) return v;
  if (/^(\.\.?\/|\/)/.test(v) && !/^\/\//.test(v)) return joinUrl(base, v);
  return v;
}

function siteKind(s) {
  const api = String(s.api || '');
  const t = Number(s.type);
  if (t === 0 || t === 1) return 'cms';
  if (t === 4) return 'remote';
  if (t === 3) {
    if (/^csp_/i.test(api)) return 'csp';
    const base = api.split('?')[0].toLowerCase();
    if (base.endsWith('.js')) return /drpy/.test(base) ? 'drpy' : 'catjs';
    if (base.endsWith('.py')) return 'py';
  }
  return 'unsupported';
}

function normalizeConfig(j, baseUrl) {
  const spec = v => { if (typeof v !== 'string' || !v) return ''; const parts = v.split(';'); parts[0] = resolveRel(parts[0].replace(/^img\+/, ''), baseUrl); return parts.join(';'); };
  const spider = spec(j.spider);
  const sites = (j.sites || []).filter(s => s && s.key).map(s => {
    const o = {
      key: String(s.key), name: s.name || s.key, type: Number(s.type), api: resolveRel(s.api, baseUrl),
      ext: typeof s.ext === 'string' ? resolveRel(s.ext, baseUrl) : (s.ext || ''),
      jar: s.jar ? spec(String(s.jar)) : '',
      searchable: s.searchable === undefined ? 1 : Number(s.searchable),
      quickSearch: s.quickSearch === undefined ? 1 : Number(s.quickSearch),
      filterable: Number(s.filterable || 0), playUrl: s.playUrl || '', categories: s.categories || null,
      timeout: Number(s.timeout || 0), header: s.header || null, playerType: s.playerType,
    };
    o.kind = siteKind(o);
    if (o.kind === 'csp') o.spiderSpec = o.jar || spider;
    return o;
  });
  const parses = (j.parses || []).filter(p => p && p.url).map(p => ({
    name: p.name, type: Number(p.type || 0), url: resolveRel(p.url, baseUrl), ext: p.ext || {},
    header: (p.ext && p.ext.header) || null, flag: (p.ext && p.ext.flag) || null,
  }));
  const lives = (j.lives || []).map(l => ({ ...l, url: resolveRel(l.url || l.api, baseUrl) }));
  return {
    url: baseUrl, spider, sites, parses, lives, flags: j.flags || [], headers: j.headers || [], ads: j.ads || [],
    rules: j.rules || [], wallpaper: j.wallpaper || '',
  };
}

// Returns {kind:'single', cfg} or {kind:'multi', urls:[{name,url}]}
function interpret(text, baseUrl) {
  const j = parseLenient(text);
  if (Array.isArray(j.urls) && j.urls.length && !j.sites) return { kind: 'multi', urls: j.urls.map(u => ({ name: u.name, url: resolveRel(u.url, baseUrl) })) };
  if (Array.isArray(j.storeHouse)) return { kind: 'multi', urls: j.storeHouse.map(u => ({ name: u.sourceName, url: resolveRel(u.sourceUrl, baseUrl) })) };
  return { kind: 'single', cfg: normalizeConfig(j, baseUrl) };
}

function kvGet(ns, k) { const r = db.prepare('SELECT v FROM kv WHERE ns=? AND k=?').get(ns, k); return r ? r.v : null; }
function kvSet(ns, k, v) { db.prepare('INSERT INTO kv(ns,k,v) VALUES(?,?,?) ON CONFLICT(ns,k) DO UPDATE SET v=excluded.v').run(ns, k, v); }

// Load a config by URL (or inline text) with memory + disk fallback cache.
async function loadUrl(url, { force = false, inline = null } = {}) {
  const ck = inline ? 'inline:' + crypto.createHash('md5').update(inline).digest('hex') : url;
  if (!force) { const c = cache.get(ck); if (c) return c; }
  let text, base = url || 'http://localhost/';
  if (inline) text = decodeConfigText(Buffer.from(inline));
  else {
    try {
      const r = await fetchText(url);
      text = r.text; base = r.finalUrl;
      interpret(text, base); // validate before caching to disk
      kvSet('cfgcache', url, JSON.stringify({ text, base, at: Date.now() }));
    } catch (e) {
      const old = kvGet('cfgcache', url);
      if (!old) throw new Error('配置加载失败: ' + e.message);
      ({ text, base } = JSON.parse(old));
    }
  }
  const res = interpret(text, base);
  return cache.set(ck, res, TTL);
}

// The list of selectable "repos": each enabled config row; multi-repo rows expand to children.
async function listRepos() {
  const rows = db.prepare('SELECT * FROM configs WHERE enabled=1 ORDER BY sort, id').all();
  const out = [];
  for (const r of rows) {
    try {
      const res = await loadUrl(r.url, { inline: r.content || null });
      if (res.kind === 'multi') res.urls.forEach((u, i) => out.push({ id: `${r.id}.${i}`, name: `${r.name} / ${u.name || i + 1}`, url: u.url }));
      else out.push({ id: String(r.id), name: r.name, url: r.url });
    } catch (e) {
      out.push({ id: String(r.id), name: r.name, url: r.url, error: e.message });
    }
  }
  return out;
}

async function getRepo(id, force = false) {
  const [cid, sub] = String(id).split('.');
  const row = db.prepare('SELECT * FROM configs WHERE id=?').get(Number(cid));
  if (!row) throw new Error('config not found');
  let res = await loadUrl(row.url, { inline: row.content || null, force });
  if (res.kind === 'multi') {
    const u = res.urls[Number(sub || 0)];
    if (!u) throw new Error('sub config not found');
    res = await loadUrl(u.url, { force });
    if (res.kind === 'multi') throw new Error('nested multi-repo not supported');
  }
  return res.cfg;
}

module.exports = { loadUrl, listRepos, getRepo, decodeConfigText, parseLenient, interpret, clearCache: () => cache.clear(), kvGet, kvSet };
