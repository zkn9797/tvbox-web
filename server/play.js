'use strict';
// Playback resolution (spider play -> jx parse / sniff -> direct or proxied URL) and the
// streaming proxy with m3u8 rewriting. Video bytes go browser<->origin directly whenever possible.
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { getSetting, setSetting } = require('./db');
const { httpFetch, TTLCache, joinUrl, UA_PC, normUrl } = require('./util');

let SECRET = getSetting('proxy_secret');
if (!SECRET) { SECRET = crypto.randomBytes(16).toString('hex'); setSetting('proxy_secret', SECRET); }

const agents = {
  http: new http.Agent({ keepAlive: true, maxSockets: 24, maxFreeSockets: 8, timeout: 30000 }),
  https: new https.Agent({ keepAlive: true, maxSockets: 24, maxFreeSockets: 8, timeout: 30000, rejectUnauthorized: false }),
};
const corsCache = new TTLCache(500); // host -> bool (origin sends ACAO)
const resolveCache = new TTLCache(300);

const MEDIA_RE = /\.(m3u8|mp4|flv|mkv|m4v|mov|avi|ts|m4a|mp3|aac|mpd|webm)(\?|#|$)/i;
const VIP_FLAGS = ['qq', 'qiyi', 'iqiyi', 'youku', 'mgtv', 'letv', 'leshi', 'sohu', 'pptv', 'bilibili', 'm1905', 'xigua', 'cntv', '优酷', '芒果', '腾讯', '爱奇艺', '奇艺', 'tudou', 'migu', 'wasu'];
function isMedia(u) { return MEDIA_RE.test(u) || /\/m3u8\b|\.m3u8|mime=video|video\/mp4|type=m3u8/i.test(u); }
function isOfficial(u) { return /(qq\.com|iqiyi\.com|youku\.com|mgtv\.com|bilibili\.com|sohu\.com|ixigua\.com|pptv\.com|miguvideo\.com|le\.com|1905\.com|fun\.tv|wasu\.cn|cctv\.com)/.test(u); }
function mediaType(u, ct) {
  if (/mpegurl/i.test(ct || '') || /\.m3u8|m3u8/i.test(u)) return 'hls';
  if (/\.flv(\?|$)/i.test(u) || /flv/i.test(ct || '')) return 'flv';
  return 'file';
}

// ---------- signed proxy tokens ----------
function sign(p) { return crypto.createHmac('sha256', SECRET).update(p).digest('base64url').slice(0, 16); }
function token(url, headers, extra) {
  const p = Buffer.from(JSON.stringify({ u: url, h: headers && Object.keys(headers).length ? headers : undefined, ...(extra || {}) })).toString('base64url');
  return `${p}.${sign(p)}`;
}
function untoken(t) {
  const [p, s] = String(t).split('.');
  if (!p || !s || sign(p) !== s) return null;
  try { return JSON.parse(Buffer.from(p, 'base64url').toString()); } catch { return null; }
}
const proxyM3u8 = (url, headers, sp) => `/px/m/${token(url, headers, sp ? { sp: 1 } : null)}/index.m3u8`;
const proxyFile = (url, headers) => {
  const ext = (/\.(\w{2,4})(\?|$)/.exec(new URL(url).pathname) || [])[1] || 'bin';
  return `/px/f/${token(url, headers)}/media.${ext}`;
};

// ---------- headers helpers ----------
function cleanHeaders(h) {
  const out = {};
  if (!h) return out;
  if (typeof h === 'string') { try { h = JSON.parse(h); } catch { return out; } }
  for (const [k, v] of Object.entries(h)) if (v !== undefined && v !== null && v !== '') out[k] = String(v);
  return out;
}

// ---------- jx parse ----------
async function jsonParse(parseUrl, url, headers) {
  const full = parseUrl.replace(/^json:/, '') + url;
  const r = await httpFetch(full, { headers: Object.assign({ 'User-Agent': UA_PC }, headers || {}), timeout: 8000 });
  let j; try { j = JSON.parse(r.text); } catch { const m = /\{[\s\S]*\}/.exec(r.text); if (!m) throw new Error('jx non-json'); j = JSON.parse(m[0]); }
  const u = j.url || (j.data && (j.data.url || j.data)) || '';
  if (typeof u !== 'string' || !/^https?:/.test(u)) throw new Error('jx no url');
  const hd = cleanHeaders(j.header || j.headers);
  if (j['user-agent'] || j.ua) hd['User-Agent'] = j['user-agent'] || j.ua;
  if (j.referer) hd.Referer = j.referer;
  return { url: u, headers: hd };
}

// best-effort "sniffing": fetch the page (and one level of iframes) looking for a media URL
async function sniff(pageUrl, headers, depth = 0) {
  const r = await httpFetch(pageUrl, { headers: Object.assign({ 'User-Agent': UA_PC, Referer: pageUrl }, headers || {}), timeout: 8000 });
  const html = r.text.replace(/\\\//g, '/');
  const cands = [];
  const re = /(https?:)?\/\/[^"'\s<>()\\]+?\.(m3u8|mp4|flv)(\?[^"'\s<>()\\]*)?/gi; let m;
  while ((m = re.exec(html))) cands.push(m[0].startsWith('//') ? 'https:' + m[0] : m[0]);
  const rel = /["'](\/[^"'\s<>]+?\.m3u8[^"'\s<>]*)["']/gi;
  while ((m = rel.exec(html))) cands.push(joinUrl(r.url, m[1]));
  const good = cands.filter(u => !/\.(js|css|png|jpg)(\?|$)/i.test(u) && !/(ad|guanggao)\.(m3u8|mp4)/i.test(u));
  if (good.length) return { url: good.find(u => /m3u8/i.test(u)) || good[0], headers: Object.assign({}, headers || {}), ref: pageUrl };
  if (depth < 1) {
    const ifr = /<iframe[^>]+src=["']([^"']+)["']/gi; let f;
    while ((f = ifr.exec(html))) { try { return await sniff(joinUrl(r.url, f[1]), headers, depth + 1); } catch {} }
  }
  throw new Error('sniff: no media found');
}

// tier-2: headless-Chromium sniffer service (optional, off unless a URL is configured)
function snifferUrl() { let u = getSetting('sniffer_url') || ''; if (/\/\/tvbox-sniffer[:/]/.test(u)) u = ''; return (u || process.env.SNIFFER_URL || '').replace(/\/+$/, ''); }
function snifferToken() { return getSetting('sniffer_token') || process.env.SNIFFER_TOKEN || ''; }
async function headlessSniff(pageUrl, headers) {
  const base = snifferUrl(); if (!base) throw new Error('sniffer off');
  const h = cleanHeaders(headers); const ua = h['User-Agent'] || h['user-agent']; const ref = h.Referer || h.referer;
  const r = await httpFetch(base + '/sniff', { method: 'POST', timeout: 22000,
    headers: { 'Content-Type': 'application/json', 'X-Sniffer-Token': snifferToken() },
    body: JSON.stringify({ url: pageUrl, ua, referer: ref, timeout: 15000 }) });
  let j; try { j = JSON.parse(r.text); } catch { throw new Error('sniffer bad reply'); }
  if (!j.url) throw new Error('headless sniff: ' + (j.error || 'no media'));
  // keep only what the media request really carried beyond defaults; Referer is re-added on 4xx (sniffRef)
  const out = Object.assign({}, h);
  for (const [k, v] of Object.entries(j.headers || {})) if (/^(cookie|origin)$/i.test(k)) out[k] = v;
  return { url: j.url, headers: out, ref: pageUrl, headless: true };
}
// static sniff first (cheap); fall back to headless Chromium when configured
async function sniffAny(pageUrl, headers) {
  try { return await sniff(pageUrl, headers); }
  catch (e) { if (!snifferUrl()) throw e; return headlessSniff(pageUrl, headers); }
}

async function runParses(cfg, flag, url) {
  const parses = (cfg.parses || []).filter(p => !p.flag || !flag || p.flag.includes(flag));
  const json = parses.filter(p => p.type === 1 || p.type === 2 || p.type === 4);
  const web = parses.filter(p => p.type === 0);
  const tries = [];
  for (const p of json) tries.push(jsonParse(p.url, url, p.header));
  // web parse pages: try sniffing a couple
  for (const p of web.slice(0, 3)) tries.push(sniffAny(p.url + url, p.header));
  if (!tries.length) throw new Error('需要解析但配置没有可用解析接口');
  return Promise.any(tries).catch(() => { throw new Error('所有解析接口均失败'); });
}

// ---------- probes ----------
function originOf(u) { try { return new URL(u).host; } catch { return ''; } }
async function hasCors(u) {
  const host = originOf(u);
  const c = corsCache.get(host); if (c !== undefined) return c;
  try {
    const r = await rawRequest(u, { Origin: 'http://tvbox.local', Range: 'bytes=0-1' }, 'GET', 5000, true);
    const ok = !!r.headers['access-control-allow-origin'];
    r.res && r.res.destroy();
    return corsCache.set(host, ok, 3600e3);
  } catch { return false; }
}

function rawRequest(url, headers, method = 'GET', timeout = 10000, headOnly = false, redirects = 5) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(normUrl(url)); } catch (e) { return reject(e); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method, headers: Object.assign({ 'User-Agent': UA_PC }, headers), agent: agents[u.protocol === 'https:' ? 'https' : 'http'], timeout }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(rawRequest(joinUrl(u.href, res.headers.location), headers, method, timeout, headOnly, redirects - 1));
      }
      res.finalUrl = u.href;
      if (headOnly) return resolve({ status: res.statusCode, headers: res.headers, res, url: u.href });
      resolve({ status: res.statusCode, headers: res.headers, res, url: u.href });
    });
    req.on('timeout', () => req.destroy(new Error('upstream timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function readAll(res, max = 5 * 1024 * 1024) {
  const chunks = []; let n = 0;
  for await (const c of res) { chunks.push(c); n += c.length; if (n > max) { res.destroy(); break; } }
  return Buffer.concat(chunks);
}

async function peek(url, headers) {
  try {
    const r = await rawRequest(url, Object.assign({ Range: 'bytes=0-2047' }, headers), 'GET', 7000);
    const ct = r.headers['content-type'] || '';
    let head = '';
    for await (const c of r.res) { head += c.toString('latin1'); if (head.length >= 2048) break; }
    r.res.destroy();
    if (/^\s*#EXTM3U/.test(head)) return 'hls';
    if (/text\/html/i.test(ct) || /^\s*<(!doctype|html)/i.test(head)) return 'html';
    return 'media';
  } catch { return 'media'; }
}

// ---------- resolve ----------
/**
 * Turn a spider play() result into something the browser can play.
 * client: {https:bool, nativeHls:bool}
 * returns {url, type:'hls'|'file'|'flv', mode:'direct'|'proxy-m3u8'|'proxy', headers?, origin}
 */
async function resolve({ cfg, site, flag, id, playRes, client }) {
  let r = playRes || {};
  let sniffRef = null;
  const doSniff = async (u, hh) => { const x = await sniffAny(u, hh); sniffRef = x.ref; return x; };
  let url = r.url || id;
  // FongMi multi-quality form: url = ["高清", "http://...", "标清", "http://..."]
  if (Array.isArray(url)) { const u = url.find(x => typeof x === 'string' && /^(https?:)?\/\//.test(x)); url = u || String(url[1] || url[0] || ''); }
  if (typeof url !== 'string') url = String(url || '');
  let headers = cleanHeaders(r.header || r.headers);
  if (site.header) Object.assign(headers, cleanHeaders(site.header));
  // drpy: url may be "push://..." or a json string
  if (typeof url === 'string' && url.startsWith('push://')) url = url.slice(7);
  if (!r.parser && r.playUrl) r.parser = r.playUrl;
  if (r.parser) { // CMS playUrl parser / jar playUrl
    const p = r.parser;
    if (/^json:/.test(p)) ({ url, headers } = await jsonParse(p, url, headers));
    else ({ url, headers } = await doSniff(p + url, headers));
  } else {
    const flags = (cfg.flags && cfg.flags.length ? cfg.flags : VIP_FLAGS);
    const needJx = r.jx == 1 || ((flags.includes(flag) || isOfficial(url)) && !isMedia(url));
    if (needJx) ({ url, headers } = await runParses(cfg, flag, url));
    else if (/^https?:/.test(url) && !isMedia(url)) {
      // unknown link: peek at it. HTML page -> sniff (TVBox parse=1 semantics); else treat as media.
      const pk = await peek(url, headers);
      if (pk === 'html') {
        try { ({ url, headers } = await doSniff(url, headers)); }
        catch (e) { if (cfg.parses && cfg.parses.length) ({ url, headers } = await runParses(cfg, flag, url)); else throw e; }
      }
    }
  }
  // jar spiders hand out TVBox local-proxy URLs (127.0.0.1:9978/proxy?...): route via our /jp/ endpoint
  if (/^https?:\/\/(127\.0\.0\.1|localhost):99(?:78|75)\//.test(url)) url = '/jp/' + url.replace(/^https?:\/\/[^/]+\//, '');
  if (!/^https?:/.test(url) && !url.startsWith('/')) throw new Error('无效播放地址');
  if (url.startsWith('/')) return { url, type: mediaType(url), mode: 'local' };

  // ---- decide direct vs proxy ----
  let hasHdr = Object.keys(headers).some(k => /^(referer|cookie|origin|authorization|user-agent|x-)/i.test(k));
  const mixed = client.https && url.startsWith('http:');
  const force = !!client.forceProxy; // browser couldn't reach the origin directly (geo/IP-bound sign, DNS, CORS)
  let type = mediaType(url);
  // probe HLS playlists (validates reachability -> fast failover) unless already cached
  if (type === 'hls' || type === 'file' && !/\.(mp4|mkv|flv|webm|mov)(\?|$)/i.test(url)) {
    let pr = await rawRequest(url, Object.assign({ Origin: 'http://tvbox.local' }, headers), 'GET', 7000);
    if (pr.status >= 400 && sniffRef && !headers.Referer) {
      // sniffed from a web page: only add the page as Referer if the origin demands it
      pr.res.resume();
      headers.Referer = sniffRef; hasHdr = true;
      pr = await rawRequest(url, Object.assign({ Origin: 'http://tvbox.local' }, headers), 'GET', 7000);
    }
    if (pr.status >= 400) { pr.res.resume(); throw new Error('播放地址不可用 HTTP ' + pr.status); }
    const ct = pr.headers['content-type'] || '';
    if (/mpegurl|text|octet/i.test(ct) || type === 'hls') {
      const body = (await readAll(pr.res, 2 * 1024 * 1024)).toString('utf8');
      if (/^#EXTM3U/.test(body.trim())) type = 'hls';
      else if (type === 'hls') throw new Error('m3u8 内容无效');
    } else { pr.res.destroy(); }
    if (type === 'hls') {
      const cors = !!pr.headers['access-control-allow-origin'];
      corsCache.set(originOf(pr.url), cors, 3600e3);
      if (pr.url !== url) url = pr.url;
      if (!force && client.nativeHls && !hasHdr && !mixed) return { url, type, mode: 'direct' };
      if (!force && !hasHdr && !mixed && cors) return { url, type, mode: 'direct' };
      return { url: proxyM3u8(url, headers, hasHdr || mixed || force), type, mode: 'proxy-m3u8', origin: url };
    }
  }
  if (type === 'flv') {
    // mpegts.js uses fetch -> needs CORS
    if (!force && !hasHdr && !mixed && await hasCors(url)) return { url, type, mode: 'direct' };
    return { url: proxyFile(url, headers), type, mode: 'proxy', origin: url };
  }
  // <video src> needs no CORS; only headers / mixed content force the proxy
  if (!force && !hasHdr && !mixed) return { url, type, mode: 'direct' };
  return { url: proxyFile(url, headers), type, mode: 'proxy', origin: url };
}

// ---------- proxy handlers ----------
function rewriteM3u8(text, base, headers, segProxy) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let nextIsPlaylist = false;
  const mapUri = (u, isPl) => {
    const abs = joinUrl(base, u.trim());
    if (isPl || /\.m3u8(\?|$)/i.test(abs)) return proxyM3u8(abs, headers, segProxy);
    return segProxy ? proxyFile(abs, headers) : abs;
  };
  for (const line of lines) {
    const l = line.trim();
    if (!l) { out.push(line); continue; }
    if (l.startsWith('#')) {
      if (/^#EXT-X-STREAM-INF/i.test(l)) nextIsPlaylist = true;
      out.push(l.replace(/URI="([^"]+)"/g, (a, u) => `URI="${mapUri(u, /^#EXT-X-(MEDIA|I-FRAME-STREAM-INF)/i.test(l))}"`));
      continue;
    }
    out.push(mapUri(l, nextIsPlaylist));
    nextIsPlaylist = false;
  }
  return out.join('\n');
}

function sendErr(res, code, msg) { if (!res.headersSent) { res.writeHead(code, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }); } res.end(msg); }

async function handleProxy(req, res, kind, tok) {
  const t = untoken(tok);
  if (!t) return sendErr(res, 403, 'bad token');
  const headers = Object.assign({}, t.h || {});
  try {
    if (kind === 'm') {
      const r = await rawRequest(t.u, headers, 'GET', 10000);
      if (r.status >= 400) { r.res.resume(); return sendErr(res, 502, 'upstream ' + r.status); }
      const body = (await readAll(r.res)).toString('utf8');
      let segProxy = !!t.sp;
      if (!segProxy) {
        // find first media segment and check whether its host allows CORS
        const first = body.split(/\r?\n/).find(l => l && !l.startsWith('#'));
        if (first && !/\.m3u8(\?|$)/i.test(first)) segProxy = !(await hasCors(joinUrl(r.url, first.trim())));
      }
      const out = rewriteM3u8(body, r.url, headers, segProxy);
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
      return res.end(out);
    }
    // file / segment: stream with Range passthrough, no buffering
    if (req.headers.range) headers.Range = req.headers.range;
    if (req.headers['if-range']) headers['If-Range'] = req.headers['if-range'];
    const r = await rawRequest(t.u, headers, req.method === 'HEAD' ? 'HEAD' : 'GET', 15000);
    const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range' };
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag', 'cache-control']) if (r.headers[k]) h[k] = r.headers[k];
    if (!h['accept-ranges'] && r.status === 206) h['accept-ranges'] = 'bytes';
    // some CDNs disguise TS segments as images; fix content-type for players
    if (/image\//.test(h['content-type'] || '') ) h['content-type'] = 'video/mp2t';
    res.writeHead(r.status, h);
    const up = r.res;
    req.on('close', () => up.destroy());
    up.on('error', () => res.destroy());
    up.pipe(res);
  } catch (e) {
    sendErr(res, 502, String(e.message || e));
  }
}

module.exports = { snifferUrl, snifferToken, resolve, handleProxy, isMedia, mediaType, token, untoken, resolveCache };
