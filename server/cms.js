'use strict';
// Type 0 (XML) / type 1 (JSON) CMS sites (MacCMS style) and type 4 (remote HTTP spider API).
const { httpFetch, UA_OK, TTLCache } = require('./util');
let kv = null; try { const { db } = require('./db'); kv = { get: k => { const r = db.prepare("SELECT v FROM kv WHERE ns='cmskids' AND k=?").get(k); return r ? r.v : null; }, set: (k, v) => db.prepare("INSERT INTO kv(ns,k,v) VALUES('cmskids',?,?) ON CONFLICT(ns,k) DO UPDATE SET v=excluded.v").run(k, v) }; } catch {}

function qs(api, params) {
  const u = new URL(api);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  return u.href;
}

function hdrs(site) {
  const h = { 'User-Agent': UA_OK };
  if (site.header && typeof site.header === 'object') Object.assign(h, site.header);
  return h;
}

async function get(site, params) {
  const r = await httpFetch(qs(site.api, params), { headers: hdrs(site), timeout: Math.max((site.timeout ? site.timeout * 1000 : 0) || 12000, 8000) });
  if (r.status >= 400) throw new Error('HTTP ' + r.status);
  return r.text;
}

// ---------------- XML ----------------
const ent = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
const tag = (x, t) => { const m = new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i').exec(x); return m ? ent(m[1]) : ''; };

function xmlVideos(xml) {
  const out = [];
  const re = /<video>([\s\S]*?)<\/video>/gi; let m;
  while ((m = re.exec(xml))) {
    const v = m[1];
    const from = [], urls = [];
    const dd = /<dd\s+flag="([^"]*)"[^>]*>([\s\S]*?)<\/dd>/gi; let d;
    while ((d = dd.exec(v))) { from.push(ent(d[1])); urls.push(ent(d[2])); }
    out.push({
      vod_id: tag(v, 'id'), vod_name: tag(v, 'name'), vod_pic: tag(v, 'pic'), type_name: tag(v, 'type'),
      vod_remarks: tag(v, 'note'), vod_year: tag(v, 'year'), vod_area: tag(v, 'area'), vod_actor: tag(v, 'actor'),
      vod_director: tag(v, 'director'), vod_content: tag(v, 'des').replace(/<[^>]+>/g, ''),
      vod_play_from: from.join('$$$'), vod_play_url: urls.join('$$$'),
    });
  }
  return out;
}
function xmlPage(xml) {
  const m = /<list[^>]*page="(\d+)"[^>]*pagecount="(\d+)"/i.exec(xml);
  return m ? { page: +m[1], pagecount: +m[2] } : {};
}
function xmlClasses(xml) {
  const out = []; const re = /<ty\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/ty>/gi; let m;
  while ((m = re.exec(xml))) out.push({ type_id: m[1], type_name: ent(m[2]) });
  return out;
}

function J(t) { try { return JSON.parse(t); } catch { const i = t.indexOf('{'); return JSON.parse(t.slice(i)); } }

function cleanVod(v) {
  if (v.vod_content) v.vod_content = String(v.vod_content).replace(/<[^>]+>/g, '').trim();
  return v;
}

// categories filtering by site.categories (TVBox: only show listed category names)
function filterCats(site, classes) {
  if (Array.isArray(site.categories) && site.categories.length) {
    const set = new Set(site.categories);
    const f = classes.filter(c => set.has(c.type_name));
    if (f.length) return f;
  }
  return classes;
}

async function home(site) {
  if (site.type === 0) {
    const xml = await get(site, {});
    let list = [];
    try { list = xmlVideos(await get(site, { ac: 'videolist', pg: 1 })); } catch {}
    return { class: filterCats(site, xmlClasses(xml)), list };
  }
  if (site.type === 4) {
    const j = J(await get(site, { filter: 'true' }));
    return { class: j.class || [], filters: j.filters, list: j.list || [] };
  }
  const [cls, det] = await Promise.all([acList(site), get(site, { ac: 'detail', pg: 1 }).then(t => J(t).list || []).catch(() => null)]);
  return { class: filterCats(site, cls.map(c => ({ type_id: String(c.type_id), type_name: c.type_name }))), list: (det || []).map(cleanVod), degraded: det === null };
}

async function category(site, tid, pg = 1, extend = {}) {
  if (site.type === 0) {
    const xml = await get(site, { ac: 'videolist', t: tid, pg });
    const list = xmlVideos(xml);
    if (list.length < 10 && /\/at\/xml\/?/.test(site.api)) {
      // XML class lists carry no parent ids: learn them from the JSON flavour of the same MacCMS api
      const js = { ...site, type: 1, api: site.api.replace(/\/at\/xml\/?/, '/') };
      let kids = getKids(js);
      if (!kids) { try { await acList(js); kids = getKids(js); } catch {} }
      const ch = (kids && kids[String(tid)]) || [];
      if (ch.length) {
        let failed = 0;
        const rs = await Promise.all(ch.slice(0, 8).map(c => get(site, { ac: 'videolist', t: c, pg }).catch(() => { failed++; return ''; })));
        const seen = new Set();
        const all = [].concat(list, ...rs.map(xmlVideos)).filter(v => !seen.has(v.vod_id) && seen.add(v.vod_id));
        if (failed === rs.length && !all.length) throw new Error('子分类全部加载失败');
        return { list: all, page: pg, pagecount: Math.max(xmlPage(xml).pagecount || 0, ...rs.map(x => xmlPage(x).pagecount || 0)), degraded: failed > 0 };
      }
    }
    return { list, ...xmlPage(xml) };
  }
  if (site.type === 4) {
    const ext = Object.keys(extend || {}).length ? Buffer.from(JSON.stringify(extend)).toString('base64') : '';
    const j = J(await get(site, { ac: 'detail', t: tid, pg, ext }));
    return { list: j.list || [], page: +j.page || pg, pagecount: +j.pagecount || 0 };
  }
  // parent + known sub-categories are fetched in parallel (one slow round-trip instead of two on lossy links)
  const known = getKids(site);
  const kidsOf = k => ((k && k[String(tid)]) || []).slice(0, 8);
  const fetchKids = ch => ch.map(c => get(site, { ac: 'detail', t: c, pg, ...extend }).then(J).then(r => ({ ok: 1, r }), () => ({ ok: 0, r: {} })));
  let kidP = kidsOf(known).length ? fetchKids(kidsOf(known)) : null;
  let j, jErr;
  try { j = J(await get(site, { ac: 'detail', t: tid, pg, ...extend })); } catch (e) { jErr = e; j = { list: [] }; }
  if (!kidP && (j.list || []).length < 10 && !jErr) {
    let kids = known, kidsFailed = false;
    if (!kids) { try { await acList(site); kids = getKids(site); } catch { kidsFailed = true; } }
    if (kidsOf(kids).length) kidP = fetchKids(kidsOf(kids));
    else if (kidsFailed) return { list: (j.list || []).map(cleanVod), page: +j.page || pg, pagecount: +j.pagecount || 0, degraded: true };
  }
  if (kidP) {
    const rs = await Promise.all(kidP);
    const failed = rs.filter(x => !x.ok).length;
    if (jErr && failed === rs.length) throw jErr;
    const seen = new Set(); const list = [].concat(j.list || [], ...rs.map(x => x.r.list || [])).filter(v => !seen.has(v.vod_id) && seen.add(v.vod_id)).sort((a, b) => String(b.vod_time || '').localeCompare(String(a.vod_time || '')));
    if (!list.length && failed) throw new Error('子分类全部加载失败');
    return { list: list.map(cleanVod), page: pg, pagecount: Math.max(+j.pagecount || 0, ...rs.map(x => +x.r.pagecount || 0)), degraded: failed > 0 || !!jErr };
  }
  if (jErr) throw jErr;
  return { list: (j.list || []).map(cleanVod), page: +j.page || pg, pagecount: +j.pagecount || 0 };
}
// ac=list (class list) cached 1h per api; parent->children map also persisted so a cold start / failed
// ac=list still merges sub-categories.
const KIDS = new Map();
const LIST = new TTLCache(200);
const listInflight = new Map();
function rememberKids(site, cls) {
  const m = {};
  for (const c of cls || []) { const p = String(c.type_pid ?? ''); if (p && p !== '0') (m[p] = m[p] || []).push(String(c.type_id)); }
  KIDS.set(site.api, m);
  if (kv && Object.keys(m).length) { try { kv.set(site.api, JSON.stringify(m)); } catch {} }
}
function getKids(site) {
  let m = KIDS.get(site.api);
  if (!m && kv) { try { const v = kv.get(site.api); if (v) { m = JSON.parse(v); KIDS.set(site.api, m); } } catch {} }
  return m;
}
async function acList(site) {
  const c = LIST.get(site.api); if (c) return c;
  let p = listInflight.get(site.api);
  if (!p) {
    p = get(site, { ac: 'list' }).then(t => { const cls = J(t).class || []; if (!cls.length) throw new Error('empty class list'); rememberKids(site, cls); LIST.set(site.api, cls, 3600e3); return cls; })
      .finally(() => listInflight.delete(site.api));
    listInflight.set(site.api, p);
  }
  return p;
}

async function detail(site, id) {
  if (site.type === 0) return { list: xmlVideos(await get(site, { ac: 'videolist', ids: id })) };
  const j = J(await get(site, { ac: 'detail', ids: id }));
  return { list: (j.list || []).map(cleanVod) };
}

async function search(site, wd, quick = false, pg = 1) {
  if (site.type === 0) return { list: xmlVideos(await get(site, { ac: 'videolist', wd, pg: pg > 1 ? pg : '' })) };
  if (site.type === 4) { const j = J(await get(site, { wd, quick: quick ? 'true' : 'false' })); return { list: j.list || [] }; }
  const j = J(await get(site, { ac: 'detail', wd, pg: pg > 1 ? pg : '' }));
  return { list: (j.list || []).map(cleanVod) };
}

async function play(site, flag, id) {
  if (site.type === 4) {
    const j = J(await get(site, { play: id, flag }));
    return j;
  }
  // CMS: the url itself; playUrl prefix if configured; parse when not a direct media link
  // site.playUrl (TVBox) is a parser prefix: "json:http://jx?url=" (JSON parse) or a web parse url.
  if (site.playUrl) return { parse: 1, url: id, parser: site.playUrl };
  return { parse: 0, url: id };
}

module.exports = { home, category, detail, search, play };
