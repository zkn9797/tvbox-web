'use strict';
// Nightly refresh of the built-in CMS repo: gather MacCMS (provide/vod JSON) APIs from public
// MoonTV/LunaTV configs + the user's other repos, probe each one (list, search, m3u8 reachable),
// and rewrite the built-in config with the fastest working ones.
const { db } = require('./db');
const { httpFetch } = require('./util');
const config = require('./config');

const FEEDS = (process.env.CMS_FEEDS || [
  'https://raw.githubusercontent.com/hafrey1/LunaTV-config/main/jin18.json',
  'https://raw.githubusercontent.com/moli-xia/MoonTV-app/main/config.json',
].join(',')).split(',').map(s => s.trim()).filter(Boolean);
const MIRRORS = ['', 'https://gh-proxy.com/', 'https://ghproxy.net/'];
const HOUR = Number(process.env.CMS_FEED_HOUR || 4); // local hour (Asia/Shanghai by default)
const TZ = process.env.CMS_FEED_TZ || 'Asia/Shanghai';
const MAX = Number(process.env.CMS_FEED_MAX || 30);
const ADULT = /成人|伦理|福利|写真|里番|黄色|色情|激情|av(?![a-z])|18\+|老司机|麻豆|探花/i;
// Fallback seeds so a run still works when GitHub is unreachable.
const SEEDS = [
  ['量子资源', 'https://cj.lziapi.com/api.php/provide/vod'], ['非凡资源', 'https://api.ffzyapi.com/api.php/provide/vod'],
  ['暴风资源', 'https://bfzyapi.com/api.php/provide/vod'], ['光速资源', 'https://api.guangsuapi.com/api.php/provide/vod'],
  ['卧龙资源', 'https://wolongzyw.com/api.php/provide/vod'], ['iKun资源', 'https://ikunzyapi.com/api.php/provide/vod'],
  ['电影天堂', 'http://caiji.dyttzyapi.com/api.php/provide/vod'], ['极速资源', 'https://jszyapi.com/api.php/provide/vod'],
  ['魔都资源', 'https://www.mdzyapi.com/api.php/provide/vod'], ['最大资源', 'https://api.zuidapi.com/api.php/provide/vod'],
  ['无尽资源', 'https://api.wujinapi.me/api.php/provide/vod'], ['新浪资源', 'https://api.xinlangapi.com/xinlangapi.php/provide/vod'],
  ['如意资源', 'https://cj.rycjapi.com/api.php/provide/vod'], ['红牛资源', 'https://www.hongniuzy2.com/api.php/provide/vod'],
  ['天涯资源', 'https://tyyszy.com/api.php/provide/vod'], ['360资源', 'https://360zy.com/api.php/provide/vod'],
  ['茅台资源', 'https://caiji.maotaizy.cc/api.php/provide/vod'], ['豆瓣资源', 'https://caiji.dbzy5.com/api.php/provide/vod'],
  ['速播资源', 'https://subocaiji.com/api.php/provide/vod'], ['旺旺资源', 'https://api.wwzy.tv/api.php/provide/vod'],
];

const kvGet = k => config.kvGet('cmsfeed', k);
const kvSet = (k, v) => config.kvSet('cmsfeed', k, v);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function normApi(a) {
  let s = String(a || '').trim();
  const m = s.match(/[?&]url=(https?:\/\/.+)$/); if (m) s = decodeURIComponent(m[1]); // strip CORS proxies
  s = s.replace(/\/+$/, '').replace(/\?.*$/, '');
  try { const u = new URL(s); if (!/^https?:$/.test(u.protocol)) return ''; return u.href.replace(/\/+$/, ''); } catch { return ''; }
}
const cleanName = n => String(n || '').replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, '').replace(/^[-\s·]+|[-\s·]+$/g, '').trim();

async function fetchFeed(url) {
  for (const m of MIRRORS) {
    try {
      const r = await httpFetch(m + url, { timeout: 15000 });
      if (r.status < 400) return JSON.parse(r.text);
    } catch {}
  }
  return null;
}

async function gather() {
  const out = new Map(), add = (name, api, from) => {
    const a = normApi(api); name = cleanName(name);
    if (!a || !/provide\/vod/i.test(a) || ADULT.test(name) || ADULT.test(a)) return;
    const k = new URL(a).host.replace(/^(www|api|cj|caiji|json)\./, '') + new URL(a).pathname;
    if (!out.has(k)) out.set(k, { name: name || new URL(a).host, api: a, from });
  };
  SEEDS.forEach(([n, a]) => add(n, a, 'seed'));
  for (const f of FEEDS) {
    const j = await fetchFeed(f); if (!j) continue;
    const sites = j.api_site ? Object.values(j.api_site) : Array.isArray(j.sites) ? j.sites.filter(s => Number(s.type) === 1) : [];
    sites.forEach(s => add(s.name, s.api, 'feed'));
  }
  // type-1 CMS sites found in the user's other repos (only ones already cached; never forces a reload)
  for (const r of db.prepare("SELECT * FROM configs WHERE enabled=1 AND url<>''").all()) {
    try { const res = await Promise.race([config.loadUrl(r.url), sleep(20000).then(() => null)]); (res && res.cfg && res.cfg.sites || []).filter(s => Number(s.type) === 1).forEach(s => add(s.name, s.api, r.name)); } catch {}
  }
  return [...out.values()];
}

async function getJson(url, timeout) {
  const r = await httpFetch(url, { timeout });
  if (r.status >= 400) throw new Error('HTTP ' + r.status);
  try { return JSON.parse(r.text); } catch { throw new Error('非 JSON'); }
}

async function probe(c) {
  const t0 = Date.now();
  const j = await getJson(c.api + '?ac=detail&pg=1', 9000);
  const list = (j.list || []).filter(v => v.vod_name);
  if (!list.length) throw new Error('列表为空');
  const v = list.find(x => /\.m3u8/i.test(x.vod_play_url || '')) || list[0];
  const mu = String(v.vod_play_url || '').split(/[#$]/).find(x => /^https?:\/\/\S+\.m3u8/i.test(x));
  if (!mu) throw new Error('无 m3u8 播放地址');
  const t1 = Date.now() - t0;
  const s = await getJson(c.api + '?ac=detail&wd=' + encodeURIComponent(v.vod_name), 9000);
  if (!(s.list || []).length) throw new Error('搜索无结果');
  const t2 = Date.now();
  const m = await httpFetch(mu, { timeout: 8000 });
  if (m.status >= 400 || !/#EXTM3U/.test(m.text.slice(0, 200))) throw new Error('m3u8 不可用');
  const total = t1 + (Date.now() - t2);
  return { ms: total, count: Number(j.total || 0), cls: (j.class || []).length };
}

let running = null;
async function run(reason = 'schedule') {
  if (running) return running;
  running = (async () => {
    const t0 = Date.now();
    const cands = await gather();
    const ok = [], bad = [];
    let i = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (i < cands.length) {
        const c = cands[i++];
        try { Object.assign(c, await probe(c)); ok.push(c); } catch (e) { bad.push({ name: c.name, api: c.api, err: String(e.message || e).slice(0, 60) }); }
      }
    }));
    ok.sort((a, b) => a.ms - b.ms);
    // same provider under several domains (非凡影视 / 非凡资源, 360资源 x2): keep the fastest
    const seen = new Set(), core = n => n.replace(/\s+/g, '').replace(/(资源|影视|点播|资源站|zy)$/i, '');
    const keep = ok.filter(c => { const k = core(c.name); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, MAX);
    const report = { at: Date.now(), reason, took: Date.now() - t0, candidates: cands.length, ok: keep.map(c => ({ name: c.name, api: c.api, ms: c.ms, from: c.from })), bad };
    if (keep.length >= 3) {
      const row = db.prepare("SELECT * FROM configs WHERE url='' AND name LIKE '%内置%' ORDER BY id LIMIT 1").get();
      if (row) {
        let cur = {}; try { cur = JSON.parse(row.content || '{}'); } catch {}
        const others = (cur.sites || []).filter(s => Number(s.type) !== 1 && Number(s.type) !== 0); // keep drpy etc.
        const used = new Set();
        const cms = keep.map(c => {
          let key = 'cms_' + new URL(c.api).host.replace(/^(www|api|cj|caiji|json)\./, '').split('.')[0].replace(/[^a-z0-9]/gi, '');
          while (used.has(key)) key += '_'; used.add(key);
          return { key, name: c.name, type: 1, api: c.api + '/', searchable: 1, quickSearch: 1, filterable: 0 };
        });
        cur.sites = cms.concat(others);
        db.prepare('UPDATE configs SET content=? WHERE id=?').run(JSON.stringify(cur, null, 1), row.id);
        config.clearCache(); try { require('./sites').clearCache(); } catch {}
        report.written = cms.length;
      }
    } else report.written = 0;
    kvSet('report', JSON.stringify(report));
    kvSet('last', String(report.at));
    console.log(`[cmsfeed] ${reason}: ${cands.length} candidates, ${ok.length} ok, wrote ${report.written} in ${Math.round(report.took / 1000)}s`);
    return report;
  })().finally(() => { running = null; });
  return running;
}

function localDay() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); }
function localHour() { return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ }).format(new Date())) % 24; }
function start() {
  if (process.env.CMS_FEED === '0') return;
  const tick = () => {
    const last = Number(kvGet('last') || 0), today = localDay();
    // nightly at HOUR (local), once per local day; a manual/first run earlier that night must not block it
    if (localHour() === HOUR && kvGet('nightly') !== today) { kvSet('nightly', today); run('nightly').catch(e => console.log('[cmsfeed] failed', e.message)); }
    else if (!last) run('first-run').catch(e => console.log('[cmsfeed] failed', e.message));
  };
  setTimeout(tick, 90e3).unref();
  setInterval(tick, 10 * 60e3).unref();
}
const report = () => { try { return JSON.parse(kvGet('report') || 'null'); } catch { return null; } };
module.exports = { start, run, report };
