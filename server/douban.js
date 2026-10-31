'use strict';
// Douban recommendations for the TVBox-style home page (m.douban.com rexxar subject collections).
const net = require('./net');

// whitelisted collections; the front-end asks by id
const COLL = new Set(['movie_showing', 'movie_hot_gaia', 'movie_latest', 'movie_top250', 'movie_real_time_hotest',
  'tv_hot', 'tv_domestic', 'tv_american', 'tv_korean', 'tv_japanese', 'tv_animation',
  'show_hot', 'show_domestic', 'show_foreign', 'tv_variety_show']);
const cache = new Map(); // key -> {t, v}
const TTL = 30 * 60e3;

async function getText(url, timeout = 10000) {
  let res;
  for (let hop = 0; hop < 3; hop++) {
    res = await net.request(url, { timeout, headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      Referer: 'https://m.douban.com/movie/', Accept: 'application/json' } });
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); url = new URL(res.headers.location, url).href; continue; }
    break;
  }
  const chunks = [];
  await new Promise((ok, bad) => { res.on('data', c => chunks.push(c)); res.on('end', ok); res.on('error', bad); });
  if (res.statusCode !== 200) throw new Error('douban HTTP ' + res.statusCode);
  let buf = Buffer.concat(chunks);
  const enc = String(res.headers['content-encoding'] || '');
  const zlib = require('node:zlib');
  if (/gzip/.test(enc) || (buf[0] === 0x1f && buf[1] === 0x8b)) buf = zlib.gunzipSync(buf);
  else if (/br/.test(enc)) buf = zlib.brotliDecompressSync(buf);
  else if (/deflate/.test(enc)) buf = zlib.inflateSync(buf);
  return buf.toString('utf8');
}

function mapItem(x) {
  const sub = String(x.card_subtitle || x.info || '');
  const year = String(x.year || (sub.match(/^(\d{4})/) || [])[1] || '');
  return {
    // doubanio answers 418 without a douban Referer: let the router fetch it (/img honours @Referer=)
    id: String(x.id || ''), title: x.title || '', pic: ((x.cover && x.cover.url) || (x.pic && (x.pic.normal || x.pic.large)) || '').replace(/^(https?:\/\/\S+)$/, '$1@Referer=https://movie.douban.com/'),
    rating: x.rating && x.rating.value ? Number(x.rating.value).toFixed(1) : '', year, type: x.type || '',
    sub: sub.split(' / ').slice(year ? 1 : 0, 3).join(' / '),
  };
}

async function collection(id, start = 0, count = 30) {
  if (!COLL.has(id)) throw new Error('unknown collection');
  start = Math.max(0, Number(start) || 0); count = Math.min(50, Math.max(1, Number(count) || 30));
  const k = `${id}|${start}|${count}`, c = cache.get(k);
  if (c && Date.now() - c.t < TTL) return c.v;
  try {
    const j = JSON.parse(await getText(`https://m.douban.com/rexxar/api/v2/subject_collection/${id}/items?start=${start}&count=${count}`));
    const v = { total: j.total || 0, list: (j.subject_collection_items || []).filter(x => x.title && x.type !== 'book').map(mapItem) };
    cache.set(k, { t: Date.now(), v });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return v;
  } catch (e) {
    if (c) return Object.assign({ stale: true }, c.v); // serve the last good copy when douban is unreachable
    throw e;
  }
}

module.exports = { collection };
