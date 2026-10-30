'use strict';
// Main-thread side of the JS spider runtime: small lazily-started worker pool,
// sync-fetch bridge, per-call timeouts, idle shutdown.
const { Worker, MessageChannel } = require('node:worker_threads');
const path = require('node:path');
const { db } = require('../db');
const { smartFetch: httpFetch, TTLCache } = require('../util');

const POOL = Math.max(1, Number(process.env.JS_WORKERS || 2));
const IDLE_MS = Number(process.env.JS_IDLE_MS || 5 * 60 * 1000);
const srcCache = new TTLCache(60);
const workers = new Array(POOL).fill(null);
let callSeq = 0;

function loadLocal() {
  const o = {};
  for (const r of db.prepare("SELECT k,v FROM kv WHERE ns='jslocal'").all()) o[r.k] = r.v;
  return o;
}

async function doFetch(p) {
  try {
    if (p.cache) { const c = srcCache.get(p.url); if (c) return { id: p.id, ...c }; }
    const o = p.opts || {};
    const r = await httpFetch(p.url, { method: o.method, headers: o.headers, body: o.body, timeout: o.timeout, encoding: o.encoding,
      raw: !!o.buffer, redirect: !(o.redirect === 0 || o.redirect === false) });
    let content = r.text;
    if (o.buffer == 2) content = r.buf.toString('base64');
    else if (o.buffer == 1) content = Array.from(r.buf);
    const res = { status: r.status, headers: r.headers, content };
    if (p.cache && r.status < 400) srcCache.set(p.url, res, 30 * 60 * 1000);
    return { id: p.id, ...res };
  } catch (e) {
    return { id: p.id, error: String(e.message || e) };
  }
}

function spawn(i) {
  const sab = new SharedArrayBuffer(4);
  const flag = new Int32Array(sab);
  const { port1, port2 } = new MessageChannel();
  const w = new Worker(path.join(__dirname, 'worker.js'), {
    workerData: { sab, port: port2, assetsDir: path.join(__dirname, '..', '..', 'assets'), local: loadLocal() },
    transferList: [port2],
    resourceLimits: { maxOldGenerationSizeMb: Number(process.env.JS_HEAP_MB || 64) },
  });
  const st = { w, pending: new Map(), lastUse: Date.now(), timer: null };
  port1.on('message', async (p) => {
    const res = await doFetch(p);
    port1.postMessage(res);
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
  });
  w.on('message', (m) => {
    if (m.type === 'result') {
      const p = st.pending.get(m.id);
      if (p) { st.pending.delete(m.id); clearTimeout(p.t); m.error ? p.rej(new Error(m.error)) : p.res(m.result); }
    } else if (m.type === 'local') {
      if (m.v === null) db.prepare("DELETE FROM kv WHERE ns='jslocal' AND k=?").run(m.k);
      else db.prepare("INSERT INTO kv(ns,k,v) VALUES('jslocal',?,?) ON CONFLICT(ns,k) DO UPDATE SET v=excluded.v").run(m.k, m.v);
    }
  });
  const fail = (err) => {
    for (const p of st.pending.values()) { clearTimeout(p.t); p.rej(err); }
    st.pending.clear();
    if (workers[i] === st) workers[i] = null;
    port1.close();
  };
  w.on('error', fail);
  w.on('exit', () => fail(new Error('spider worker exited')));
  st.timer = setInterval(() => {
    if (!st.pending.size && Date.now() - st.lastUse > IDLE_MS) { clearInterval(st.timer); w.terminate(); }
  }, 30000);
  st.timer.unref();
  workers[i] = st;
  return st;
}

function pick(siteId) {
  let h = 0; for (const c of siteId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % POOL;
}

function call(siteId, site, method, args, timeoutMs = 15000) {
  const i = pick(siteId);
  const st = workers[i] || spawn(i);
  st.lastUse = Date.now();
  const id = ++callSeq;
  return new Promise((res, rej) => {
    const t = setTimeout(() => {
      st.pending.delete(id);
      rej(new Error('spider timeout'));
      // a spider stuck in sync code blocks the whole worker: recycle it
      if (st.pending.size === 0) { st.w.terminate(); }
    }, timeoutMs);
    st.pending.set(id, { res, rej, t });
    st.w.postMessage({ type: 'call', id, siteId, site, method, args });
  });
}

function stats() { return workers.map((w, i) => ({ i, alive: !!w, pending: w ? w.pending.size : 0 })); }

module.exports = { call, stats };
