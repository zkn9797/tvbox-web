'use strict';
// Site dispatcher: routes calls to CMS / JS spider / jar sidecar, with caching and per-site health.
const cms = require('./cms');
const jsHost = require('./spider/host');
const config = require('./config');
const { db } = require('./db');
const { TTLCache, withTimeout, httpFetch } = require('./util');

const cache = new TTLCache(400);
// stale-while-error: last good result kept for 12h (bounded) and served when the upstream fails
const stale = new TTLCache(Number(process.env.STALE_MAX || 600));
const STALE_TTL = 12 * 3600e3;
const STALE_METHODS = new Set(['home', 'category', 'detail', 'search']);
const TTL = { home: 30 * 60e3, homeVod: 30 * 60e3, category: 10 * 60e3, detail: 15 * 60e3, search: 10 * 60e3, play: 5 * 60e3 };
const { getSetting } = require('./db');
// spider-runtime (Android jar spiders) location: admin setting overrides env
// settings left over from the old 3-container layout (http://tvbox-spider:9978) fall back to the bundled runtime
function runtimeUrl() { let u = getSetting('spider_runtime_url') || ''; if (/\/\/tvbox-spider[:/]/.test(u)) u = ''; return (u || process.env.SPIDER_RUNTIME || '').replace(/\/+$/, ''); }
function runtimeToken() { return getSetting('spider_runtime_token') || process.env.SPIDER_RUNTIME_TOKEN || ''; }

// ---------------- health ----------------
const health = new Map();
for (const r of db.prepare('SELECT * FROM site_health').all()) health.set(r.site, r);
function h(id) {
  let e = health.get(id);
  if (!e) { e = { site: id, ok: 0, fail: 0, consecutive_fail: 0, last_fail: 0, last_ok: 0, avg_ms: 0 }; health.set(id, e); }
  return e;
}
function recordOk(id, ms) { const e = h(id); e.ok++; e.consecutive_fail = 0; e.last_ok = Date.now(); e.avg_ms = e.avg_ms ? e.avg_ms * 0.7 + ms * 0.3 : ms; e.dirty = 1; }
function recordFail(id) { const e = h(id); e.fail++; e.consecutive_fail++; e.last_fail = Date.now(); e.dirty = 1; }
function isDead(id) { const e = health.get(id); return !!e && e.consecutive_fail >= 3 && Date.now() - e.last_fail < 10 * 60e3; }
function speedScore(id) { const e = health.get(id); if (!e) return 3000; return (e.avg_ms || 3000) + e.consecutive_fail * 4000; }
setInterval(() => {
  const st = db.prepare(`INSERT INTO site_health(site,ok,fail,consecutive_fail,last_fail,last_ok,avg_ms) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(site) DO UPDATE SET ok=excluded.ok,fail=excluded.fail,consecutive_fail=excluded.consecutive_fail,last_fail=excluded.last_fail,last_ok=excluded.last_ok,avg_ms=excluded.avg_ms`);
  for (const e of health.values()) if (e.dirty) { st.run(e.site, e.ok, e.fail, e.consecutive_fail, e.last_fail, e.last_ok, Math.round(e.avg_ms)); e.dirty = 0; }
}, 60e3).unref();

// ---------------- dispatch ----------------
function supported(site) {
  if (site.kind === 'cms' || site.kind === 'remote' || site.kind === 'drpy' || site.kind === 'catjs') return true;
  if (site.kind === 'csp') return !!runtimeUrl() && !!site.spiderSpec;
  return false;
}

async function jarCall(repoCfg, site, method, args, timeout = 30000) {
  const base = runtimeUrl();
  const r = await httpFetch(base + '/call', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Runtime-Token': runtimeToken() }, timeout,
    body: JSON.stringify({ jar: site.jar || repoCfg.spider, config: repoCfg.url || '', key: site.key, api: site.api, ext: site.ext, method, args }),
  });
  if (r.status >= 400) throw new Error('spider-runtime HTTP ' + r.status);
  const j = JSON.parse(r.text);
  if (j.error) throw new Error(j.error);
  if (typeof j.result !== 'string') return j.result;
  if (!j.result) return {};
  try { return JSON.parse(j.result); } catch { throw new Error('spider returned non-JSON'); }
}

async function rawCall(repoCfg, siteId, site, method, args) {
  if (site.kind === 'cms' || site.kind === 'remote') {
    switch (method) {
      case 'home': return cms.home(site);
      case 'category': return cms.category(site, args[0], args[1], args[3]);
      case 'detail': return cms.detail(site, args[0]);
      case 'search': return cms.search(site, args[0], args[1], args[2]);
      case 'play': return cms.play(site, args[0], args[1]);
      case 'homeVod': return { list: [] };
    }
    throw new Error('bad method');
  }
  if (site.kind === 'drpy' || site.kind === 'catjs') {
    const to = Math.max(15000, (site.timeout || 0) * 1000 + 5000);
    return jsHost.call(siteId, site, method, args, method === 'home' ? to + 15000 : to);
  }
  if (site.kind === 'csp' && runtimeUrl()) {
    const a = method === 'category' ? [args[0], args[1], args[2], args[3] || {}] : method === 'play' ? [args[0], args[1], repoCfg.flags || []] : args;
    return jarCall(repoCfg, site, method, a, method === 'home' ? 60000 : 30000);
  }
  throw new Error(`暂不支持此类型源 (${site.kind})`);
}

async function findSite(repoId, key) {
  const cfg = await config.getRepo(repoId);
  const site = cfg.sites.find(s => s.key === key);
  if (!site) throw new Error('site not found: ' + key);
  return { cfg, site, siteId: `${repoId}|${key}` };
}

// coalesce identical concurrent calls (frontend retry, several users opening the same page)
const inflight = new Map();
function siteCall(repoId, key, method, args = [], o = {}) {
  if (o.noCache) return siteCall0(repoId, key, method, args, o);
  const k = `${repoId}|${key}|${method}|${JSON.stringify(args)}|${o.background ? 'b' : ''}`;
  let p = inflight.get(k);
  if (!p) { p = siteCall0(repoId, key, method, args, o).finally(() => inflight.delete(k)); inflight.set(k, p); }
  return p;
}
// persisted stale copies (home + category page 1 + detail of CMS-like sites) survive restarts
const PERSIST = new Set(['home', 'category']);
const zlib = require('node:zlib');
const stPut = db.prepare("INSERT INTO kv(ns,k,v) VALUES('stale',?,?) ON CONFLICT(ns,k) DO UPDATE SET v=excluded.v");
const stGet = db.prepare("SELECT v FROM kv WHERE ns='stale' AND k=?");
const lastPersist = new Map();
function persistStale(ck, method, args, r) {
  if (!PERSIST.has(method) || (method === 'category' && String(args[1] || '1') !== '1')) return;
  if (Date.now() - (lastPersist.get(ck) || 0) < 10 * 60e3) return;
  lastPersist.set(ck, Date.now());
  try { stPut.run(ck, JSON.stringify({ t: Date.now(), z: zlib.deflateRawSync(JSON.stringify(r)).toString('base64') })); } catch {}
}
function loadStale(ck) {
  let v = stale.get(ck); if (v) return v;
  try { const row = stGet.get(ck); if (row) { const o = JSON.parse(row.v); if (Date.now() - o.t < 7 * 86400e3) { v = JSON.parse(zlib.inflateRawSync(Buffer.from(o.z, 'base64'))); stale.set(ck, v, STALE_TTL); return v; } } } catch {}
  return undefined;
}
setInterval(() => { try { db.prepare("DELETE FROM kv WHERE ns='stale' AND k IN (SELECT k FROM kv WHERE ns='stale' ORDER BY rowid DESC LIMIT -1 OFFSET 400)").run(); } catch {} }, 3600e3).unref();

// When a good older copy exists, don't make the user wait on a slow/lossy upstream: answer from it after
// FAST_STALE_MS and let the upstream call finish in the background to refresh the cache.
const FAST_STALE_MS = Number(process.env.FAST_STALE_MS || 4000);
const freshInflight = new Map();
const hot = new Map(); // ck -> {repoId,key,method,args,at}
async function siteCall0(repoId, key, method, args = [], { noCache = false, background = false } = {}) {
  const { site, siteId } = await findSite(repoId, key);
  const ck = `${siteId}|${method}|${JSON.stringify(args)}`;
  if (!noCache) { const c = cache.get(ck); if (c) { if (!background) touchHot(ck, repoId, key, method, args, site); return c; } }
  if (!background) touchHot(ck, repoId, key, method, args, site);
  let work = freshInflight.get(ck);
  if (!work) { work = fetchFresh(repoId, key, method, args, ck).finally(() => freshInflight.delete(ck)); freshInflight.set(ck, work); }
  const old = STALE_METHODS.has(method) && !background && loadStale(ck);
  if (!old) return work;
  let timer;
  const fast = new Promise(res => { timer = setTimeout(() => res(Object.assign({}, old, { stale: true, refreshing: true })), FAST_STALE_MS); });
  work.catch(() => {});
  return Promise.race([work, fast]).finally(() => clearTimeout(timer));
}
function touchHot(ck, repoId, key, method, args, site) {
  if (!(site.kind === 'cms' || site.kind === 'remote') || !PERSIST.has(method)) return;
  if (method === 'category' && String(args[1] || '1') !== '1') return;
  hot.set(ck, { repoId, key, method, args, at: Date.now() });
  if (hot.size > 200) hot.delete(hot.keys().next().value);
}
async function fetchFresh(repoId, key, method, args, ck) {
  const { cfg, site, siteId } = await findSite(repoId, key);
  const t0 = Date.now();
  try {
    let r = await rawCall(cfg, siteId, site, method, args);
    if (method === 'home' && site.kind !== 'cms' && site.kind !== 'remote' && (!r.list || !r.list.length)) {
      try { const hv = await rawCall(cfg, siteId, site, 'homeVod', []); if (hv && hv.list) r = { ...r, list: hv.list }; } catch {}
    }
    if (r && Array.isArray(r.class) && Array.isArray(site.categories) && site.categories.length && site.kind !== 'cms') {
      const set = new Set(site.categories); const f = r.class.filter(c => set.has(c.type_name)); if (f.length) r.class = f;
    }
    recordOk(siteId, Date.now() - t0);
    const empty = (method === 'search' || method === 'category') && !(r && r.list && r.list.length);
    const degraded = r && r.degraded;
    if (r && r.degraded !== undefined) { r = Object.assign({}, r); delete r.degraded; }
    if (!empty && !degraded) {
      cache.set(ck, r, TTL[method] || 60e3);
      if (STALE_METHODS.has(method)) { stale.set(ck, r, STALE_TTL); persistStale(ck, method, args, r); }
    } else if (degraded) {
      const old = loadStale(ck);
      if (old && old.list && r.list && old.list.length >= r.list.length) return Object.assign({}, old, { stale: true });
      // partial answer is still better than nothing next time: keep it as the stale copy (never in the main cache)
      if (STALE_METHODS.has(method) && r && ((r.list && r.list.length) || (r.class && r.class.length))) stale.set(ck, r, STALE_TTL);
      r = Object.assign({}, r, { partial: true });
    }
    return r;
  } catch (e) {
    if (!/^warming/.test(e.message || '')) recordFail(siteId);
    const old = STALE_METHODS.has(method) && loadStale(ck);
    if (old) return Object.assign({}, old, { stale: true, staleError: String(e.message || e).slice(0, 120) });
    throw e;
  }
}

// Keep pages people actually use warm: every 4 min, re-fetch CMS home / category page 1 that were viewed in the
// last 6h and whose cache is about to expire (2 at a time; a few small requests per site per half hour).
setInterval(async () => {
  const now = Date.now(); const jobs = [];
  for (const [ck, h] of hot) {
    if (now - h.at > 6 * 3600e3) { hot.delete(ck); continue; }
    const e = cache.m.get(ck);
    if (!e || e.exp - now < 5 * 60e3) jobs.push(h);
  }
  const lim = require('./util').limiter(2);
  await Promise.all(jobs.slice(0, 20).map(h => lim(() => siteCall(h.repoId, h.key, h.method, h.args, { background: true }).catch(() => {}))));
}, 4 * 60e3).unref();

// Aggregate search across searchable sites; calls onResult for each site as it finishes.
async function searchAll(repoId, wd, onResult, { signal, concurrency = Number(process.env.SEARCH_CONCURRENCY || 5), timeout = 9000, only } = {}) {
  const cfg = await config.getRepo(repoId);
  let list = cfg.sites.filter(s => s.searchable !== 0 && supported(s));
  if (only) list = list.filter(s => only.includes(s.key));
  const alive = list.filter(s => !isDead(`${repoId}|${s.key}`));
  alive.sort((a, b) => speedScore(`${repoId}|${a.key}`) - speedScore(`${repoId}|${b.key}`));
  let idx = 0;
  const worker = async () => {
    while (idx < alive.length && !(signal && signal.aborted)) {
      const s = alive[idx++];
      const t0 = Date.now();
      try {
        const to = s.kind === 'cms' ? timeout : s.kind === 'csp' ? timeout + 8000 : timeout + 4000;
        const r = await withTimeout(siteCall(repoId, s.key, 'search', [wd, false, 1]), to);
        onResult({ site: s.key, siteName: s.name, ms: Date.now() - t0, list: (r && r.list) || [] });
      } catch (e) {
        onResult({ site: s.key, siteName: s.name, ms: Date.now() - t0, list: [], error: String(e.message || e).slice(0, 120) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, alive.length) }, worker));
  return { total: list.length, searched: alive.length, skipped: list.length - alive.length };
}

module.exports = { runtimeUrl, runtimeToken, siteCall, searchAll, findSite, supported, isDead, speedScore, health, clearCache: () => cache.clear(), stale };
