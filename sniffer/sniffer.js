'use strict';
// TVBox Web tier-2 sniffer: headless Chromium that loads a page and reports the first media URL it requests
// (TVBox "webview sniff" semantics). OFF by default; run on demand or on a stronger box.
// POST /sniff {url, ua?, referer?, headers?, timeout?, regex?, collect?:"media"|"all"} -> {url, headers, cookies, requests, ms}
const http = require('node:http');
const { chromium } = require('playwright-core');

const PORT = Number(process.env.PORT || 9980);
const IDLE_MS = Number(process.env.IDLE_CLOSE_S || 120) * 1000;
const MAX_PAGES = Number(process.env.MAX_PAGES || 2);
const TOKEN = process.env.SNIFFER_TOKEN || '';
const EXE = process.env.CHROMIUM_PATH || undefined;
// same idea as TVBox's isVideoFormat: media extensions / mime hints, excluding ads & thumbnails
const MEDIA_RE = /\.(m3u8|mp4|flv|m4a|mp3|mkv|mpd)(\?|#|$)|\/m3u8\?|mime=video|type=m3u8/i;
const BAD_RE = /(\.(js|css|png|jpe?g|gif|webp|ico|svg|woff2?)(\?|$))|google|baidu\.com\/|cnzz|umeng|51\.la|doubleclick|ad[sx]?\.|\/ads?\//i;

let browser = null, lastUse = 0, active = 0;
const cache = new Map(); // url -> {exp, res}
const cookieJar = new Map(); // host -> cookies[]

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--mute-audio', '--no-zygote', '--disable-extensions',
      '--disable-background-networking', '--js-flags=--max-old-space-size=96', '--renderer-process-limit=2', '--blink-settings=imagesEnabled=false'],
  });
  return browser;
}
setInterval(async () => { if (browser && !active && Date.now() - lastUse > IDLE_MS) { const b = browser; browser = null; try { await b.close(); } catch {} } }, 15000).unref();

async function sniff(o) {
  const key = JSON.stringify([o.url, o.regex || '', o.collect || '']);
  const c = cache.get(key); if (c && c.exp > Date.now()) return { ...c.res, cached: true };
  if (active >= MAX_PAGES) throw new Error('busy');
  active++; lastUse = Date.now();
  const t0 = Date.now();
  const re = o.regex ? new RegExp(o.regex, 'i') : MEDIA_RE;
  const host = new URL(o.url).host;
  const b = await getBrowser();
  const ctx = await b.newContext({ userAgent: o.ua || 'Mozilla/5.0 (Linux; Android 11; MiBOX4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0 Mobile Safari/537.36',
    extraHTTPHeaders: Object.assign({}, o.headers || {}, o.referer ? { Referer: o.referer } : {}), ignoreHTTPSErrors: true, javaScriptEnabled: true });
  if (cookieJar.has(host)) await ctx.addCookies(cookieJar.get(host)).catch(() => {});
  const page = await ctx.newPage();
  const requests = []; let found = null;
  let done; const hit = new Promise(r => { done = r; });
  await page.route('**/*', route => {
    const rq = route.request(); const u = rq.url(); const t = rq.resourceType();
    if (o.collect === 'all') requests.push(u);
    if (!found && re.test(u) && !BAD_RE.test(u)) {
      found = { url: u, headers: rq.headers() }; if (o.collect !== 'all') requests.push(u);
      done(); return route.abort();           // never download the media itself
    }
    if (['image', 'font', 'media', 'stylesheet'].includes(t)) return route.abort();
    return route.continue();
  });
  try {
    await Promise.race([
      page.goto(o.url, { waitUntil: 'domcontentloaded', timeout: o.timeout || 15000 }).then(() => (o.collect === 'all' ? page.waitForTimeout(3000) : hit)),
      hit, new Promise(r => setTimeout(r, o.timeout || 15000)),
    ]);
    if (!found && o.collect !== 'all') {
      // some players start on click
      await page.mouse.click(200, 200).catch(() => {});
      await Promise.race([hit, new Promise(r => setTimeout(r, 3000))]);
    }
    const cookies = await ctx.cookies().catch(() => []);
    if (cookies.length) cookieJar.set(host, cookies);
    const html = o.collect === 'all' ? await page.content().catch(() => '') : undefined;
    const hdr = {};
    if (found) for (const k of ['referer', 'user-agent', 'cookie', 'origin']) if (found.headers[k]) hdr[k.replace(/(^|-)\w/g, s => s.toUpperCase())] = found.headers[k];
    const res = { url: found ? found.url : null, headers: hdr, cookies: cookies.map(c => `${c.name}=${c.value}`).join('; '), requests, html, ms: Date.now() - t0 };
    if (found) cache.set(key, { exp: Date.now() + 10 * 60e3, res });
    return res;
  } finally {
    await ctx.close().catch(() => {});
    active--; lastUse = Date.now();
  }
}

http.createServer(async (req, res) => {
  const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.url === '/health') return send(200, { ok: true, browser: !!browser, active, rss_mb: Math.round(process.memoryUsage().rss / 1048576) });
  if (TOKEN && req.headers['x-sniffer-token'] !== TOKEN) return send(403, { error: 'forbidden' });
  if (req.method !== 'POST' || !req.url.startsWith('/sniff')) return send(404, { error: 'not found' });
  let body = ''; for await (const c of req) body += c;
  try { const o = JSON.parse(body || '{}'); if (!/^https?:/.test(o.url || '')) return send(400, { error: 'bad url' }); send(200, await sniff(o)); }
  catch (e) { send(200, { error: String(e.message || e) }); }
}).listen(PORT, () => console.log('sniffer listening on :' + PORT));
