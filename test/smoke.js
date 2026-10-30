// Smoke test: node test/smoke.js <base> <user> <pass> [repo] [siteKey] [keyword]
const [base, user, pass, repo = '1', siteKey = '', wd = '凡人修仙传'] = process.argv.slice(2);
let cookie = '';
async function api(p, opt = {}) {
  const t = Date.now();
  const r = await fetch(base + p, { method: opt.method || 'GET', headers: { 'Content-Type': 'application/json', cookie }, body: opt.body ? JSON.stringify(opt.body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { j = { raw: txt.slice(0, 300) }; }
  j._ms = Date.now() - t; j._status = r.status;
  return j;
}
(async () => {
  const l = await api('/api/login', { method: 'POST', body: { username: user, password: pass } });
  console.log('login', l._status, l.user && l.user.username);
  const repos = await api('/api/repos'); console.log('repos', JSON.stringify(repos.repos));
  const s = await api('/api/sites?repo=' + repo);
  const kinds = {}; (s.sites || []).forEach(x => kinds[x.kind + (x.supported ? '' : '(off)')] = (kinds[x.kind + (x.supported ? '' : '(off)')] || 0) + 1);
  console.log('sites', s._ms + 'ms', JSON.stringify(kinds), 'parses', s.parses);
  const site = siteKey || (s.sites.find(x => x.supported) || {}).key;
  const h = await api(`/api/home?repo=${repo}&site=${encodeURIComponent(site)}`);
  console.log('home', site, h._ms + 'ms', h.error || '', 'classes', (h.class || []).length, 'list', (h.list || []).length);
  if (h.class && h.class[0]) {
    const c = await api(`/api/category?repo=${repo}&site=${encodeURIComponent(site)}&tid=${encodeURIComponent(h.class[0].type_id)}&pg=1`);
    console.log('category', c._ms + 'ms', c.error || '', 'items', (c.list || []).length, c.list && c.list[0] && c.list[0].vod_name);
  }
  // SSE search
  const t = Date.now();
  const r = await fetch(`${base}/api/search?repo=${repo}&wd=${encodeURIComponent(wd)}`, { headers: { cookie } });
  const txt = await r.text();
  const results = txt.split('\n\n').filter(x => x.startsWith('event: result')).map(x => JSON.parse(x.split('data: ')[1]));
  console.log('search', (Date.now() - t) + 'ms', results.map(x => `${x.site}:${x.list.length}${x.error ? '(' + x.error.slice(0, 40) + ')' : ''}@${x.ms}`).join(' | '));
  const hit = results.find(x => x.list.length && (!siteKey || x.site === siteKey)) || results.find(x => x.list.length);
  if (!hit) return;
  const v = hit.list[0];
  const d = await api(`/api/detail?repo=${repo}&site=${encodeURIComponent(hit.site)}&id=${encodeURIComponent(v.vod_id)}`);
  const vod = d.list && d.list[0];
  console.log('detail', hit.site, d._ms + 'ms', d.error || '', vod && vod.vod_name, vod && vod.vod_play_from);
  if (!vod) return;
  const froms = vod.vod_play_from.split('$$$'), urls = vod.vod_play_url.split('$$$');
  for (let i = 0; i < froms.length; i++) {
    const ep = urls[i].split('#')[0]; const u = ep.slice(ep.indexOf('$') + 1);
    const p = await api(`/api/play?repo=${repo}&site=${encodeURIComponent(hit.site)}&flag=${encodeURIComponent(froms[i])}&id=${encodeURIComponent(u)}`);
    console.log('play', froms[i], p._ms + 'ms', p.error || `${p.type} ${p.mode} ${String(p.url).slice(0, 110)}`);
    if (p.url && p.url.startsWith('/px/')) {
      const pr = await fetch(base + p.url); const body = await pr.text();
      console.log('  proxy m3u8', pr.status, body.split('\n').slice(0, 8).join(' ').slice(0, 300));
    }
  }
})().catch(e => console.log('ERR', e));
