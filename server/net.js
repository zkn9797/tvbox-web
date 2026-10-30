'use strict';
// Resilient outbound HTTP(S) without npm deps.
//  - direct path (default): resolves all A/AAAA records, staggered connect race (happy-eyeballs style) with a
//    short per-attempt TCP connect timeout, remembers the address that worked per host, one quick retry.
//  - optional "Cloudflare 优选IP": user-provided IPs used as extra connect targets for hosts resolving into
//    Cloudflare ranges (SNI + Host stay the original hostname).
//  - optional upstream HTTP proxy (UPSTREAM_PROXY env or admin setting). OFF unless configured. "auto" probes the
//    docker gateway for a local mixed proxy (7890/7897) once. Internal hosts are never proxied. If the proxy is
//    unreachable we fall back to direct for 60s.
const net = require('node:net');
const tls = require('node:tls');
const http = require('node:http');
const dns = require('node:dns');
const fs = require('node:fs');

const CONNECT_TIMEOUT = Number(process.env.CONNECT_TIMEOUT_MS || 3000);
const STAGGER = Number(process.env.CONNECT_STAGGER_MS || 1200);

// ---------------- settings ----------------
const cfg = { proxy: '', proxyEnv: (process.env.UPSTREAM_PROXY || '').trim(), cfIps: [] };
let autoProxy = null; // resolved value for "auto"
function configure(o = {}) {
  if (o.proxy !== undefined) cfg.proxy = String(o.proxy || '').trim();
  if (o.cfIps !== undefined) cfg.cfIps = String(o.cfIps || '').split(/[\s,;]+/).map(s => s.trim()).filter(s => net.isIP(s));
}
function proxySpec() { return cfg.proxy || cfg.proxyEnv; }
let proxyDownUntil = 0;
function activeProxy() {
  let p = proxySpec();
  if (!p || p === 'off' || p === 'none') return null;
  if (p === 'auto') { p = autoProxy; if (!p) return null; }
  if (Date.now() < proxyDownUntil) return null;
  try { const u = new URL(/^\w+:\/\//.test(p) ? p : 'http://' + p); return { host: u.hostname, port: Number(u.port || 80), auth: u.username ? Buffer.from(decodeURIComponent(u.username) + ':' + decodeURIComponent(u.password)).toString('base64') : '' }; } catch { return null; }
}
function gatewayIp() {
  try {
    for (const l of fs.readFileSync('/proc/net/route', 'utf8').split('\n').slice(1)) {
      const f = l.trim().split(/\s+/);
      if (f[1] === '00000000' && f[2]) { const h = f[2]; return [3, 2, 1, 0].map(i => parseInt(h.substr(i * 2, 2), 16)).join('.'); }
    }
  } catch {}
  return '';
}
async function detectProxy() {
  if (proxySpec() !== 'auto') return null;
  const gw = gatewayIp(); if (!gw) return null;
  for (const port of [7890, 7897, 7893]) {
    const ok = await new Promise(r => { const s = net.connect({ host: gw, port, timeout: 1500 }, () => { s.destroy(); r(true); }); s.on('error', () => r(false)); s.on('timeout', () => { s.destroy(); r(false); }); });
    if (ok) { autoProxy = `http://${gw}:${port}`; return autoProxy; }
  }
  autoProxy = null; return null;
}
setTimeout(() => { detectProxy().catch(() => {}); }, 10).unref();
setInterval(() => { detectProxy().catch(() => {}); }, 10 * 60e3).unref();

// ---------------- host classification ----------------
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  return l === '::1' || l.startsWith('fe80') || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('::ffff:127.') || l.startsWith('::ffff:10.') || l.startsWith('::ffff:192.168.');
}
function isInternalHost(host) {
  host = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || !host.includes('.') && !net.isIPv6(host)) return true;
  if (/^tvbox-/.test(host) || /\.(local|lan|internal|home|arpa)$/.test(host)) return true;
  if (net.isIP(host)) return isPrivateIp(host);
  return false;
}
const CF4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22']
  .map(c => { const [ip, bits] = c.split('/'); return [ip2n(ip), Number(bits)]; });
const CF6 = ['2400:cb00', '2606:4700', '2803:f800', '2405:b500', '2405:8100', '2a06:98c', '2c0f:f248'];
function ip2n(ip) { return ip.split('.').reduce((a, x) => (a * 256) + Number(x), 0); }
function isCloudflare(ip) {
  if (net.isIPv4(ip)) { const n = ip2n(ip); return CF4.some(([b, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(b / 2 ** (32 - bits))); }
  const l = ip.toLowerCase(); return CF6.some(p => l.startsWith(p));
}

// ---------------- address selection ----------------
const good = new Map(); // host -> {ip, exp}
const dnsCache = new Map(); // host -> {list, exp}
// DNS-over-HTTPS fallback (AliDNS JSON API by IP, no DNS needed) when the system resolver fails/is poisoned
async function dohLookup(host) {
  for (const srv of (process.env.DOH_SERVERS || '223.5.5.5,223.6.6.6').split(',')) {
    try {
      const res = await request(new URL(`https://${srv.trim()}/resolve?name=${encodeURIComponent(host)}&type=1`), { timeout: 3000, noProxy: true });
      const chunks = []; for await (const c of res) chunks.push(c);
      const j = JSON.parse(Buffer.concat(chunks).toString());
      const ips = (j.Answer || []).filter(a => a.type === 1 && net.isIPv4(a.data)).map(a => a.data);
      if (ips.length) return ips;
      if (j.Status === 3) return [];
    } catch {}
  }
  return [];
}
function lookupAll(host) {
  const c = dnsCache.get(host);
  if (c && c.exp > Date.now()) return Promise.resolve(c.list);
  return new Promise((res, rej) => dns.lookup(host, { all: true }, async (err, addrs) => {
    if (err && /ENOTFOUND|EAI_AGAIN|ESERVFAIL/.test(err.code || '') && process.env.DOH_FALLBACK !== '0') {
      const ips = await dohLookup(host).catch(() => []);
      if (ips.length) { dnsCache.set(host, { list: ips, exp: Date.now() + 5 * 60e3 }); return res(ips); }
    }
    if (err) { if (c) return res(c.list); return rej(Object.assign(new Error(err.code || err.message), { code: err.code })); }
    const list = addrs.map(a => a.address);
    dnsCache.set(host, { list, exp: Date.now() + 5 * 60e3 });
    if (dnsCache.size > 500) dnsCache.delete(dnsCache.keys().next().value);
    res(list);
  }));
}
async function candidates(host, rotate = 0) {
  if (net.isIP(host)) return [host, host];
  const list = await lookupAll(host);
  const v4 = list.filter(x => net.isIPv4(x)), v6 = list.filter(x => net.isIPv6(x));
  // interleave families, IPv4 first (IPv6 is often half-broken on home routers)
  let out = []; for (let i = 0; i < Math.max(v4.length, v6.length); i++) { if (v4[i]) out.push(v4[i]); if (v6[i]) out.push(v6[i]); }
  const g = good.get(host);
  if (g && g.exp > Date.now()) out = [g.ip, ...out.filter(x => x !== g.ip)];
  if (cfg.cfIps.length && out.some(isCloudflare)) {
    const extra = cfg.cfIps.filter(x => !out.includes(x)).sort(() => Math.random() - 0.5).slice(0, 3);
    out = [...out.slice(0, 2), ...extra, ...out.slice(2)];
  }
  if (out.length === 1) out.push(out[0]); // one quick retry on the same address
  if (rotate && out.length > 1) { const r = rotate % out.length; out = out.slice(r).concat(out.slice(0, r)); }
  return out.slice(0, 6);
}

// Staggered connect race: start attempt i, start the next one if it hasn't connected after STAGGER ms
// (or immediately when it fails). First connected socket wins; the rest are destroyed.
function raceConnect(addrs, port, deadline) {
  return new Promise((resolve, reject) => {
    let idx = 0, pending = 0, done = false, lastErr = null, timer = null;
    const socks = new Set();
    const finish = (err, s, ip) => {
      if (done) return; done = true; clearTimeout(timer);
      for (const x of socks) if (x !== s) x.destroy();
      err ? reject(err) : resolve({ socket: s, ip });
    };
    const next = () => {
      clearTimeout(timer);
      if (done) return;
      if (idx >= addrs.length || Date.now() > deadline) { if (!pending) finish(lastErr || new Error('ETIMEDOUT')); return; }
      const ip = addrs[idx++]; pending++;
      const s = net.connect({ host: ip, port, noDelay: true });
      socks.add(s);
      const to = setTimeout(() => { s.destroy(); fail(new Error('ETIMEDOUT')); }, Math.min(CONNECT_TIMEOUT, Math.max(500, deadline - Date.now())));
      let settled = false;
      const fail = e => { if (settled) return; settled = true; clearTimeout(to); pending--; socks.delete(s); lastErr = e; next(); };
      s.once('connect', () => { if (settled) return; settled = true; clearTimeout(to); pending--; s.removeAllListeners('error'); finish(null, s, ip); });
      s.once('error', e => { s.destroy(); fail(Object.assign(new Error(e.code || e.message), { code: e.code })); });
      if (idx < addrs.length) timer = setTimeout(next, STAGGER);
    };
    next();
  });
}

function tlsWrap(socket, servername, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = tls.connect({ socket, servername: net.isIP(servername) ? undefined : servername, rejectUnauthorized: false, ALPNProtocols: ['http/1.1'] });
    const to = setTimeout(() => { t.destroy(); reject(new Error('TLS timeout')); }, timeoutMs);
    t.once('secureConnect', () => { clearTimeout(to); t.removeAllListeners('error'); resolve(t); });
    t.once('error', e => { clearTimeout(to); t.destroy(); reject(e); });
  });
}

function proxyConnect(px, host, port, deadline) {
  return raceConnect([px.host], px.port, Math.min(deadline, Date.now() + 2500)).catch(e => { e.proxyDown = true; throw e; }).then(({ socket }) => new Promise((resolve, reject) => {
    const tgt = net.isIPv6(host) ? `[${host}]:${port}` : `${host}:${port}`;
    socket.write(`CONNECT ${tgt} HTTP/1.1\r\nHost: ${tgt}\r\n${px.auth ? 'Proxy-Authorization: Basic ' + px.auth + '\r\n' : ''}\r\n`);
    let buf = Buffer.alloc(0);
    const to = setTimeout(() => { socket.destroy(); reject(new Error('proxy CONNECT timeout')); }, Math.max(1000, deadline - Date.now()));
    const onData = d => {
      buf = Buffer.concat([buf, d]);
      const i = buf.indexOf('\r\n\r\n'); if (i < 0) { if (buf.length > 8192) { socket.destroy(); reject(new Error('bad proxy reply')); } return; }
      clearTimeout(to); socket.removeListener('data', onData); socket.removeAllListeners('error');
      const st = /^HTTP\/1\.\d (\d+)/.exec(buf.slice(0, i).toString('latin1'));
      if (!st || st[1] !== '200') { socket.destroy(); return reject(new Error('proxy CONNECT ' + (st ? st[1] : '?'))); }
      if (buf.length > i + 4) socket.unshift(buf.slice(i + 4));
      resolve(socket);
    };
    socket.on('data', onData);
    socket.once('error', e => { clearTimeout(to); reject(e); });
  }));
}

const stats = { direct: 0, proxy: 0, proxyFallback: 0, retries: 0 };
/**
 * Open a socket ready for an HTTP/1.1 request to url (TLS already done for https).
 * returns {socket, viaProxyHttp:bool} — viaProxyHttp means "send absolute-URI request to the proxy".
 */
async function openSocket(u, { deadline, noProxy, rotate, ctl }) {
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const isTls = u.protocol === 'https:';
  const port = Number(u.port || (isTls ? 443 : 80));
  const px = !noProxy && !isInternalHost(host) ? activeProxy() : null;
  if (px) {
    try {
      // CONNECT tunnel for both http and https (more proxies support it than absolute-URI forwarding)
      const raw = await proxyConnect(px, host, port, deadline);
      stats.proxy++;
      if (!isTls) return { socket: raw, viaProxyHttp: false };
      return { socket: await tlsWrap(raw, host, Math.max(1000, deadline - Date.now())), viaProxyHttp: false };
    } catch (e) {
      // only a proxy we cannot reach at all is bypassed (60s); target-side failures behind the proxy are just errors
      if (e.proxyDown) { proxyDownUntil = Date.now() + 60e3; stats.proxyFallback++; }
      else throw e;
    }
  }
  const addrs = await candidates(host, rotate);
  const { socket, ip } = await raceConnect(addrs, port, deadline);
  if (ctl && ctl.cancelled) { socket.destroy(); throw new Error('cancelled'); }
  if (ctl) ctl.sock = socket;
  if (!net.isIP(host)) good.set(host, { ip, exp: Date.now() + 30 * 60e3 });
  if (good.size > 500) good.delete(good.keys().next().value);
  stats.direct++;
  if (!isTls) return { socket, viaProxyHttp: false };
  try { return { socket: await tlsWrap(socket, host, Math.min(5000, Math.max(1000, deadline - Date.now()))), viaProxyHttp: false }; }
  catch (e) { good.delete(host); throw e; }
}

/**
 * Single request (no redirect following). Resolves with the IncomingMessage once headers arrive.
 * opts: {method, headers, body, timeout(ms, whole request until headers), noProxy}
 */
async function request(url, opts = {}) {
  const u = typeof url === 'string' ? new URL(url) : url;
  const total = opts.timeout || 10000;
  const t0 = Date.now();
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const deadline = t0 + total;
    if (attempt && deadline - Date.now() < 1500) break;
    let sock;
    try {
      sock = await openSocket(u, { deadline, noProxy: opts.noProxy, rotate: (opts.rotate || 0) + attempt, ctl: opts.ctl });
      if (opts.ctl && opts.ctl.cancelled) throw new Error('cancelled');
      return await sendOn(sock, u, opts, deadline);
    } catch (e) {
      lastErr = e;
      if (sock && sock.socket) sock.socket.destroy();
      // only retry failures that happened before any response (connect/reset); not on overall timeouts
      if (e.responded || (opts.ctl && opts.ctl.cancelled) || !/ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|TLS|socket hang up|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH/.test(e.code || e.message)) break;
      if (attempt === 0) stats.retries++;
    }
  }
  throw lastErr;
}

function sendOn({ socket, viaProxyHttp, px }, u, opts, deadline) {
  return new Promise((resolve, reject) => {
    const headers = Object.assign({}, opts.headers || {});
    const lower = Object.keys(headers).map(k => k.toLowerCase());
    if (!lower.includes('host')) headers.Host = u.host;
    if (!lower.includes('accept')) headers.Accept = '*/*';
    if (opts.acceptEncoding !== false && !lower.includes('accept-encoding')) headers['Accept-Encoding'] = 'gzip, deflate, br';
    headers.Connection = 'close';
    if (viaProxyHttp && px && px.auth) headers['Proxy-Authorization'] = 'Basic ' + px.auth;
    let body = opts.body;
    if (body != null && typeof body !== 'string' && !Buffer.isBuffer(body)) body = String(body);
    const req = http.request({
      method: opts.method || 'GET', path: viaProxyHttp ? u.href : (u.pathname + u.search), headers,
      createConnection: () => socket, setHost: false,
    });
    const ms = Math.max(500, deadline - Date.now());
    const to = setTimeout(() => { const e = new Error('timeout'); e.responded = true; req.destroy(e); }, ms);
    if (opts.ctl) opts.ctl.req = req;
    req.once('response', res => { clearTimeout(to); if (opts.ctl) opts.ctl.res = res; resolve(res); });
    req.on('error', e => { clearTimeout(to); reject(Object.assign(new Error(e.code || e.message), { code: e.code, responded: e.responded })); });
    if (body != null && body !== '') req.end(body); else req.end();
  });
}

// would a request to this host go through the upstream proxy right now?
function viaProxy(host) { return !isInternalHost(host) && !!activeProxy(); }
function cancel(ctl) { if (!ctl || ctl.cancelled) return; ctl.cancelled = true; for (const k of ['res', 'req', 'sock']) try { ctl[k] && ctl[k].destroy(); } catch {} }
module.exports = { request, viaProxy, cancel, configure, detectProxy, activeProxy, isInternalHost, isCloudflare, stats, proxySpec, _cfg: cfg };
