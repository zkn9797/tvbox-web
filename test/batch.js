// Batch-test every supported site of a repo: node test/batch.js <base> <user> <pass> <repo> [limit] [wd]
const [base, user, pass, repo, limit = '40', wd = '庆余年'] = process.argv.slice(2);
let cookie = '';
async function api(p, opt = {}) {
  const t = Date.now();
  const ctl = new AbortController(); setTimeout(() => ctl.abort(), opt.timeout || 50000);
  try {
    const r = await fetch(base + p, { signal: ctl.signal, method: opt.method || 'GET', headers: { 'Content-Type': 'application/json', cookie }, body: opt.body ? JSON.stringify(opt.body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const j = await r.json().catch(() => ({})); j._ms = Date.now() - t; return j;
  } catch (e) { return { error: e.message, _ms: Date.now() - t }; }
}
(async () => {
  await api('/api/login', { method: 'POST', body: { username: user, password: pass } });
  const s = await api('/api/sites?repo=' + repo);
  const list = s.sites.filter(x => x.supported).slice(0, Number(limit));
  const res = []; let i = 0;
  async function w() {
    while (i < list.length) {
      const st = list[i++]; const o = { key: st.key, kind: st.kind };
      const h = await api(`/api/home?repo=${repo}&site=${encodeURIComponent(st.key)}`);
      o.home = h.error ? 'ERR ' + h.error.slice(0, 70) : `${(h.class || []).length}c/${(h.list || []).length}v`; o.hms = h._ms;
      let vid = h.list && h.list[0] && h.list[0].vod_id;
      if (!h.error && h.class && h.class[0]) {
        const c = await api(`/api/category?repo=${repo}&site=${encodeURIComponent(st.key)}&tid=${encodeURIComponent(h.class[0].type_id)}&pg=1`);
        o.cat = c.error ? 'ERR ' + c.error.slice(0, 60) : (c.list || []).length; vid = vid || (c.list && c.list[0] && c.list[0].vod_id);
      }
      if (vid && vid !== 'no_data') {
        const d = await api(`/api/detail?repo=${repo}&site=${encodeURIComponent(st.key)}&id=${encodeURIComponent(vid)}`);
        const v = d.list && d.list[0];
        o.detail = d.error ? 'ERR ' + d.error.slice(0, 60) : v ? (v.vod_play_from || '').split('$$$').length + 'lines' : 'empty';
        if (v && v.vod_play_url) {
          const ep = v.vod_play_url.split('$$$')[0].split('#')[0]; const u = ep.slice(ep.indexOf('$') + 1);
          const p = await api(`/api/play?repo=${repo}&site=${encodeURIComponent(st.key)}&flag=${encodeURIComponent(v.vod_play_from.split('$$$')[0])}&id=${encodeURIComponent(u)}`);
          o.play = p.error ? 'ERR ' + p.error.slice(0, 60) : `${p.type}/${p.mode}`; o.pms = p._ms;
        }
      }
      res.push(o); console.log(JSON.stringify(o));
    }
  }
  await Promise.all([w(), w(), w()]);
  const ok = k => res.filter(o => o[k] && !String(o[k]).startsWith('ERR') && o[k] !== 'empty' && o[k] !== '0c/0v' && o[k] !== 0).length;
  console.log(`SUMMARY sites=${res.length} home=${ok('home')} cat=${ok('cat')} detail=${ok('detail')} play=${ok('play')}`);
})();
