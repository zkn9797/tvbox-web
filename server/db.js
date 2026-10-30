'use strict';
// SQLite storage via Node's built-in node:sqlite (no native deps -> works on amd64 & arm64).
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'tvbox.db'));
db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, pw TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0, created INTEGER);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER, expires INTEGER);
CREATE TABLE IF NOT EXISTS configs(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, url TEXT, content TEXT,
  enabled INTEGER DEFAULT 1, sort INTEGER DEFAULT 0, created INTEGER);
CREATE TABLE IF NOT EXISTS history(user_id INTEGER, site TEXT, vod_id TEXT, vod_name TEXT, vod_pic TEXT,
  flag TEXT, ep_index INTEGER, ep_name TEXT, position REAL, duration REAL, updated INTEGER,
  PRIMARY KEY(user_id, site, vod_id));
CREATE INDEX IF NOT EXISTS history_u ON history(user_id, updated);
CREATE TABLE IF NOT EXISTS favorites(user_id INTEGER, site TEXT, vod_id TEXT, vod_name TEXT, vod_pic TEXT, remarks TEXT,
  created INTEGER, PRIMARY KEY(user_id, site, vod_id));
CREATE TABLE IF NOT EXISTS site_health(site TEXT PRIMARY KEY, ok INTEGER DEFAULT 0, fail INTEGER DEFAULT 0,
  consecutive_fail INTEGER DEFAULT 0, last_fail INTEGER DEFAULT 0, last_ok INTEGER DEFAULT 0, avg_ms REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS kv(ns TEXT, k TEXT, v TEXT, PRIMARY KEY(ns,k));
`);

const getSetting = k => { const r = db.prepare('SELECT v FROM settings WHERE k=?').get(k); return r ? r.v : null; };
const setSetting = (k, v) => db.prepare('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));

function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}
function checkPw(pw, stored) {
  try {
    const [, s, h] = stored.split('$');
    const calc = crypto.scryptSync(String(pw), Buffer.from(s, 'hex'), 32, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(calc, Buffer.from(h, 'hex'));
  } catch { return false; }
}

// First-boot initialisation: hidden admin path + admin account with random password.
function bootstrap() {
  // admin page path: ADMIN_PATH env > saved setting > "admin" (the page is password protected)
  let adminPath = (process.env.ADMIN_PATH || getSetting('admin_path') || 'admin').replace(/^\/+|\/+$/g, '');
  if (getSetting('admin_path') !== adminPath) {
    setSetting('admin_path', adminPath);
  }
  const admin = db.prepare('SELECT id FROM users WHERE is_admin=1 LIMIT 1').get();
  let initialPw = null;
  if (!admin) {
    initialPw = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
    db.prepare('INSERT INTO users(username,pw,is_admin,created) VALUES(?,?,1,?)').run('admin', hashPw(initialPw), Date.now());
  }
  db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
  return { adminPath, initialPw };
}

module.exports = { db, DATA_DIR, getSetting, setSetting, hashPw, checkPw, bootstrap };
