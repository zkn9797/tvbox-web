'use strict';
// TVBox Web - HTTP server (no framework, zero npm dependencies).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { db, getSetting, hashPw, checkPw, bootstrap } = require('./db');
const config = require('./config');
const sites = require('./sites');
const play = require('./play');
const jsHost = require('./spider/host');

const PORT = Number(process.env.PORT || 8686);
require('./net').configure({ proxy: getSetting('upstream_proxy') || '', cfIps: getSetting('cf_ips') || '' });
const PUB = path.join(__dirname, '..', 'public');
const { adminPath, initialPw } = bootstrap();
const SESSION_DAYS = 30;

// First boot: seed configs (built-in CMS demo + popular TVBox repos)
if (db.prepare('SELECT COUNT(*) AS n FROM configs').get().n === 0) {
  const demo = fs.readFileSync(path.join(__dirname, '..', 'assets', 'demo-config.json'), 'utf8');
  const ins = db.prepare('INSERT INTO configs(name,url,content,enabled,sort,created) VALUES(?,?,?,?,?,?)');
  ins.run('内置CMS源', '', demo, 1, 1, Date.now());
  ins.run('饭太硬', 'http://www.饭太硬.net/tv', null, 1, 2, Date.now());
  ins.run('肥猫', 'http://肥猫.net/tv', null, 1, 3, Date.now());
}

// ---------- static files (pre-gzipped in memory) ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const staticCache = new Map();
function serveFile(req, res, file, extraHeaders) {
  let e = staticCache.get(file);
  if (!e) {
    if (!fs.existsSync(file)) return notFound(res);
    const raw = fs.readFileSync(file);
    const ext = path.extname(file);
    e = { raw, gz: /\.(html|js|css|svg|json)$/.test(ext) ? zlib.gzipSync(raw, { level: 9 }) : null, type: MIME[ext] || 'application/octet-stream', etag: '"' + crypto.createHash('md5').update(raw).digest('hex').slice(0, 16) + '"' };
    staticCache.set(file, e);
  }
  const h = Object.assign({ 'Content-Type': e.type, ETag: e.etag, 'Cache-Control': 'no-cache' }, extraHeaders || {});
  if (req.headers['if-none-match'] === e.etag) { res.writeHead(304, h); return res.end(); }
  if (e.gz && /gzip/.test(req.headers['accept-encoding'] || '')) { h['Content-Encoding'] = 'gzip'; h.Vary = 'Accept-Encoding'; res.writeHead(200, h); return res.end(e.gz); }
  res.writeHead(200, h); res.end(e.raw);
}
function notFound(res) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }
function json(res, obj, code = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
async function readBody(req, max = 2 * 1024 * 1024) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw new Error('body too large'); chunks.push(c); }
  const s = Buffer.concat(chunks).toString('utf8');
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}

// ---------- auth ----------
function cookies(req) {
  const o = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return o;
}
function currentUser(req) {
  const sid = cookies(req).tvb_sid;
  if (!sid) return null;
  const r = db.prepare('SELECT u.id,u.username,u.is_admin,s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(crypto.createHash('sha256').update(sid).digest('hex'));
  if (!r || r.expires < Date.now()) return null;
  return r;
}
const loginFails = new Map();
function clientIp(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress; }
function isHttps(req) { return req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted; }

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern + '$'), handler, ...opts });

route('POST', '/api/login', async (req, res) => {
  const ip = clientIp(req);
  const f = loginFails.get(ip) || { n: 0, t: 0 };
  if (f.n >= 8 && Date.now() - f.t < 10 * 60e3) return json(res, { error: '尝试次数过多，请10分钟后再试' }, 429);
  const { username, password } = await readBody(req);
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || '').trim());
  if (!u || !checkPw(String(password || ''), u.pw)) {
    loginFails.set(ip, { n: f.n + 1, t: Date.now() });
    return json(res, { error: '用户名或密码错误' }, 401);
  }
  loginFails.delete(ip);
  const sid = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(crypto.createHash('sha256').update(sid).digest('hex'), u.id, Date.now() + SESSION_DAYS * 86400e3);
  res.setHeader('Set-Cookie', `tvb_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${isHttps(req) ? '; Secure' : ''}`);
  json(res, { ok: true, user: { id: u.id, username: u.username, is_admin: !!u.is_admin } });
}, { public: true });

route('POST', '/api/logout', async (req, res) => {
  const sid = cookies(req).tvb_sid;
  if (sid) db.prepare('DELETE FROM sessions WHERE token=?').run(crypto.createHash('sha256').update(sid).digest('hex'));
  res.setHeader('Set-Cookie', 'tvb_sid=; Path=/; Max-Age=0');
  json(res, { ok: true });
}, { public: true });

route('GET', '/api/me', async (req, res, u) => json(res, u ? { user: { id: u.id, username: u.username, is_admin: !!u.is_admin } } : { user: null }), { public: true });

route('POST', '/api/password', async (req, res, u) => {
  const { old, password } = await readBody(req);
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(u.id);
  if (!checkPw(String(old || ''), row.pw)) return json(res, { error: '原密码错误' }, 400);
  if (!password || String(password).length < 6) return json(res, { error: '新密码至少6位' }, 400);
  db.prepare('UPDATE users SET pw=? WHERE id=?').run(hashPw(String(password)), u.id);
  json(res, { ok: true });
});

route('GET', '/api/repos', async (req, res) => json(res, { repos: await config.listRepos() }));

route('GET', '/api/sites', async (req, res, u, q) => {
  const cfg = await config.getRepo(q.get('repo'));
  const repo = q.get('repo');
  json(res, {
    sites: cfg.sites.map(s => ({ key: s.key, name: s.name, kind: s.kind, type: s.type, searchable: s.searchable, filterable: s.filterable,
      supported: sites.supported(s), dead: sites.isDead(`${repo}|${s.key}`), score: Math.round(sites.speedScore(`${repo}|${s.key}`)) })),
    parses: cfg.parses.length, lives: cfg.lives.map(l => ({ name: l.name, url: l.url })),
  });
});

route('GET', '/api/home', async (req, res, u, q) => json(res, await sites.siteCall(q.get('repo'), q.get('site'), 'home', [true])));
route('GET', '/api/category', async (req, res, u, q) => {
  let ext = {}; try { ext = JSON.parse(q.get('ext') || '{}'); } catch {}
  json(res, await sites.siteCall(q.get('repo'), q.get('site'), 'category', [q.get('tid'), String(q.get('pg') || 1), Object.keys(ext).length > 0, ext]));
});
route('GET', '/api/detail', async (req, res, u, q) => json(res, await sites.siteCall(q.get('repo'), q.get('site'), 'detail', [q.get('id')])));
route('GET', '/api/search1', async (req, res, u, q) => json(res, await sites.siteCall(q.get('repo'), q.get('site'), 'search', [q.get('wd'), false, Number(q.get('pg') || 1)])));

route('GET', '/api/play', async (req, res, u, q) => {
  const repo = q.get('repo'), key = q.get('site'), flag = q.get('flag') || '', id = q.get('id');
  const client = { https: q.get('https') === '1' || isHttps(req), nativeHls: q.get('native') === '1', forceProxy: q.get('proxy') === '1' };
  const ck = `${repo}|${key}|${flag}|${id}|${client.https}|${client.nativeHls}|${client.forceProxy}`;
  const cached = !q.get('nocache') && play.resolveCache.get(ck);
  if (cached) return json(res, cached);
  const t0 = Date.now();
  const { cfg, site } = await sites.findSite(repo, key);
  const playRes = await sites.siteCall(repo, key, 'play', [flag, id, cfg.flags || []], { noCache: !!q.get('nocache') });
  const r = await play.resolve({ cfg, site, flag, id, playRes, client });
  r.ms = Date.now() - t0;
  play.resolveCache.set(ck, r, 4 * 60e3);
  json(res, r);
});

// Aggregate search as Server-Sent Events
route('GET', '/api/search', async (req, res, u, q) => {
  const wd = String(q.get('wd') || '').trim();
  if (!wd) return json(res, { error: 'empty' }, 400);
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const ac = new AbortController();
  req.on('close', () => ac.abort());
  const only = q.get('sites') ? q.get('sites').split(',') : null;
  const send = (ev, data) => { if (!res.writableEnded) res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); };
  try {
    const sum = await sites.searchAll(q.get('repo'), wd, r => send('result', r), { signal: ac.signal, only });
    send('done', sum);
  } catch (e) { send('fail', { error: e.message }); }
  res.end();
});

// spider local proxy (drpy getProxy())
route('GET', '/api/spproxy/([^/]+)', async (req, res, u, q, m) => {
  const siteId = decodeURIComponent(m[1]);
  const [repo, key] = [siteId.slice(0, siteId.indexOf('|')), siteId.slice(siteId.indexOf('|') + 1)];
  const params = Object.fromEntries(q.entries());
  const { site } = await sites.findSite(repo, key);
  const r = await jsHost.call(siteId, site, 'proxy', [params], 20000);
  if (!r || !r.code) return notFound(res);
  if (r.code === 302 || r.code === 301) { res.writeHead(r.code, { Location: r.body }); return res.end(); }
  const isB64 = typeof r.body === 'string' && /^base64:/.test(r.body);
  res.writeHead(r.code, Object.assign({ 'Content-Type': r.mime || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' }, r.headers || {}));
  res.end(isB64 ? Buffer.from(r.body.slice(7), 'base64') : r.body);
}, { public: true });

// history / favorites
route('GET', '/api/history', async (req, res, u) => json(res, { list: db.prepare('SELECT * FROM history WHERE user_id=? ORDER BY updated DESC LIMIT 200').all(u.id) }));
route('GET', '/api/history/one', async (req, res, u, q) => json(res, { item: db.prepare('SELECT * FROM history WHERE user_id=? AND site=? AND vod_id=?').get(u.id, q.get('site'), q.get('id')) || null }));
route('POST', '/api/history', async (req, res, u) => {
  const b = await readBody(req);
  if (!b.site || !b.vod_id) return json(res, { error: 'bad' }, 400);
  db.prepare(`INSERT INTO history(user_id,site,vod_id,vod_name,vod_pic,flag,ep_index,ep_name,position,duration,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,site,vod_id) DO UPDATE SET vod_name=excluded.vod_name,vod_pic=excluded.vod_pic,flag=excluded.flag,ep_index=excluded.ep_index,
    ep_name=excluded.ep_name,position=excluded.position,duration=excluded.duration,updated=excluded.updated`)
    .run(u.id, b.site, String(b.vod_id), b.vod_name || '', b.vod_pic || '', b.flag || '', Number(b.ep_index || 0), b.ep_name || '', Number(b.position || 0), Number(b.duration || 0), Date.now());
  json(res, { ok: true });
});
route('DELETE', '/api/history', async (req, res, u, q) => {
  if (q.get('all')) db.prepare('DELETE FROM history WHERE user_id=?').run(u.id);
  else db.prepare('DELETE FROM history WHERE user_id=? AND site=? AND vod_id=?').run(u.id, q.get('site'), q.get('id'));
  json(res, { ok: true });
});
route('GET', '/api/fav', async (req, res, u) => json(res, { list: db.prepare('SELECT * FROM favorites WHERE user_id=? ORDER BY created DESC').all(u.id) }));
route('POST', '/api/fav', async (req, res, u) => {
  const b = await readBody(req);
  db.prepare('INSERT OR REPLACE INTO favorites(user_id,site,vod_id,vod_name,vod_pic,remarks,created) VALUES(?,?,?,?,?,?,?)').run(u.id, b.site, String(b.vod_id), b.vod_name || '', b.vod_pic || '', b.remarks || '', Date.now());
  json(res, { ok: true });
});
route('DELETE', '/api/fav', async (req, res, u, q) => { db.prepare('DELETE FROM favorites WHERE user_id=? AND site=? AND vod_id=?').run(u.id, q.get('site'), q.get('id')); json(res, { ok: true }); });

// ---------- admin (under hidden path) ----------
const A = '/' + adminPath;
route('GET', A + '/?', async (req, res) => serveFile(req, res, path.join(PUB, 'admin.html'), { 'X-Robots-Tag': 'noindex' }), { public: true });
route('GET', A + '/api/users', async (req, res) => json(res, { users: db.prepare('SELECT id,username,is_admin,created FROM users ORDER BY id').all() }), { admin: true });
route('POST', A + '/api/users', async (req, res) => {
  const { username, password } = await readBody(req);
  const name = String(username || '').trim();
  if (!/^[\w\u4e00-\u9fa5.@-]{2,32}$/.test(name)) return json(res, { error: '用户名 2-32 位' }, 400);
  if (!password || String(password).length < 6) return json(res, { error: '密码至少6位' }, 400);
  try { db.prepare('INSERT INTO users(username,pw,is_admin,created) VALUES(?,?,0,?)').run(name, hashPw(String(password)), Date.now()); }
  catch { return json(res, { error: '用户名已存在' }, 400); }
  json(res, { ok: true });
}, { admin: true });
route('DELETE', A + '/api/users/(\\d+)', async (req, res, u, q, m) => {
  const id = Number(m[1]);
  const t = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!t) return json(res, { error: 'not found' }, 404);
  if (t.is_admin) return json(res, { error: '不能删除管理员' }, 400);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM history WHERE user_id=?').run(id);
  db.prepare('DELETE FROM favorites WHERE user_id=?').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  json(res, { ok: true });
}, { admin: true });
route('POST', A + '/api/users/(\\d+)/password', async (req, res, u, q, m) => {
  const { password } = await readBody(req);
  if (!password || String(password).length < 6) return json(res, { error: '密码至少6位' }, 400);
  db.prepare('UPDATE users SET pw=? WHERE id=?').run(hashPw(String(password)), Number(m[1]));
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(Number(m[1]));
  json(res, { ok: true });
}, { admin: true });
route('GET', A + '/api/configs', async (req, res) => json(res, { configs: db.prepare('SELECT id,name,url,enabled,sort,length(content) AS inline_len FROM configs ORDER BY sort,id').all() }), { admin: true });
route('POST', A + '/api/configs', async (req, res) => {
  const { name, url, content } = await readBody(req);
  if (!url && !content) return json(res, { error: '请填写配置地址或粘贴配置 JSON' }, 400);
  let info;
  try {
    const r = await config.loadUrl(url || '', { inline: content || null, force: true });
    info = r.kind === 'multi' ? `多仓: ${r.urls.length} 个仓库` : `站点 ${r.cfg.sites.length} 个，解析 ${r.cfg.parses.length} 个`;
  } catch (e) { return json(res, { error: e.message }, 400); }
  const max = db.prepare('SELECT COALESCE(MAX(sort),0)+1 AS s FROM configs').get().s;
  db.prepare('INSERT INTO configs(name,url,content,enabled,sort,created) VALUES(?,?,?,?,?,?)').run(name || url || '自定义配置', url || '', content || null, 1, max, Date.now());
  json(res, { ok: true, info });
}, { admin: true });
route('PATCH', A + '/api/configs/(\\d+)', async (req, res, u, q, m) => {
  const b = await readBody(req);
  const cur = db.prepare('SELECT * FROM configs WHERE id=?').get(Number(m[1]));
  if (!cur) return json(res, { error: 'not found' }, 404);
  db.prepare('UPDATE configs SET name=?,enabled=?,sort=? WHERE id=?').run(b.name ?? cur.name, b.enabled ?? cur.enabled, b.sort ?? cur.sort, cur.id);
  json(res, { ok: true });
}, { admin: true });
route('DELETE', A + '/api/configs/(\\d+)', async (req, res, u, q, m) => { db.prepare('DELETE FROM configs WHERE id=?').run(Number(m[1])); json(res, { ok: true }); }, { admin: true });
route('POST', A + '/api/configs/(\\d+)/refresh', async (req, res, u, q, m) => {
  const cur = db.prepare('SELECT * FROM configs WHERE id=?').get(Number(m[1]));
  try { await config.loadUrl(cur.url, { inline: cur.content || null, force: true }); config.clearCache(); sites.clearCache(); json(res, { ok: true }); }
  catch (e) { json(res, { error: e.message }, 400); }
}, { admin: true });
route('GET', A + '/api/runtime', async (req, res) => {
  const url = sites.runtimeUrl(); let health = null, error = null;
  if (url) { try { const r = await require('./util').httpFetch(url + '/health', { timeout: 5000, headers: { 'X-Runtime-Token': sites.runtimeToken() } }); health = JSON.parse(r.text); } catch (e) { error = e.message; } }
  json(res, { url, hasToken: !!sites.runtimeToken(), env: process.env.SPIDER_RUNTIME || '', health, error });
}, { admin: true });
route('POST', A + '/api/runtime', async (req, res) => {
  const b = await readBody(req);
  require('./db').setSetting('spider_runtime_url', String(b.url || '').trim());
  if (b.token !== undefined) require('./db').setSetting('spider_runtime_token', String(b.token || ''));
  sites.clearCache();
  json(res, { ok: true });
}, { admin: true });
route('GET', A + '/api/sniffer', async (req, res) => {
  const play = require('./play'); const url = play.snifferUrl(); let health = null, error = null;
  if (url) { try { const r = await require('./util').httpFetch(url + '/health', { timeout: 5000, headers: { 'X-Sniffer-Token': play.snifferToken() } }); health = JSON.parse(r.text); } catch (e) { error = e.message; } }
  json(res, { url, hasToken: !!play.snifferToken(), env: process.env.SNIFFER_URL || '', health, error });
}, { admin: true });
route('POST', A + '/api/sniffer', async (req, res) => {
  const b = await readBody(req);
  require('./db').setSetting('sniffer_url', String(b.url || '').trim());
  if (b.token !== undefined) require('./db').setSetting('sniffer_token', String(b.token || ''));
  json(res, { ok: true });
}, { admin: true });
route('GET', A + '/api/network', async (req, res) => {
  const netx = require('./net'); const px = netx.activeProxy();
  json(res, { proxy: getSetting('upstream_proxy') || '', cfIps: getSetting('cf_ips') || '', env: process.env.UPSTREAM_PROXY || '', active: px ? `${px.host}:${px.port}` : '', stats: netx.stats });
}, { admin: true });
route('POST', A + '/api/network', async (req, res) => {
  const b = await readBody(req); const netx = require('./net');
  const proxy = String(b.proxy || '').trim();
  if (proxy && proxy !== 'auto' && proxy !== 'off') { try { const u = new URL(/^\w+:\/\//.test(proxy) ? proxy : 'http://' + proxy); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { return json(res, { error: '代理格式：http://IP:端口 或 auto' }, 400); } }
  const cf = String(b.cfIps || '').split(/[\s,;]+/).filter(Boolean);
  const bad = cf.filter(x => !require('node:net').isIP(x)); if (bad.length) return json(res, { error: '无效 IP：' + bad.slice(0, 3).join(',') }, 400);
  require('./db').setSetting('upstream_proxy', proxy); require('./db').setSetting('cf_ips', cf.join(','));
  netx.configure({ proxy, cfIps: cf.join(',') }); await netx.detectProxy().catch(() => {});
  json(res, { ok: true });
}, { admin: true });
route('GET', A + '/api/stats', async (req, res) => {
  const mu = process.memoryUsage();
  json(res, { rss_mb: +(mu.rss / 1048576).toFixed(1), heap_mb: +(mu.heapUsed / 1048576).toFixed(1), uptime_s: Math.round(process.uptime()), workers: jsHost.stats(),
    health: [...sites.health.values()].map(e => ({ site: e.site, ok: e.ok, fail: e.fail, consecutive_fail: e.consecutive_fail, avg_ms: Math.round(e.avg_ms) })) });
}, { admin: true });

// ---------- spider-runtime passthrough (jar spiders' local proxy) ----------
const httpMod = require('node:http'), httpsMod = require('node:https');
function jarProxy(req, res, rest) {
  const base = sites.runtimeUrl();
  if (!base) return json(res, { error: 'spider-runtime 未配置' }, 503);
  const target = new URL(base + '/' + rest);
  const lib = target.protocol === 'https:' ? httpsMod : httpMod;
  const h = { 'X-Runtime-Token': sites.runtimeToken() };
  if (req.headers.range) h.Range = req.headers.range;
  const up = lib.request(target, { method: 'GET', headers: h, timeout: 30000 }, ur => {
    const ct = ur.headers['content-type'] || '';
    const hdr = { 'Access-Control-Allow-Origin': '*' };
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'location']) if (ur.headers[k]) hdr[k] = ur.headers[k];
    if (hdr.location) hdr.location = hdr.location.replace(/^https?:\/\/(127\.0\.0\.1|localhost):9978\//, '/jp/');
    if (/mpegurl/i.test(ct)) {
      // rewrite nested local-proxy links inside playlists
      const chunks = []; ur.on('data', c => chunks.push(c)); ur.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8').replace(/https?:\/\/(127\.0\.0\.1|localhost):9978\//g, '/jp/');
        delete hdr['content-length']; res.writeHead(ur.statusCode, hdr); res.end(body);
      });
      return;
    }
    res.writeHead(ur.statusCode, hdr); ur.pipe(res);
  });
  up.on('timeout', () => up.destroy(new Error('timeout')));
  up.on('error', e => { if (!res.headersSent) json(res, { error: e.message }, 502); else res.end(); });
  req.on('close', () => up.destroy());
  up.end();
}


// ---------- poster image proxy (TVBox "url@Referer=...@User-Agent=..." pictures, hotlink-protected hosts) ----------
function parsePicUrl(raw) {
  const parts = String(raw).split('@'); let url = parts.shift(); const h = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' };
  for (const seg of parts) { const i = seg.indexOf('='); if (i < 0) { url += '@' + seg; continue; } const k = seg.slice(0, i).toLowerCase(), v = seg.slice(i + 1);
    if (k === 'referer') h.Referer = v; else if (k === 'user-agent') h['User-Agent'] = v; else if (k === 'cookie') h.Cookie = v; else if (k === 'origin') h.Origin = v; else url += '@' + seg; }
  return { url, headers: h };
}
const netx = require('./net');
const { limiter } = require('./util');
const imgLimit = limiter(Number(process.env.IMG_CONCURRENCY || 8));
function imgProxy(req, res, raw, hops = 0) {
  const { url, headers } = typeof raw === 'string' ? parsePicUrl(raw) : raw;
  let target; try { target = new URL(url); } catch { return notFound(res); }
  if (!/^https?:$/.test(target.protocol) || hops > 3) return notFound(res);
  let closed = false; res.on('close', () => { closed = true; });
  imgLimit(async () => {
    if (closed) return;
    let ur;
    try { ur = await netx.request(target, { headers: Object.assign({ Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' }, headers), timeout: 15000, acceptEncoding: false }); }
    catch { if (!res.headersSent) { res.writeHead(502, { 'Cache-Control': 'no-store' }); } return res.end(); }
    if (ur.statusCode >= 300 && ur.statusCode < 400 && ur.headers.location) { ur.resume(); return imgProxy(req, res, { url: new URL(ur.headers.location, target).href, headers }, hops + 1); }
    const ok = ur.statusCode < 300;
    const hdr = { 'Cache-Control': ok ? 'private, max-age=86400' : 'no-store' };
    for (const k of ['content-type', 'content-length', 'last-modified', 'etag']) if (ur.headers[k]) hdr[k] = ur.headers[k];
    res.writeHead(ur.statusCode, hdr);
    await new Promise(done => { ur.pipe(res); ur.on('end', done); ur.on('error', () => { res.destroy(); done(); }); res.on('close', () => { ur.destroy(); done(); }); });
  }).catch(() => { if (!res.headersSent) res.writeHead(502); res.end(); });
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  // a path starting with "//" would parse as a host name and fall through to the home page: reject it
  if (/^\/{2,}/.test(req.url)) return notFound(res);
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p.startsWith('/px/')) {
      const m = /^\/px\/(m|f)\/([^/]+)/.exec(p);
      if (!m) return notFound(res);
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range' }); return res.end(); }
      return play.handleProxy(req, res, m[1], m[2]);
    }
    if (p === '/img') {
      if (!currentUser(req)) { res.writeHead(401); return res.end(); }
      return imgProxy(req, res, url.searchParams.get('u') || '');
    }
    if (p.startsWith('/jp/')) {
      if (!currentUser(req)) return json(res, { error: '未登录' }, 401);
      return jarProxy(req, res, p.slice(4) + (url.search || ''));
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(p);
      if (!m) continue;
      const u = currentUser(req);
      if (!r.public && !u) return json(res, { error: '未登录', login: true }, 401);
      if (r.admin && !(u && u.is_admin)) return json(res, { error: '需要管理员权限' }, 403);
      return await r.handler(req, res, u, url.searchParams, m);
    }
    if (req.method === 'GET') {
      if (p === '/' || p === '/index.html') return serveFile(req, res, path.join(PUB, 'index.html'));
      if (p.startsWith('/static/')) {
        const f = path.normalize(path.join(PUB, p.slice(8)));
        if (f.startsWith(PUB) && f !== path.join(PUB, 'admin.html')) return serveFile(req, res, f);
      }
      if (p === '/healthz') { res.writeHead(200); return res.end('ok'); }
    }
    notFound(res);
  } catch (e) {
    if (!res.headersSent) json(res, { error: String(e.message || e).slice(0, 300) }, 500);
    else res.end();
  }
});
server.keepAliveTimeout = 65000;
server.listen(PORT, () => {
  console.log(`TVBox Web listening on :${PORT}`);
  console.log(`Admin page: /${adminPath}`);
  if (initialPw) console.log(`Initial admin account: admin / ${initialPw}  (change it in the admin page)`);
});
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { server.close(); process.exit(0); });
process.on('unhandledRejection', e => console.error('unhandled', e && e.message));
