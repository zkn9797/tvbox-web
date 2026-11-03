/* TVBox Web front-end. Plain ES2017 (Safari 11+/X5 compatible), no build step. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var app = $('#app');
  var state = { user: null, repo: localStorage.getItem('repo') || '', repos: [], sites: [], siteMap: {} };
  var UA = navigator.userAgent;
  var IS_IOS = /iPhone|iPad|iPod/i.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);

  // ---------------- utils ----------------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function qs(o) { return Object.keys(o).filter(function (k) { return o[k] !== undefined && o[k] !== null && o[k] !== ''; }).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); }
  function toast(msg, ms) {
    var d = document.createElement('div'); d.textContent = msg; $('#toast').appendChild(d);
    setTimeout(function () { d.remove(); }, ms || 3000);
  }
  function api(path, opt) {
    opt = opt || {};
    var init = { method: opt.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opt.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opt.body); }
    var ctl = window.AbortController ? new AbortController() : null;
    if (ctl) { init.signal = ctl.signal; setTimeout(function () { ctl.abort(); }, opt.timeout || 30000); }
    return fetch(path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && j.login) { showLogin(); throw new Error('未登录'); }
        if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status));
        return j;
      });
    }, function (e) { throw new Error(e && e.name === 'AbortError' ? '请求超时' : (e.message || '网络错误')); });
  }
  // list loads: one automatic retry (not for login / jar warm-up), then the caller shows a 重试 button
  function apiRetry(path, opt) {
    return api(path, opt).catch(function (e) {
      if (/未登录|^warming|需要管理员/.test(e.message)) throw e;
      return new Promise(function (r) { setTimeout(r, 800); }).then(function () { return api(path + (path.indexOf('?') >= 0 ? '&' : '?') + 'retry=1', opt); });
    });
  }
  function failHtml(msg) { return '<div class="empty">加载失败：' + esc(msg) + '<br><button class="ghost retry" style="margin-top:10px">重试</button></div>'; }
  function normTitle(s) {
    return String(s || '').toLowerCase().replace(/[\s·・:：,，.。!！?？'"“”‘’()（）\[\]【】《》<>\-_—|\/\\]+/g, '').replace(/(国语|粤语|中字|高清|蓝光|hd|4k|1080p|完结)$/g, '');
  }
  function fmtTime(s) { s = Math.floor(s || 0); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' : '') + (m < 10 && h ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x; }
  function parseHash() {
    var h = location.hash.replace(/^#/, '') || '/home';
    var i = h.indexOf('?'); var path = i >= 0 ? h.slice(0, i) : h; var q = {};
    if (i >= 0) h.slice(i + 1).split('&').forEach(function (p) { var kv = p.split('='); if (kv[0]) q[decodeURIComponent(kv[0])] = decodeURIComponent(kv.slice(1).join('=') || ''); });
    return { path: path, q: q };
  }
  function go(path, q) { location.hash = '#' + path + (q ? '?' + qs(q) : ''); }
  // TVBox pictures may carry "@Referer=...@User-Agent=..." (hotlink protection): fetch those through the router
  // &v= busts poster failures that older builds let the browser cache for a day.
  var IMG_V = '3';
  function picUrl(src) { src = String(src || '').trim(); if (!src) return ''; if (/^\/\//.test(src)) src = 'https:' + src; return /@(Referer|User-Agent|Cookie|Origin)=/i.test(src) ? '/img?v=' + IMG_V + '&u=' + encodeURIComponent(src) : src; }
  // poster error handling: direct URL failed -> retry through the router (/img); /img failed -> one delayed retry; then a placeholder.
  window.__tvbImgErr = function (el) {
    var o = el.getAttribute('data-o') || '', n = Number(el.getAttribute('data-n') || 0);
    if (n >= 1) el.classList.add('ld');
    el.setAttribute('data-n', n + 1);
    if (n === 0 && o.indexOf('/img?') !== 0) { el.src = '/img?v=' + IMG_V + '&u=' + encodeURIComponent(o); return; }
    if (n <= 1) { setTimeout(function () { var b = el.getAttribute('src') || ''; el.src = b.replace(/&r=\d+/, '') + '&r=' + Date.now(); }, 1200 + Math.random() * 1500); return; }
    el.style.visibility = 'hidden';
  };
  function img(src) { var o = String(src || '').trim(); if (/^\/\//.test(o)) o = 'https:' + o; src = picUrl(o); return src ? '<img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="' + esc(src) + '" onload="this.classList.add(\'ld\')" onerror="__tvbImgErr(this)" data-o="' + esc(/@(Referer|User-Agent|Cookie|Origin)=/i.test(o) ? src : o) + '">' : ''; }
  function vodCard(v, site, siteName) {
    return '<div class="vod" tabindex="0" data-site="' + esc(site) + '" data-id="' + esc(v.vod_id) + '" data-name="' + esc(v.vod_name) + '" data-pic="' + esc(v.vod_pic) + '">' +
      '<div class="pic">' + img(v.vod_pic) + (siteName ? '<span class="site">' + esc(siteName) + '</span>' : '') + (v.vod_remarks ? '<span class="rm">' + esc(v.vod_remarks) + '</span>' : '') + '</div>' +
      '<div class="nm">' + esc(v.vod_name) + '</div></div>';
  }
  function bindCards(root, repo) {
    root.addEventListener('click', function (e) {
      var c = e.target.closest ? e.target.closest('.vod') : null;
      if (!c) return;
      if (c.getAttribute('data-id') === 'no_data') return;
      go('/detail', { repo: c.getAttribute('data-repo') || repo || state.repo, site: c.getAttribute('data-site'), id: c.getAttribute('data-id'), name: c.getAttribute('data-name'), pic: c.getAttribute('data-pic') });
    });
  }

  // ---------------- auth ----------------
  function showLogin() { $('#loginView').classList.remove('hidden'); }
  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    api('/api/login', { method: 'POST', body: { username: f.username.value, password: f.password.value } }).then(function (j) {
      state.user = j.user; $('#loginView').classList.add('hidden'); $('#loginErr').textContent = ''; init();
    }).catch(function (er) { $('#loginErr').textContent = er.message; });
  });
  $('#menuBtn').onclick = function () { $('#menu').classList.toggle('hidden'); };
  document.addEventListener('click', function (e) { if (!e.target.closest('#menu') && e.target.id !== 'menuBtn') $('#menu').classList.add('hidden'); });
  window.addEventListener('hashchange', function () { $('#menu').classList.add('hidden'); });
  $('#logoutBtn').onclick = function () { api('/api/logout', { method: 'POST' }).then(function () { location.reload(); }); };
  $('#pwBtn').onclick = function () { $('#pwView').classList.remove('hidden'); };
  $('#pwView [data-close]').onclick = function () { $('#pwView').classList.add('hidden'); };
  $('#pwForm').addEventListener('submit', function (e) {
    e.preventDefault(); var f = e.target;
    api('/api/password', { method: 'POST', body: { old: f.old.value, password: f.password.value } }).then(function () {
      toast('密码已修改'); $('#pwView').classList.add('hidden'); f.reset();
    }).catch(function (er) { $('#pwErr').textContent = er.message; });
  });

  // ---------------- repos / sites ----------------
  function loadRepos() {
    return api('/api/repos').then(function (j) {
      state.repos = j.repos;
      if (!state.repos.some(function (r) { return r.id === state.repo; })) state.repo = state.repos.length ? state.repos[0].id : '';
      $('#repoSel').innerHTML = state.repos.map(function (r) { return '<option value="' + esc(r.id) + '"' + (r.id === state.repo ? ' selected' : '') + '>' + esc(r.name) + (r.error ? ' (失败)' : '') + '</option>'; }).join('');
      return loadSites();
    });
  }
  function loadSites() {
    if (!state.repo) { state.sites = []; return Promise.resolve(); }
    return api('/api/sites?repo=' + encodeURIComponent(state.repo)).then(function (j) {
      state.sites = j.sites; state.siteMap = {};
      j.sites.forEach(function (s) { state.siteMap[s.key] = s; });
    });
  }
  $('#repoSel').onchange = function () {
    state.repo = this.value; localStorage.setItem('repo', state.repo);
    loadSites().then(function () { var p = parseHash().path; if (p === '/browse') go('/browse', { t: Date.now() }); else toast('首选源：' + (state.repos.filter(function (r) { return r.id === state.repo; })[0] || {}).name); });
  };
  $('#searchForm').addEventListener('submit', function (e) {
    e.preventDefault(); var wd = $('#searchInput').value.trim(); if (wd) go('/search', { wd: wd, t: Date.now() });
    $('#searchInput').blur();
  });
  function siteName(k) { var s = state.siteMap[k]; return s ? s.name : k; }
  // ---- resolution preference by device ----
  var DEV = (function () {
    var sw = screen.width || innerWidth, sh = screen.height || innerHeight, dpr = window.devicePixelRatio || 1;
    var mob = (window.matchMedia && matchMedia('(pointer: coarse)').matches && Math.min(sw, sh) <= 900) || /Android|iPhone|iPod/i.test(UA);
    return { mobile: mob, big: !mob && Math.max(sw, sh) * dpr >= 3000 };
  })();
  function resQ(w, h) { return h ? Math.round(Math.max(h, (w || 0) * 9 / 16)) : 0; }
  function resLabel(q) { return !q ? '' : q >= 1900 ? '4K' : q >= 1300 ? '2K' : q >= 980 ? '1080P' : q >= 680 ? '720P' : q >= 460 ? '480P' : '标清'; }
  function resCls(q) { return !q ? '' : q >= 1300 ? 'uhd' : q >= 980 ? 'fhd' : q >= 680 ? 'hd' : 'sd'; }
  // how well a resolution suits this device: desktop wants 1080P+ (4K only on big screens), phones want 720P–1080P (4K costs data/battery)
  function resFit(q) { if (!q) return 0; if (DEV.mobile) return q >= 1300 ? 8 : q >= 980 ? 30 : q >= 680 ? 24 : -15; return q >= 1900 ? (DEV.big ? 40 : 26) : q >= 1300 ? 32 : q >= 980 ? 30 : q >= 680 ? -5 : -20; }
  var RES_KEY = 'tvb_res';
  function resMap() { try { return JSON.parse(localStorage.getItem(RES_KEY) || '{}'); } catch (e) { return {}; } }
  function resGet(site, flag, exact) { var m = resMap(), x = m[site + '|' + flag] || (exact ? null : m[site + '|*']); return x && Date.now() - x.t < 30 * 864e5 ? x.q : 0; }
  function resSet(site, flag, q) {
    if (!q) return; var m = resMap(), now = Date.now(); m[site + '|' + flag] = { q: q, t: now }; m[site + '|*'] = { q: q, t: now };
    var ks = Object.keys(m); if (ks.length > 400) ks.sort(function (a, b) { return m[a].t - m[b].t; }).slice(0, ks.length - 400).forEach(function (k) { delete m[k]; });
    try { localStorage.setItem(RES_KEY, JSON.stringify(m)); } catch (e) { }
  }
  function kindLabel(s) { return s.supported ? '' : (s.kind === 'csp' ? ' [jar,未启用运行时]' : s.kind === 'py' ? ' [py,不支持]' : ' [不支持]'); }

  // ---------------- views ----------------
  var cleanup = null;
  function route() {
    if (cleanup) { try { cleanup(); } catch (e) { } cleanup = null; }
    document.body.classList.remove('has-hero');
    app.classList.remove('page-in'); void app.offsetWidth; app.classList.add('page-in');
    window.scrollTo(0, 0);
    var h = parseHash(); markNav();
    if (h.path === '/search') return viewSearch(h.q.wd);
    if (h.path === '/detail') return viewDetail(h.q);
    if (h.path === '/history') return viewHistory();
    if (h.path === '/fav') return viewFav();
    if (h.path === '/browse') return viewHome(h.q);
    if (h.path === '/cat') return viewCat(h.q);
    return viewTvHome();
  }
  function moveInd() {
    var nav = $('#topCats'); if (!nav) return; var ind = nav.querySelector('.ind');
    if (!ind) { ind = document.createElement('i'); ind.className = 'ind'; nav.appendChild(ind); }
    var a = nav.querySelector('a.on');
    if (!a) { ind.style.opacity = 0; return; }
    ind.style.opacity = 1; ind.style.width = a.offsetWidth + 'px'; ind.style.transform = 'translateX(' + a.offsetLeft + 'px)';
  }
  window.addEventListener('resize', function () { moveInd(); });
  function markNav() {
    var h = parseHash(), k = h.path === '/cat' ? (h.q.t || 'movie') : h.path.replace('/', '') || 'home';
    if (h.path === '/detail' || h.path === '/search') k = '';
    [].forEach.call(document.querySelectorAll('#topCats a,#navLinks a[data-k]'), function (a) { a.classList.toggle('on', a.getAttribute('data-k') === k); });
    moveInd();
  }

  // ---------------- TVBox-style home: douban recommendations ----------------
  var DB_CATS = {
    movie: { name: '电影', subs: [['movie_hot_gaia', '热门'], ['movie_showing', '院线'], ['movie_latest', '最新'], ['movie_top250', 'Top250']] },
    tv: { name: '剧集', subs: [['tv_hot', '热门'], ['tv_domestic', '国产剧'], ['tv_american', '欧美剧'], ['tv_korean', '韩剧'], ['tv_japanese', '日剧']] },
    show: { name: '综艺', subs: [['show_hot', '热门'], ['show_domestic', '国内'], ['show_foreign', '国外']] },
    anime: { name: '动漫', subs: [['tv_animation', '热门动画']] },
  };
  var HOME_ROWS = [['movie_showing', '正在热映', 'movie'], ['tv_hot', '热门剧集', 'tv'], ['movie_hot_gaia', '热门电影', 'movie'], ['show_hot', '热门综艺', 'show'], ['tv_animation', '热门动漫', 'anime']];
  function dbCard(d) {
    return '<div class="vod" tabindex="0" data-db="1" data-name="' + esc(d.title) + '" data-year="' + esc(d.year) + '" data-pic="' + esc(d.pic) + '">' +
      '<div class="pic">' + img(d.pic) + (d.rating ? '<span class="rt">' + esc(d.rating) + '</span>' : '') + (d.year ? '<span class="rm">' + esc(d.year) + '</span>' : '') + '</div>' +
      '<div class="nm">' + esc(d.title) + '</div><div class="sub">' + esc(d.sub || '') + '</div></div>';
  }
  function bindDb(root) {
    root.addEventListener('click', function (e) {
      var c = e.target.closest ? e.target.closest('.vod') : null; if (!c) return;
      [].forEach.call(document.querySelectorAll('.vt-poster'), function (x) { x.classList.remove('vt-poster'); });
      var pc = c.querySelector('.pic'); if (pc) pc.classList.add('vt-poster');
      if (c.getAttribute('data-db')) { go('/detail', { auto: 1, name: c.getAttribute('data-name'), year: c.getAttribute('data-year'), pic: c.getAttribute('data-pic') }); return; }
      if (c.getAttribute('data-hist')) histGo(c);
    });
  }
  function decodeEnt(t) { var d = document.createElement('textarea'); d.innerHTML = t; return d.value.replace(/\u00a0/g, ' '); }
  function bigPic(p) { return String(p || '').replace('/s_ratio_poster/', '/l_ratio_poster/'); }
  function heroHtml() {
    return '<section class="hero" id="hero"><div class="hero-bgs" id="heroBg"></div><div class="hero-shade"></div><div class="hero-in"><div class="hero-txt" id="heroTxt"></div><div class="hero-side"><div class="hero-q" id="heroQ"></div><div class="hero-poster" id="heroPoster"></div></div></div><div class="hero-dots" id="heroDots"></div></section>';
  }
  function initHero() {
    var hero = $('#hero'); if (!hero) return;
    var top = $('#top'); hero.style.marginTop = -(top.offsetHeight + 16) + 'px'; hero.style.paddingTop = top.offsetHeight + 'px';
    apiRetry('/api/douban?' + qs({ c: 'movie_showing', count: 12 }), { timeout: 20000 }).then(function (j) {
      var l = (j.list || []).filter(function (d) { return d.pic; }).sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); }).slice(0, 6);
      if (!l.length || !$('#hero')) return;
      var i = 0, timer = null;
      $('#heroDots').innerHTML = l.map(function (_, k) { return '<i data-k="' + k + '"></i>'; }).join('');
      $('#heroQ').innerHTML = l.map(function (d, k) { return '<div class="hq" data-k="' + k + '"><img src="' + esc(picUrl(d.pic)) + '" alt="" loading="lazy"><b>' + esc(d.title) + '</b></div>'; }).join('');
      $('#heroQ').onclick = function (e) { var x = e.target.closest('.hq'); if (x) { show(+x.getAttribute('data-k')); auto(); } };
      function show(k) {
        i = (k + l.length) % l.length; var d = l[i], u = picUrl(bigPic(d.pic));
        var bgs = $('#heroBg'), nb = document.createElement('div'); nb.className = 'hero-bg'; nb.style.backgroundImage = 'url("' + u.replace(/"/g, '%22') + '")';
        bgs.appendChild(nb); requestAnimationFrame(function () { nb.classList.add('on'); });
        while (bgs.children.length > 2) bgs.removeChild(bgs.firstChild);
        $('#heroPoster').innerHTML = '<img src="' + esc(u) + '" alt="">';
        $('#heroTxt').innerHTML = '<div class="hero-tag">正在热映 · TOP ' + (i + 1) + '</div><h2>' + esc(d.title) + '</h2>' +
          '<div class="hero-meta">' + (d.rating ? '<span class="star">★ ' + esc(d.rating) + '</span>' : '') + esc(d.info || d.sub || d.year) + '</div>' +
          '<div class="hero-btns"><button class="btn-play" id="heroPlay">▶ 立即播放</button><a class="btn-glass" href="#/cat?t=movie&c=movie_showing">更多热映</a></div>';
        $('#heroPlay').onclick = function () { go('/detail', { auto: 1, name: d.title, year: d.year, pic: d.pic }); };
        [].forEach.call($('#heroDots').children, function (x, k) { x.classList.toggle('on', k === i); });
        [].forEach.call($('#heroQ').children, function (x, k) { x.classList.toggle('on', k === i); });
        hero.classList.remove('swap'); void hero.offsetWidth; hero.classList.add('swap');
      }
      function auto() { clearInterval(timer); timer = setInterval(function () { if (!$('#hero')) return clearInterval(timer); show(i + 1); }, 7000); }
      $('#heroDots').onclick = function (e) { var k = e.target.getAttribute('data-k'); if (k != null) { show(+k); auto(); } };
      hero.onmouseenter = function () { clearInterval(timer); hero.classList.add('hold'); };
      hero.onmouseleave = function () { hero.classList.remove('hold'); hero.style.setProperty('--rx', '0deg'); hero.style.setProperty('--ry', '0deg'); show(i); auto(); };
      hero.onmousemove = function (e) { var r = hero.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; hero.style.setProperty('--rx', (-y * 6).toFixed(2) + 'deg'); hero.style.setProperty('--ry', (x * 10 - 8).toFixed(2) + 'deg'); hero.style.setProperty('--px', (x * -24).toFixed(1) + 'px'); hero.style.setProperty('--py', (y * -16).toFixed(1) + 'px'); };
      show(0); auto();
      var oc = cleanup; cleanup = function () { clearInterval(timer); if (oc) oc(); };
    }).catch(function () { hero.classList.add('hidden'); });
  }
  function stripArrows(root) {
    [].forEach.call(root.querySelectorAll('.strip'), function (st) {
      if (st.parentNode.classList.contains('sw')) return;
      var w = document.createElement('div'); w.className = 'sw'; st.parentNode.insertBefore(w, st); w.appendChild(st);
      w.insertAdjacentHTML('beforeend', '<button class="arr l" tabindex="-1" aria-label="向左">‹</button><button class="arr r" tabindex="-1" aria-label="向右">›</button>');
      w.querySelector('.l').onclick = function () { st.scrollBy({ left: -st.clientWidth * .85, behavior: 'smooth' }); };
      w.querySelector('.r').onclick = function () { st.scrollBy({ left: st.clientWidth * .85, behavior: 'smooth' }); };
    });
  }
  function skel(n) { var h = ''; for (var k = 0; k < n; k++) h += '<div class="vod skel"><div class="pic"></div><div class="nm"></div><div class="sub"></div></div>'; return h; }
  function viewTvHome() {
    app.innerHTML = heroHtml() + '<div id="rows"><div class="hrow hidden" id="contRow"><div class="hd"><b>继续观看</b><a href="#/history">全部 ›</a></div><div class="strip" id="contStrip"></div></div>' +
      HOME_ROWS.map(function (r) { return '<div class="hrow"><div class="hd"><b>' + esc(r[1]) + '</b><a href="#/cat?' + qs({ t: r[2], c: r[0] }) + '">更多 ›</a></div><div class="strip" data-c="' + r[0] + '">' + skel(9) + '</div></div>'; }).join('') + '</div>';
    bindDb($('#rows')); stripArrows($('#rows')); document.body.classList.add('has-hero'); initHero();
    api('/api/history').then(function (j) {
      var l = (j.list || []).slice(0, 15); if (!l.length) return;
      $('#contStrip').innerHTML = l.map(function (h) {
        var repo = h.site.split('|')[0], key = h.site.slice(repo.length + 1), pct = h.duration ? Math.min(100, Math.round(h.position / h.duration * 100)) : 0;
        return '<div class="vod" tabindex="0" data-hist="1" data-repo="' + esc(repo) + '" data-site="' + esc(key) + '" data-id="' + esc(h.vod_id) + '" data-name="' + esc(h.vod_name) + '" data-pic="' + esc(h.vod_pic) + '"><div class="pic">' + img(h.vod_pic) +
          '<span class="rm">' + esc(h.ep_name || '') + '</span><span class="prog"><i style="width:' + pct + '%"></i></span></div><div class="nm">' + esc(h.vod_name) + '</div></div>';
      }).join('');
      $('#contRow').classList.remove('hidden');
    }).catch(function () { });
    [].forEach.call(app.querySelectorAll('.strip[data-c]'), function (el) {
      apiRetry('/api/douban?' + qs({ c: el.getAttribute('data-c'), count: 20 }), { timeout: 20000 }).then(function (j) {
        el.innerHTML = (j.list || []).map(dbCard).join('') || '<div class="muted">暂无</div>';
      }).catch(function (e) { el.innerHTML = '<div class="muted">豆瓣加载失败：' + esc(e.message) + '</div>'; });
    });
  }
  function viewCat(q) {
    var t = DB_CATS[q.t] ? q.t : 'movie', cat = DB_CATS[t];
    var c = q.c && cat.subs.some(function (x) { return x[0] === q.c; }) ? q.c : cat.subs[0][0];
    app.innerHTML = '<div class="tabs" id="subs">' + cat.subs.map(function (x) { return '<span class="tab' + (x[0] === c ? ' on' : '') + '" tabindex="0" data-c="' + x[0] + '">' + esc(x[1]) + '</span>'; }).join('') + '</div><div class="grid" id="grid">' + skel(18) + '</div><button class="more ghost hidden" id="moreBtn">加载更多</button>';
    var grid = $('#grid'); bindDb(grid);
    var st = { start: 0, total: 0, loading: false };
    $('#subs').onclick = function (e) { var x = e.target.closest('.tab'); if (x) go('/cat', { t: t, c: x.getAttribute('data-c') }); };
    function load() {
      st.loading = true; $('#moreBtn').classList.add('hidden');
      apiRetry('/api/douban?' + qs({ c: c, start: st.start, count: 30 }), { timeout: 20000 }).then(function (j) {
        var html = (j.list || []).map(dbCard).join('');
        if (!st.start) grid.innerHTML = html || '<div class="empty">暂无</div>'; else grid.insertAdjacentHTML('beforeend', html);
        st.start += 30; st.total = j.total || 0; st.loading = false;
        $('#moreBtn').classList.toggle('hidden', !(j.list || []).length || st.start >= st.total);
      }).catch(function (e) { st.loading = false; if (!st.start) grid.innerHTML = failHtml(e.message); else { toast(e.message); $('#moreBtn').classList.remove('hidden'); } var b = grid.querySelector('.retry'); if (b) b.onclick = function (ev) { ev.stopPropagation(); load(); }; });
    }
    load();
    $('#moreBtn').onclick = function () { if (!st.loading) load(); };
    var onScroll = function () { if (!st.loading && !$('#moreBtn').classList.contains('hidden') && window.innerHeight + window.scrollY > document.body.offsetHeight - 600) load(); };
    window.addEventListener('scroll', onScroll, { passive: true });
    cleanup = function () { window.removeEventListener('scroll', onScroll); };
  }

  // ---------------- remote-control / keyboard focus navigation (TV boxes) ----------------
  document.addEventListener('keydown', function (e) {
    var dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    var a = document.activeElement || document.body;
    if (e.key === 'Enter' && a.classList && (a.classList.contains('vod') || a.classList.contains('tab') || a.classList.contains('ep'))) { e.preventDefault(); a.click(); return; }
    var d = dirs[e.key]; if (!d) return;
    if (/INPUT|SELECT|TEXTAREA/.test(a.tagName)) return;
    if (parseHash().path === '/detail' && (a === document.body || a.tagName === 'VIDEO')) return; // player keys seek
    var els = [].filter.call(document.querySelectorAll('.vod,#topCats a,#navLinks a,.tab,.ep,#searchInput,.pbtns button,.more'), function (x) { return x.offsetParent !== null; });
    if (!els.length) return;
    if (a === document.body || els.indexOf(a) < 0) { e.preventDefault(); (document.querySelector('#app .vod,#app .tab') || els[0]).focus(); return; }
    var r = a.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, best = null, bs = 1e12;
    els.forEach(function (x) {
      if (x === a) return; var q = x.getBoundingClientRect(), dx = q.left + q.width / 2 - cx, dy = q.top + q.height / 2 - cy;
      var main = d[0] ? dx * d[0] : dy * d[1], cross = d[0] ? Math.abs(dy) : Math.abs(dx);
      if (main <= 4) return; var sc = main + cross * 3; if (sc < bs) { bs = sc; best = x; }
    });
    if (best) { e.preventDefault(); best.focus(); best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); }
  });
  // staggered entrance for cards as they are inserted
  var revealIO = window.IntersectionObserver ? new IntersectionObserver(function (es) {
    var k = 0;
    es.filter(function (e) { return e.isIntersecting; }).sort(function (a, b) { return (a.boundingClientRect.top - b.boundingClientRect.top) || (a.boundingClientRect.left - b.boundingClientRect.left); })
      .forEach(function (e) { var n = e.target; n.style.setProperty('--i', Math.min(k++, 12)); n.classList.remove('pre'); n.classList.add(n.classList.contains('vod') ? 'rise' : 'in'); revealIO.unobserve(n); });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 }) : null;
  function reveal(n) { if (!revealIO || reduceMotion) return; n.classList.add('pre'); revealIO.observe(n); }
  if (window.MutationObserver) new MutationObserver(function (ms) {
    ms.forEach(function (m) { [].forEach.call(m.addedNodes, function (n) {
      if (n.nodeType !== 1) return;
      if (n.classList.contains('vod') && !n.classList.contains('skel')) reveal(n);
      else [].forEach.call(n.querySelectorAll ? n.querySelectorAll('.hrow,.info,.hitem') : [], reveal);
      if (n.classList.contains('hrow') || n.classList.contains('hitem')) reveal(n);
    }); });
  }).observe(app, { childList: true, subtree: true });
  // 3D tilt + glare on cards (fine pointers only)
  if (window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches && !reduceMotion) {
    var tiltEl = null;
    app.addEventListener('pointermove', function (e) {
      var p = e.target.closest ? e.target.closest('.vod:not(.skel) .pic') : null;
      if (tiltEl && tiltEl !== p) { tiltEl.style.removeProperty('--tx'); tiltEl.style.removeProperty('--ty'); tiltEl = null; }
      if (!p) return; tiltEl = p;
      var r = p.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      p.style.setProperty('--tx', ((0.5 - y) * 14).toFixed(2) + 'deg'); p.style.setProperty('--ty', ((x - 0.5) * 16).toFixed(2) + 'deg');
      p.style.setProperty('--gx', (x * 100).toFixed(1) + '%'); p.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
    });
    app.addEventListener('pointerleave', function () { if (tiltEl) { tiltEl.style.removeProperty('--tx'); tiltEl.style.removeProperty('--ty'); tiltEl = null; } });
  }
  // ripple
  document.addEventListener('pointerdown', function (e) {
    var b = e.target.closest ? e.target.closest('.btn-play,.btn-glass,.pbtns button,.tab,.ep,.hrow .hd a,#searchForm button,.card button') : null; if (!b || reduceMotion) return;
    var r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2.2, s = document.createElement('i');
    s.className = 'rp'; s.style.cssText = 'width:' + d + 'px;height:' + d + 'px;left:' + (e.clientX - r.left - d / 2) + 'px;top:' + (e.clientY - r.top - d / 2) + 'px';
    b.classList.add('rp-host'); b.appendChild(s); setTimeout(function () { s.remove(); }, 700);
  });
  var onTopScroll = function () { document.body.classList.toggle('scrolled', window.scrollY > 30); };
  window.addEventListener('scroll', onTopScroll, { passive: true }); onTopScroll();
  setInterval(function () { var c = $('#clock'); if (c) { var d = new Date(); c.textContent = (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); } }, 10000);

  function viewHome(q) {
    if (!state.repo) { app.innerHTML = '<div class="empty">还没有配置源。请管理员在后台添加 TVBox 配置地址。</div>'; return; }
    var key = q.site || localStorage.getItem('site:' + state.repo);
    var sup = state.sites.filter(function (s) { return s.supported; });
    if (!key || !state.siteMap[key] || !state.siteMap[key].supported) key = sup.length ? sup[0].key : '';
    var opts = state.sites.map(function (s) { return '<option value="' + esc(s.key) + '"' + (s.key === key ? ' selected' : '') + (s.supported ? '' : ' disabled') + '>' + esc(s.name) + kindLabel(s) + (s.dead ? ' ⚠' : '') + '</option>'; }).join('');
    app.innerHTML = '<div class="bar"><select id="siteSel">' + opts + '</select><span class="muted" id="siteInfo"></span></div>' +
      '<div class="tabs" id="cats"></div><div class="grid" id="grid"></div><button class="more ghost hidden" id="moreBtn">加载更多</button>';
    if (!key) { $('#grid').outerHTML = '<div class="empty">此配置中没有当前可用的站点类型（' + state.sites.length + ' 个站点，多为 jar 爬虫）。可切换其他配置，或启用 jar 扩展。</div>'; }
    $('#siteSel').onchange = function () { localStorage.setItem('site:' + state.repo, this.value); go('/browse', { site: this.value }); };
    if (!key) return;
    var grid = $('#grid'); bindCards(grid);
    var cur = { tid: null, pg: 1, pagecount: 0, loading: false };
    var homeList = [];
    grid.innerHTML = '<div class="muted">加载中…</div>';
    var t0 = Date.now();
    var warm = setTimeout(function () { if (grid.textContent.indexOf('加载中') >= 0) grid.innerHTML = '<div class="muted">' + (state.siteMap[key].kind === 'csp' ? 'jar 爬虫首次加载需要预热（下载+转换），约 10–40 秒…' : '站点响应较慢，请稍候…') + '</div>'; }, 3000);
    cleanup = function () { clearTimeout(warm); };
    apiRetry('/api/home?' + qs({ repo: state.repo, site: key }), { timeout: 75000 }).then(function (j) {
      $('#siteInfo').textContent = (Date.now() - t0) + 'ms' + (j.stale ? ' · 缓存' : '');
      var cls = j.class || [];
      homeList = j.list || [];
      var tabs = (homeList.length ? '<span class="tab on" data-tid="">推荐</span>' : '') + cls.map(function (c, i) { return '<span class="tab' + (!homeList.length && i === 0 ? ' on' : '') + '" data-tid="' + esc(c.type_id) + '">' + esc(c.type_name) + '</span>'; }).join('');
      $('#cats').innerHTML = tabs;
      if (homeList.length) { grid.innerHTML = homeList.map(function (v) { return vodCard(v, key); }).join(''); }
      else if (cls.length) loadCat(cls[0].type_id, 1);
      else grid.innerHTML = '<div class="empty">没有内容</div>';
    }).catch(function (e) {
      if (/^warming/.test(e.message) && parseHash().path === '/browse') { grid.innerHTML = '<div class="muted">jar 爬虫预热中（首次需下载并转换，路由器上约 1–2 分钟），完成后自动加载…</div>'; var rt = setTimeout(function () { route(); }, 8000); var oc = cleanup; cleanup = function () { clearTimeout(rt); oc && oc(); }; return; }
      grid.innerHTML = failHtml(e.message);
      var b = grid.querySelector('.retry'); if (b) b.onclick = function (ev) { ev.stopPropagation(); route(); };
    });
    $('#cats').onclick = function (e) {
      var t = e.target.closest('.tab'); if (!t) return;
      [].forEach.call($('#cats').children, function (x) { x.classList.toggle('on', x === t); });
      var tid = t.getAttribute('data-tid');
      if (!tid) { cur.tid = null; grid.innerHTML = homeList.map(function (v) { return vodCard(v, key); }).join(''); $('#moreBtn').classList.add('hidden'); return; }
      loadCat(tid, 1);
    };
    function loadCat(tid, pg) {
      cur.tid = tid; cur.pg = pg; cur.loading = true;
      if (pg === 1) grid.innerHTML = '<div class="muted">加载中…</div>';
      $('#moreBtn').classList.add('hidden');
      apiRetry('/api/category?' + qs({ repo: state.repo, site: key, tid: tid, pg: pg }), { timeout: 30000 }).then(function (j) {
        if (cur.tid !== tid) return;
        var html = (j.list || []).map(function (v) { return vodCard(v, key); }).join('');
        if (pg === 1) grid.innerHTML = html || '<div class="empty">没有内容</div>'; else grid.insertAdjacentHTML('beforeend', html);
        cur.pagecount = Number(j.pagecount || 0);
        var hasMore = (j.list || []).length > 0 && (!cur.pagecount || pg < cur.pagecount);
        $('#moreBtn').classList.toggle('hidden', !hasMore);
        cur.loading = false;
      }).catch(function (e) {
        cur.loading = false; if (cur.tid !== tid) return;
        if (pg === 1) { grid.innerHTML = failHtml(e.message); var b = grid.querySelector('.retry'); if (b) b.onclick = function (ev) { ev.stopPropagation(); loadCat(tid, 1); }; }
        else { toast(e.message); $('#moreBtn').classList.remove('hidden'); }
      });
    }
    $('#moreBtn').onclick = function () { if (!cur.loading && cur.tid) loadCat(cur.tid, cur.pg + 1); };
    var onScroll = function () {
      if (cur.loading || !cur.tid || $('#moreBtn').classList.contains('hidden')) return;
      if (window.innerHeight + window.scrollY > document.body.offsetHeight - 600) loadCat(cur.tid, cur.pg + 1);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    cleanup = function () { clearTimeout(warm); window.removeEventListener('scroll', onScroll); };
  }

  // aggregate search via SSE; returns a handle with close()
  function streamSearch(wd, onResult, onDone, repo) {
    var es = new EventSource('/api/search?' + qs({ repo: repo || state.repo, wd: wd }));
    es.addEventListener('result', function (e) { try { onResult(JSON.parse(e.data)); } catch (x) { } });
    es.addEventListener('done', function (e) { es.close(); onDone && onDone(JSON.parse(e.data)); });
    es.addEventListener('fail', function (e) { es.close(); onDone && onDone({ error: JSON.parse(e.data).error }); });
    es.onerror = function () { es.close(); onDone && onDone({ error: 'stream closed' }); };
    return es;
  }

  function viewSearch(wd) {
    $('#searchInput').value = wd || '';
    app.innerHTML = '<div class="bar"><b>搜索：' + esc(wd) + '</b><span class="muted" id="sstat">搜索中…</span><label class="muted" style="margin-left:auto"><input type="checkbox" id="exact"> 只看完全匹配</label></div><div class="tabs" id="stabs"><span class="tab on" data-s="">全部</span></div><div class="grid" id="grid"></div>';
    var grid = $('#grid'); bindCards(grid);
    var n = 0, sitesDone = 0, all = [], filt = '';
    function render() {
      var exact = $('#exact').checked, nt = normTitle(wd);
      grid.innerHTML = all.filter(function (x) { return (!filt || x.site === filt) && (!exact || normTitle(x.v.vod_name) === nt); })
        .map(function (x) { return vodCard(x.v, x.site, x.siteName); }).join('') || '<div class="empty">暂无结果</div>';
    }
    var es = streamSearch(wd, function (r) {
      sitesDone++;
      if (r.list && r.list.length) {
        r.list.forEach(function (v) { all.push({ v: v, site: r.site, siteName: r.siteName }); n++; });
        $('#stabs').insertAdjacentHTML('beforeend', '<span class="tab" data-s="' + esc(r.site) + '">' + esc(r.siteName) + ' ' + r.list.length + '</span>');
        render();
      }
      $('#sstat').textContent = '已搜索 ' + sitesDone + ' 个站点，' + n + ' 条结果';
    }, function (sum) {
      $('#sstat').textContent = '完成：' + sitesDone + ' 个站点，' + n + ' 条结果' + (sum && sum.skipped ? '（跳过 ' + sum.skipped + ' 个近期失效站点）' : '') + (sum && sum.error && !sitesDone ? ' ' + sum.error : '');
      if (!n) render();
    });
    $('#stabs').onclick = function (e) { var t = e.target.closest('.tab'); if (!t) return; filt = t.getAttribute('data-s'); [].forEach.call($('#stabs').children, function (x) { x.classList.toggle('on', x === t); }); render(); };
    $('#exact').onchange = render;
    cleanup = function () { es.close(); };
  }

  // history replays by title: race for the best direct source again (no source memory, user 2026-11-03); the saved source is only the fallback
  function histGo(el) {
    var a = function (k) { return el.getAttribute('data-' + k) || ''; };
    go('/detail', { auto: 1, repo: a('repo'), name: a('name'), pic: a('pic'), hsite: a('site'), hid: a('id') });
  }
  function viewHistory() {
    app.innerHTML = '<div class="bar"><b>观看历史</b><button class="ghost" id="clr" style="margin-left:auto">清空</button></div><div class="list" id="lst"><div class="muted">加载中…</div></div>';
    function load() {
      api('/api/history').then(function (j) {
        $('#lst').innerHTML = j.list.map(function (h) {
          var repo = h.site.split('|')[0], key = h.site.slice(repo.length + 1);
          var pct = h.duration ? Math.min(100, Math.round(h.position / h.duration * 100)) : 0;
          return '<div class="hitem" data-repo="' + esc(repo) + '" data-site="' + esc(key) + '" data-id="' + esc(h.vod_id) + '" data-name="' + esc(h.vod_name) + '" data-pic="' + esc(h.vod_pic) + '">' +
            img(h.vod_pic) + '<div class="t"><div>' + esc(h.vod_name) + '</div><div class="muted">' + esc(h.ep_name || '') + ' · ' + fmtTime(h.position) + (h.duration ? ' / ' + fmtTime(h.duration) : '') + '</div><div class="muted" style="font-size:11px">' + esc(new Date(h.updated).toLocaleString()) + '</div><div class="progress"><i style="width:' + pct + '%"></i></div></div><button class="x" data-del="1">✕</button></div>';
        }).join('') || '<div class="empty">还没有观看记录</div>';
      }).catch(function (e) { $('#lst').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
    }
    load();
    $('#lst').onclick = function (e) {
      var it = e.target.closest('.hitem'); if (!it) return;
      var site = it.getAttribute('data-repo') + '|' + it.getAttribute('data-site');
      if (e.target.getAttribute('data-del')) { api('/api/history?' + qs({ site: site, id: it.getAttribute('data-id') }), { method: 'DELETE' }).then(load); return; }
      histGo(it);
    };
    $('#clr').onclick = function () { if (confirm('清空全部观看历史？')) api('/api/history?all=1', { method: 'DELETE' }).then(load); };
  }

  function viewFav() {
    app.innerHTML = '<div class="bar"><b>我的收藏</b></div><div class="grid" id="grid">' + skel(12) + '</div>';
    api('/api/fav').then(function (j) {
      $('#grid').innerHTML = j.list.map(function (f) {
        var repo = f.site.split('|')[0], key = f.site.slice(repo.length + 1);
        return vodCard({ vod_id: f.vod_id, vod_name: f.vod_name, vod_pic: f.vod_pic, vod_remarks: f.remarks }, key).replace('class="vod"', 'class="vod" data-repo="' + esc(repo) + '"');
      }).join('') || '<div class="empty">还没有收藏</div>';
      bindCards($('#grid'));
    });
  }

  // ---------------- detail + player ----------------
  function splitPlay(v) {
    var froms = String(v.vod_play_from || '').split('$$$');
    var urls = String(v.vod_play_url || '').split('$$$');
    var lines = [];
    froms.forEach(function (f, i) {
      var eps = String(urls[i] || '').split('#').filter(Boolean).map(function (e, j) {
        var k = e.indexOf('$'); return k >= 0 ? { name: e.slice(0, k) || ('第' + (j + 1) + '集'), url: e.slice(k + 1) } : { name: '第' + (j + 1) + '集', url: e };
      });
      if (eps.length) lines.push({ flag: f || ('线路' + (i + 1)), eps: eps });
    });
    // speed: prefer lines whose links are direct media (m3u8/mp4) over web-player pages
    var isMedia = function (u) { return /\.(m3u8|mp4|flv)(\?|$)/i.test(u); };
    lines.forEach(function (l, i) { l.order = (isMedia(l.eps[0].url) ? 0 : 1) * 1000 + i; });
    lines.sort(function (a, b) { return a.order - b.order; });
    return lines;
  }
  function epMatch(eps, name, idx) {
    if (name) {
      for (var i = 0; i < eps.length; i++) if (eps[i].name === name) return i;
      var num = (String(name).match(/\d+/) || [])[0];
      if (num) for (var j = 0; j < eps.length; j++) { var m = String(eps[j].name).match(/\d+/); if (m && Number(m[0]) === Number(num)) return j; }
    }
    return Math.min(idx || 0, eps.length - 1);
  }

  function viewDetail(q) {
    var P = {
      repo: q.repo || state.repo, site: q.site, id: q.id, vod: null, lines: [], li: 0, ei: 0,
      srcs: [], hls: null, mts: null, tried: {}, switching: false, resumeAt: 0, stallTimer: null, startTimer: null, lastT: 0, saveT: 0, destroyed: false, playToken: 0,
    };
    app.innerHTML = '<div class="dbg" id="dbg"></div><div class="detail"><div><div class="player" id="pl"><video id="vd" controls playsinline webkit-playsinline x5-playsinline x5-video-player-type="h5" x5-video-player-fullscreen="true" x-webkit-airplay="allow" preload="auto" referrerpolicy="no-referrer"></video>' +
      '<div class="ov"><span id="nowp"></span><span id="srcinfo" class="muted"></span></div><div class="msg hidden" id="pmsg"></div><div class="qb hidden" id="qb"><span class="qb-dot"></span><b id="qbSite"></b><span class="qb-res" id="qbRes"></span><span class="qb-net" id="qbNet"></span></div></div>' +
      '<div class="pbtns"><button id="bPrev">上一集</button><button id="bNext">下一集</button><button id="bFav">☆ 收藏</button><button id="bFs">全屏</button><select id="bRate"><option value="1">1x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2">2x</option><option value="0.75">0.75x</option></select></div>' +
      '<div id="srcPanel" class="srcpanel hidden"></div>' +
      '<div class="info" id="info"><h1>' + esc(q.name || '加载中…') + '</h1></div></div>' +
      '<div><div class="sec"><span>片源</span><span class="muted" id="srcsInfo"></span></div><div class="srcs" id="srcs"><div class="muted">查找中…</div></div><div class="sec sm hidden" id="linesHd"><span>本源线路</span><span class="muted" id="lineInfo"></span></div><div class="tabs hidden" id="lines"></div><div class="sec"><span>选集</span><a href="javascript:void 0" id="rev">倒序</a></div><div class="eps" id="eps"><div class="muted">加载中…</div></div></div></div>';
    var video = $('#vd'), pl = $('#pl');
    function msg(t) { var m = $('#pmsg'); if (!t) m.classList.add('hidden'); else { m.textContent = t; m.classList.remove('hidden'); } }

    // touch gestures: double-tap sides to seek, horizontal swipe to seek
    (function gestures() {
      var lastTap = 0, sx = 0, sy = 0, st = 0, moving = false;
      pl.addEventListener('touchstart', function (e) { if (e.touches.length !== 1) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = video.currentTime; moving = false; pl.classList.add('show'); }, { passive: true });
      pl.addEventListener('touchmove', function (e) {
        var dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
        if (!moving && Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy) * 2 && e.touches[0].clientY < pl.getBoundingClientRect().bottom - 50) moving = true;
        if (moving && video.duration) { var t = Math.max(0, Math.min(video.duration, st + dx / pl.clientWidth * 120)); msg(fmtTime(t) + ' / ' + fmtTime(video.duration)); }
      }, { passive: true });
      pl.addEventListener('touchend', function (e) {
        var x = e.changedTouches[0].clientX;
        if (moving && video.duration) { video.currentTime = Math.max(0, Math.min(video.duration, st + (x - sx) / pl.clientWidth * 120)); msg(''); moving = false; return; }
        var now = Date.now(), r = pl.getBoundingClientRect();
        if (now - lastTap < 300 && e.changedTouches[0].clientY < r.bottom - 50) {
          var rel = (x - r.left) / r.width;
          if (rel < 0.35) { video.currentTime = Math.max(0, video.currentTime - 10); toast('« 10秒', 800); }
          else if (rel > 0.65) { video.currentTime = video.currentTime + 10; toast('10秒 »', 800); }
        }
        lastTap = now;
        setTimeout(function () { pl.classList.remove('show'); }, 2500);
      });
    })();
    document.addEventListener('keydown', onKey);
    function onKey(e) {
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key === 'ArrowRight') { video.currentTime += 10; } else if (e.key === 'ArrowLeft') { video.currentTime -= 10; }
      else if (e.key === ' ') { e.preventDefault(); video.paused ? video.play() : video.pause(); }
      else if (e.key === 'f') fullscreen();
    }

    function fullscreen() {
      if (video.webkitEnterFullscreen && IS_IOS) { try { video.webkitEnterFullscreen(); } catch (e) { } return; }
      var el = pl;
      var fs = document.fullscreenElement || document.webkitFullscreenElement;
      if (fs) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      var req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
      if (req) { var p = req.call(el); if (p && p.then) p.then(function () { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () { }); }).catch(function () { }); }
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    }
    $('#bFs').onclick = fullscreen;
    $('#bRate').onchange = function () { video.playbackRate = Number(this.value); };

    function loadDetail(site, id) {
      return api('/api/detail?' + qs({ repo: P.repo, site: site, id: id }), { timeout: 50000 }).then(function (j) {
        var v = j.list && j.list[0]; if (!v) throw new Error('详情为空');
        var lines = splitPlay(v); if (!lines.length) throw new Error('没有播放列表');
        return { vod: v, lines: lines };
      });
    }
    function renderInfo() {
      var v = P.vod, pu = picUrl(v.vod_pic || q.pic);
      if (pu) $('#dbg').style.backgroundImage = 'url("' + pu.replace(/"/g, '%22') + '")';
      $('#info').innerHTML = (v.vod_pic || q.pic ? '<div class="iposter">' + img(v.vod_pic || q.pic) + '</div>' : '') + '<div class="itxt"><h1>' + esc(v.vod_name) + '</h1><div class="meta">' + esc([v.vod_year, v.vod_area, v.type_name, v.vod_remarks].filter(function (x) { return x && !/^(年份|地区|类型|更新信息)$/.test(x); }).join(' · ')) + ' · 来源：' + esc(siteName(P.site)) + '</div>' +
        (v.vod_actor && v.vod_actor !== '主演' ? '<div class="meta">主演：' + esc(v.vod_actor) + '</div>' : '') +
        '<div class="desc" id="desc">' + esc(decodeEnt(String(v.vod_content || '').replace(/<[^>]+>/g, '')).trim()) + '</div></div>';
      $('#desc').onclick = function () { this.classList.toggle('open'); };
      $('#nowp').textContent = v.vod_name;
    }
    var reversed = false;
    function lineChip(flag) { var q = resGet(P.site, flag, true); return q ? ' <em class="lr ' + resCls(q) + '">' + resLabel(q) + '</em>' : ''; }
    function updLineChips() { [].forEach.call($('#lines').children, function (t) { var l = P.lines[+t.getAttribute('data-i')]; if (!l) return; var e = t.querySelector('.lr'); if (e) e.remove(); t.insertAdjacentHTML('beforeend', lineChip(l.flag)); }); }
    // quality badge on the player: source · resolution · network
    var qbT = null;
    function qbShow(src, provisional) {
      var line = P.lines[P.li] || {}, b = $('#qb'); if (!b) return;
      $('#qbSite').textContent = siteName(P.site) + (line.flag && line.flag !== '-' ? ' · ' + line.flag : '');
      if (provisional !== undefined) setRes(provisional, true);
      if (src) $('#qbNet').textContent = (src.mode === 'direct' ? '直连片源' : src.mode === 'local' ? '本地' : src.mode === 'proxy-m3u8' && !src.sp ? '中转索引' : '中转') + (src.ms != null ? ' · 解析 ' + src.ms + 'ms' : '');
      $('#qbNet').title = src.mode === 'direct' ? '浏览器直接从片源 CDN 拉流' : '视频经服务器转发（片源要求特殊请求头、不允许跨域，或直连失败）';
      b.classList.remove('hidden', 'mini'); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
      clearTimeout(qbT); qbT = setTimeout(function () { b.classList.add('mini'); }, 6000);
    }
    function setRes(q, guess) {
      var e = $('#qbRes'); if (!e) return;
      e.className = 'qb-res ' + resCls(q) + (guess ? ' guess' : ''); e.textContent = q ? resLabel(q) : '检测中';
      e.title = q ? (guess ? '索引标称 ' : '实际 ') + q + 'p' : '';
    }
    video.addEventListener('resize', onVidRes); video.addEventListener('loadedmetadata', onVidRes);
    function onVidRes() {
      var q = resQ(video.videoWidth, video.videoHeight); if (!q) return;
      var line = P.lines[P.li]; if (line) { resSet(P.site, line.flag, q); updLineChips(); }
      var cs = srcCur(); if (cs && cs.q !== q) { cs.q = q; renderSrcs(); }
      setRes(q, false); $('#qbRes').title = '实际 ' + video.videoWidth + '×' + video.videoHeight;
    }
    // background: learn the resolution of the other lines of this title (cached plays, so switching later is instant)
    function probeLines() {
      var me = P.playToken, site = P.site;
      P.lines.slice(0, 8).forEach(function (l, i) {
        if (i === P.li || resGet(site, l.flag, true)) return;
        var ep = l.eps[epMatch(l.eps, curEpName(), P.ei)] || l.eps[0]; if (!ep || !ep.url) return;
        api('/api/play?' + playQs(site, l.flag, ep.url), { timeout: 12000 }).then(function (r) {
          if (P.destroyed || site !== P.site) return; if (r.res) { resSet(site, l.flag, resQ(r.res.w, r.res.h)); updLineChips(); }
        }).catch(function () { });
      });
    }
    function playQs(site, flag, id, forceProxy) { return qs({ repo: P.repo, site: site, flag: flag, id: id, native: useNativeHls() && IS_IOS ? 1 : '', https: location.protocol === 'https:' ? 1 : '', proxy: forceProxy || preferProxy(site) ? 1 : '' }); }
    // ---- sources panel (user 2026-11-03): one row per source of this title: name · resolution · speed · 直连/中转; click to switch ----
    function srcFind(site, id) { return P.srcs.filter(function (c) { return c.site === site && String(c.v.vod_id) === String(id); })[0]; }
    function srcCur() {
      var c = srcFind(P.site, P.id);
      if (!c && P.vod) { c = { site: P.site, siteName: siteName(P.site), v: { vod_id: P.id, vod_name: P.vod.vod_name }, s: 100 }; P.srcs.push(c); }
      return c;
    }
    function dirOf(r) { return r.mode === 'direct' ? 2 : (r.mode === 'proxy-m3u8' && !r.sp) || r.mode === 'local' ? 1 : 0; }
    function srcTier(q) { return !q ? 1 : q >= (DEV.mobile ? 680 : 980) ? 2 : 0; }
    function fmtBw(b) { return b >= 1e6 ? (b / 8e6).toFixed(1) + ' MB/s' : Math.round(b / 8e3) + ' KB/s'; }
    function renderSrcs() {
      var box = $('#srcs'); if (!box) return; var cur = srcCur();
      var list = P.srcs.filter(function (c) { return c.s >= 100 || c === cur; }).sort(function (a, b) {
        return (b === cur) - (a === cur) || ((b.ok === true) - (a.ok === true)) || ((a.ok === false) - (b.ok === false)) || ((b.dir || 0) - (a.dir || 0)) || (srcTier(b.q) - srcTier(a.q)) || ((a.ms || 9e9) - (b.ms || 9e9));
      });
      box.innerHTML = list.map(function (c) {
        var i = P.srcs.indexOf(c), on = c === cur, st = c.ok === false ? '<span class="sd bad">不可用</span>' : c.ok ? '<span class="sd d' + (c.dir || 0) + '"' + (c.dir !== 2 && proxyMap()[c.site] ? ' title="之前直连失败，20 分钟内走中转；点击这一行重试直连"' : '') + '>' + (c.dir === 2 ? '直连' : c.dir === 1 ? '中转索引' : '中转') + '</span>' : '<span class="sd">' + (c.busy ? '检测中…' : '未检测') + '</span>';
        var sp = on && c.bw ? fmtBw(c.bw) : c.ms ? c.ms + 'ms' : '';
        return '<div class="src' + (on ? ' on' : '') + (c.ok === false ? ' bad' : '') + '" data-i="' + i + '" title="' + esc(c.v.vod_name + (c.v.vod_remarks ? ' · ' + c.v.vod_remarks : '')) + '"><b>' + esc(c.siteName) + '</b>' +
          (c.q ? '<em class="lr ' + resCls(c.q) + '">' + resLabel(c.q) + '</em>' : '<em class="lr none">—</em>') + '<span class="sp" title="' + (on && c.bw ? '当前下载速度' : '解析响应时间') + '">' + sp + '</span>' + st + '</div>';
      }).join('') || '<div class="muted">查找中…</div>';
      var n = list.filter(function (c) { return c.ok; }).length; $('#srcsInfo').textContent = list.length ? n + '/' + list.length + ' 可用' : '';
    }
    $('#srcs').onclick = function (e) {
      var t = e.target.closest('.src'); if (!t) return; var c = P.srcs[+t.getAttribute('data-i')]; if (!c) return;
      // a manual pick tries direct again (forgets this source's 20-min relay fallback); clicking the playing relayed row retries it direct
      var wasRelay = proxyMap()[c.site]; proxyClear(c.site);
      if (c === srcCur()) { if (wasRelay && c.dir !== 2) { toast('重新尝试直连…'); playCurrent(video.currentTime > 5 ? video.currentTime : 0, '重试直连'); } return; }
      var pos = video.currentTime, epName = curEpName(), epIdx = P.ei; msg('切换到「' + c.siteName + '」…');
      (c.d ? Promise.resolve(c.d) : loadDetail(c.site, c.v.vod_id)).then(function (d) {
        c.d = d; P.site = c.site; P.id = String(c.v.vod_id); P.vod = d.vod; P.lines = d.lines; P.li = 0; P.ei = epMatch(d.lines[0].eps, epName, epIdx);
        if (!P.vod.vod_pic) P.vod.vod_pic = q.pic;
        renderInfo(); renderLines(); favState(); playCurrent(pos > 5 ? pos : 0, '手动换源');
      }).catch(function (er) { c.ok = false; renderSrcs(); toast('该来源打开失败：' + er.message); msg(''); });
    };
    // live download speed of the playing source (hls.js bandwidth estimate)
    var bwT = setInterval(function () { if (P.destroyed) return clearInterval(bwT); var c = srcCur(); if (c && P.hls && P.hls.bandwidthEstimate > 0 && !video.paused) { c.bw = P.hls.bandwidthEstimate; var r = $('#srcs .src.on .sp'); if (r) { r.textContent = fmtBw(c.bw); r.title = '当前下载速度'; } } }, 4000);
    // background: find every source of this title and test each one (same episode), so the list fills in while you watch
    function probeSrcs() {
      if (P.srcProbed || !P.vod) return; P.srcProbed = 1;
      var name = P.dbName || P.vod.vod_name, nt = normTitle(name), year = String(P.dbYear || P.vod.vod_year || '').slice(0, 4), queue = [], running = 0;
      function add(site, siteName_, v, ms) {
        if (normTitle(v.vod_name) !== nt || srcFind(site, v.vod_id)) return;
        var vy = String(v.vod_year || '').slice(0, 4); if (year && vy && vy !== year) return;
        P.srcs.push({ site: site, siteName: siteName_, v: v, s: 100, sms: ms });
      }
      function pump() {
        if (P.destroyed) return;
        while (running < 3) {
          var c = P.srcs.filter(function (x) { return x.s >= 100 && x.ok === undefined && !x.busy && x !== srcCur(); })[0]; if (!c) return;
          running++; c.busy = true; renderSrcs(); test(c).then(function () { running--; renderSrcs(); pump(); });
        }
      }
      function test(c) {
        var epName = curEpName(), epIdx = P.ei;
        return (c.d ? Promise.resolve(c.d) : loadDetail(c.site, c.v.vod_id)).then(function (d) {
          c.d = d; var l = d.lines[0], ep = l && l.eps[epMatch(l.eps, epName, epIdx)]; if (!ep || !ep.url) throw new Error('no ep');
          var t0 = Date.now();
          return api('/api/play?' + playQs(c.site, l.flag, ep.url), { timeout: 10000 }).then(function (r) {
            c.ok = true; c.ms = Date.now() - t0; c.dir = dirOf(r); c.q = r.res ? resQ(r.res.w, r.res.h) : resGet(c.site, l.flag); if (r.res) resSet(c.site, l.flag, c.q);
          });
        }).catch(function () { c.ok = false; }).then(function () { c.busy = false; });
      }
      var es = streamSearch(name, function (r) { (r.list || []).forEach(function (v) { add(r.site, r.siteName, v, r.ms); }); renderSrcs(); pump(); }, function () { pump(); }, P.repo);
      var old = cleanup; cleanup = function () { es.close(); old && old(); };
      pump();
    }
    function renderLines() {
      var many = P.lines.length > 1; $('#lines').classList.toggle('hidden', !many); $('#linesHd').classList.toggle('hidden', !many); renderSrcs();
      $('#lines').innerHTML = P.lines.map(function (l, i) { return '<span class="tab' + (i === P.li ? ' on' : '') + (P.tried[P.site + '|' + P.id + '|' + l.flag] === 'bad' ? ' bad' : '') + '" data-i="' + i + '">' + esc(l.flag) + ' (' + l.eps.length + ')' + lineChip(l.flag) + '</span>'; }).join('');
      renderEps();
    }
    function renderEps() {
      var eps = P.lines[P.li].eps.map(function (e, i) { return '<div class="ep' + (i === P.ei ? ' on' : '') + '" data-i="' + i + '" title="' + esc(e.name) + '">' + esc(e.name) + '</div>'; });
      if (reversed) eps.reverse();
      $('#eps').innerHTML = eps.join('');
    }
    $('#lines').onclick = function (e) { var t = e.target.closest('.tab'); if (!t) return; var pos = video.currentTime; P.li = Number(t.getAttribute('data-i')); P.ei = epMatch(P.lines[P.li].eps, curEpName(), P.ei); renderLines(); playCurrent(pos > 5 ? pos : 0, '手动切换线路'); };
    $('#eps').onclick = function (e) { var t = e.target.closest('.ep'); if (!t) return; P.ei = Number(t.getAttribute('data-i')); renderEps(); playCurrent(0); };
    $('#rev').onclick = function () { reversed = !reversed; renderEps(); };
    $('#bPrev').onclick = function () { if (P.ei > 0) { P.ei--; renderEps(); playCurrent(0); } };
    $('#bNext').onclick = nextEp;
    function nextEp() { if (P.lines[P.li] && P.ei < P.lines[P.li].eps.length - 1) { P.ei++; renderEps(); playCurrent(0); return true; } return false; }
    function curEpName() { var l = P.lines[P.li]; return l && l.eps[P.ei] ? l.eps[P.ei].name : ''; }

    // ---- favorites ----
    function favState() { api('/api/fav').then(function (j) { var on = j.list.some(function (f) { return f.site === P.repo + '|' + P.site && f.vod_id === String(P.id); }); $('#bFav').textContent = on ? '★ 已收藏' : '☆ 收藏'; $('#bFav').dataset.on = on ? '1' : ''; }); }
    $('#bFav').onclick = function () {
      var on = this.dataset.on; var site = P.repo + '|' + P.site;
      (on ? api('/api/fav?' + qs({ site: site, id: P.id }), { method: 'DELETE' }) : api('/api/fav', { method: 'POST', body: { site: site, vod_id: P.id, vod_name: P.vod.vod_name, vod_pic: P.vod.vod_pic, remarks: P.vod.vod_remarks } })).then(favState);
    };

    // ---- history ----
    function saveHistory(force) {
      if (!P.vod || !video.currentTime) return;
      var now = Date.now(); if (!force && now - P.saveT < 10000) return; P.saveT = now;
      var body = JSON.stringify({ site: P.repo + '|' + P.site, vod_id: P.id, vod_name: P.vod.vod_name, vod_pic: P.vod.vod_pic || q.pic, flag: P.lines[P.li].flag, ep_index: P.ei, ep_name: curEpName(), position: video.currentTime, duration: video.duration || 0 });
      if (force && navigator.sendBeacon) { try { navigator.sendBeacon('/api/history', new Blob([body], { type: 'text/plain' })); return; } catch (e) { } }
      fetch('/api/history', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () { });
    }
    var onHide = function () { if (document.visibilityState === 'hidden') saveHistory(true); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);

    // ---- player engine ----
    function destroyEngine() {
      clearTimeout(P.stallTimer); clearTimeout(P.startTimer);
      if (P.hls) { try { P.hls.destroy(); } catch (e) { } P.hls = null; }
      if (P.mts) { try { P.mts.destroy(); } catch (e) { } P.mts = null; }
      video.removeAttribute('src'); try { video.load(); } catch (e) { }
    }
    function useNativeHls() { return !!video.canPlayType('application/vnd.apple.mpegurl') && (IS_IOS || !(window.Hls && Hls.isSupported())); }
    function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }

    function attach(src, startAt, token) {
      destroyEngine();
      var url = src.url;
      P.resumeAt = startAt || 0;
      var started = false;
      var fail = function (why) {
        if (token !== P.playToken) return;
        // direct link failed in this browser (geo/IP-bound sign, DNS, CORS): retry the same source through the router once
        if (src.mode === 'direct' && !started) { proxySet(P.site); toast('直连失败，改由中转重试…'); playCurrent(startAt, 'proxy', true); return; }
        onFail(why);
      };
      P.startTimer = setTimeout(function () { if (!started) fail('加载超时'); }, 25000);
      var onStart = function () { if (started) return; started = true; clearTimeout(P.startTimer); msg(''); };
      video.onloadedmetadata = function () {
        if (P.resumeAt > 3 && (!video.duration || P.resumeAt < video.duration - 8)) { try { video.currentTime = P.resumeAt; } catch (e) { } }
      };
      video.onplaying = onStart; video.oncanplay = onStart;
      if (!video._w) { video._w = 1; video.addEventListener('playing', function () { document.body.classList.add('watching'); }); video.addEventListener('pause', function () { document.body.classList.remove('watching'); }); }
      video.onerror = function () { var e = video.error; fail('播放错误' + (e ? ' (' + e.code + ')' : '')); };
      if (src.type === 'hls' && !useNativeHls() && window.Hls && Hls.isSupported()) {
        var hls = new Hls({ debug: (function () { try { return localStorage.getItem('tvb_debug') === '1'; } catch (e) { return false; } })(), defaultAudioCodec: 'mp4a.40.2', maxBufferLength: 30, maxMaxBufferLength: 60, backBufferLength: 30, enableWorker: true, lowLatencyMode: false, fragLoadingMaxRetry: 3, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 2, startPosition: P.resumeAt > 3 ? P.resumeAt : -1 });
        P.hls = hls; var mediaRecovered = false;
        hls.on(Hls.Events.ERROR, function (ev, d) {
          if (!d.fatal) return;
          if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) { mediaRecovered = true; hls.recoverMediaError(); return; }
          fail('HLS ' + d.details);
        });
        hls.loadSource(url); hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, function () { video.play().catch(function () { }); });
      } else if (src.type === 'flv') {
        (window.mpegts ? Promise.resolve() : loadScript('/static/mpegts.js')).then(function () {
          if (token !== P.playToken) return;
          if (!mpegts.isSupported()) { video.src = url; return; }
          var p = mpegts.createPlayer({ type: 'flv', url: new URL(url, location.href).href, isLive: false }, { enableStashBuffer: true });
          P.mts = p; p.attachMediaElement(video); p.load(); p.on(mpegts.Events.ERROR, function (t, d) { fail('FLV ' + d); });
          video.play().catch(function () { });
        }).catch(function () { fail('flv 播放器加载失败'); });
      } else {
        video.src = url;
        video.play().catch(function () { });
      }
      // stall watchdog
      var lastPos = -1, stallSince = 0, waits = [];
      video.onwaiting = function () { if (!started || token !== P.playToken) return; var t = Date.now(); waits.push(t); waits = waits.filter(function (x) { return t - x < 90000; }); if (waits.length >= 5) { waits = []; fail('频繁卡顿'); } };
      var check = function () {
        if (token !== P.playToken) return;
        if (!video.paused && started) {
          if (video.currentTime === lastPos) { if (!stallSince) stallSince = Date.now(); else if (Date.now() - stallSince > 12000) { fail('播放卡住'); return; } }
          else { stallSince = 0; lastPos = video.currentTime; }
        } else stallSince = 0;
        P.stallTimer = setTimeout(check, 2000);
      };
      P.stallTimer = setTimeout(check, 2000);
    }
    video.addEventListener('timeupdate', function () { saveHistory(false); });
    video.addEventListener('pause', function () { saveHistory(true); });
    video.addEventListener('ended', function () { saveHistory(true); if (nextEp()) toast('自动播放下一集'); });

    // a direct-play failure makes the next plays go via the NAS for 20 minutes only (it used to stick forever)
    // per source now: one site failing direct used to push every source (and the source race) through the relay
    function proxyMap() { try { localStorage.removeItem('tvb_proxy'); var m = JSON.parse(localStorage.getItem('tvb_proxy2') || '{}'), n = Date.now(), k; for (k in m) if (n - m[k] > 20 * 60e3) delete m[k]; return m; } catch (e) { return {}; } }
    function proxySet(site) { try { var m = proxyMap(); m[site] = Date.now(); localStorage.setItem('tvb_proxy2', JSON.stringify(m)); } catch (e) { } }
    function proxyClear(site) { try { var m = proxyMap(); if (m[site]) { delete m[site]; localStorage.setItem('tvb_proxy2', JSON.stringify(m)); } } catch (e) { } }
    function preferProxy(site) { return !!proxyMap()[site]; }
    function playCurrent(startAt, reason, forceProxy) {
      var line = P.lines[P.li], ep = line.eps[P.ei];
      var token = ++P.playToken;
      msg('解析中…'); $('#srcinfo').textContent = siteName(P.site) + ' · ' + line.flag;
      $('#lineInfo').textContent = '';
      var t0 = Date.now();
      return api('/api/play?' + playQs(P.site, line.flag, ep.url, forceProxy), { timeout: 50000 }).then(function (src) {
        if (token !== P.playToken) return;
        var gq = src.res ? resQ(src.res.w, src.res.h) : resGet(P.site, line.flag);
        if (src.res) resSet(P.site, line.flag, gq);
        qbShow(src, gq || 0);
        var cs = srcCur(); if (cs) { cs.ok = true; cs.dir = dirOf(src); cs.ms = Date.now() - t0; if (gq) cs.q = gq; cs.bw = 0; renderSrcs(); }
        if (!P.probedLines) { P.probedLines = 1; setTimeout(function () { if (!P.destroyed) { probeLines(); probeSrcs(); } }, 8000); }
        $('#lineInfo').textContent = [src.mode === 'direct' ? '直连' : src.mode === 'proxy-m3u8' ? '代理索引' : src.mode === 'proxy' ? '代理' : src.mode === 'sniff' ? '嗅探' : '', (Date.now() - t0) + 'ms'].filter(Boolean).join(' · ');
        msg('加载视频…');
        attach(src, startAt, token);
      }).catch(function (e) { if (token === P.playToken) onFail(e.message); });
    }

    // ---- automatic failover (OK影视-style) ----
    function onFail(why) {
      if (P.switching || P.destroyed) return;
      var pos = video.currentTime > 3 ? video.currentTime : P.resumeAt;
      var curKey = P.site + '|' + P.id + '|' + P.lines[P.li].flag;
      P.tried[curKey] = 'bad';
      destroyEngine();
      // 1) next untried line of the same title
      for (var k = 1; k <= P.lines.length; k++) {
        var i = (P.li + k) % P.lines.length;
        if (!P.tried[P.site + '|' + P.id + '|' + P.lines[i].flag]) {
          var epName = curEpName();
          toast('线路「' + P.lines[P.li].flag + '」失败（' + why + '），切换到「' + P.lines[i].flag + '」');
          P.li = i; P.ei = epMatch(P.lines[i].eps, epName, P.ei); renderLines();
          playCurrent(pos);
          return;
        }
      }
      // 2) same title on other sites
      var cs = srcCur(); if (cs) cs.ok = false;
      crossSiteSwitch(pos, why);
    }

    function crossSiteSwitch(pos, why) {
      if (!P.vod) { msg('播放失败：' + why); return; }
      P.switching = true;
      var name = P.dbName || P.vod.vod_name, nt = normTitle(name), year = String(P.dbYear || P.vod.vod_year || '').slice(0, 4), epCount = P.lines[P.li].eps.length, epName = curEpName(), epIdx = P.ei;
      toast('本站全部线路失败，正在其他站点搜索「' + name + '」…', 4000);
      msg('换源中…');
      var cands = (P.cands || []).filter(function (c) { return !(c.site === P.site && String(c.v.vod_id) === String(P.id)); }), done = false, busy = false; P.cands = null;
      function score(v) {
        var s = 0; if (normTitle(v.vod_name) === nt) s += 100; else if (normTitle(v.vod_name).indexOf(nt) >= 0) s += 30; else return -1;
        if (year && String(v.vod_year || '').slice(0, 4) === year) s += 20;
        return s;
      }
      var es = streamSearch(name, function (r) {
        (r.list || []).forEach(function (v) {
          var sc = score(v); if (sc < 0) return;
          if (r.site === P.site && String(v.vod_id) === String(P.id)) return;
          cands.push({ site: r.site, siteName: r.siteName, v: v, s: sc - (state.siteMap[r.site] ? state.siteMap[r.site].score / 1000 : 0) });
        });
        cands.sort(function (a, b) { return b.s - a.s; });
        pump();
      }, function () { done = true; pump(); }, P.repo);
      function pump() {
        if (busy || P.destroyed) return;
        var c = cands.shift();
        if (!c) { if (done) { P.switching = false; msg('所有来源均播放失败：' + why); toast('换源失败，可手动选择线路或稍后重试', 5000); } return; }
        busy = true;
        loadDetail(c.site, c.v.vod_id).then(function (d) {
          // prefer similar episode count
          var lines = d.lines.filter(function (l) { return !P.tried[c.site + '|' + c.v.vod_id + '|' + l.flag]; });
          if (!lines.length) throw new Error('no lines');
          if (epCount > 1 && lines.every(function (l) { return l.eps.length <= epIdx; })) throw new Error('集数不足');
          es.close();
          P.site = c.site; P.id = String(c.v.vod_id); P.vod = d.vod; P.lines = d.lines;
          P.li = d.lines.indexOf(lines[0]); P.ei = epMatch(lines[0].eps, epName, epIdx);
          P.switching = false;
          toast('已切换到「' + c.siteName + '」继续播放');
          renderInfo(); renderLines(); favState();
          playCurrent(pos);
        }).catch(function () { busy = false; pump(); });
      }
    }

    // manual source switch panel
    var oldSwitchPanel = function () { // replaced by the sources list (user 2026-11-03); kept unused
      var panel = $('#srcPanel');
      if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
      if (!P.vod) return;
      panel.classList.remove('hidden');
      panel.innerHTML = '<div class="muted">正在各站点搜索「' + esc(P.vod.vod_name) + '」…</div>';
      var nt = normTitle(P.vod.vod_name), items = [];
      var es = streamSearch(P.vod.vod_name, function (r) {
        (r.list || []).forEach(function (v) { if (normTitle(v.vod_name).indexOf(nt) >= 0 || nt.indexOf(normTitle(v.vod_name)) >= 0) items.push({ site: r.site, siteName: r.siteName, v: v, ms: r.ms }); });
        panel.innerHTML = items.map(function (x, i) { return '<div class="srcitem" data-i="' + i + '"><span>' + esc(x.v.vod_name) + ' <span class="muted">' + esc(x.v.vod_remarks || '') + ' ' + esc(x.v.vod_year || '') + '</span></span><span class="muted">' + esc(x.siteName) + ' · ' + x.ms + 'ms</span></div>'; }).join('') || '<div class="muted">搜索中…</div>';
      }, function () { if (!items.length) panel.innerHTML = '<div class="muted">没有找到其他来源</div>'; }, P.repo);
      panel.onclick = function (e) {
        var it = e.target.closest('.srcitem'); if (!it) return;
        var x = items[Number(it.getAttribute('data-i'))]; es.close(); panel.classList.add('hidden');
        var pos = video.currentTime, epName = curEpName(), epIdx = P.ei;
        msg('加载详情…');
        loadDetail(x.site, x.v.vod_id).then(function (d) {
          P.site = x.site; P.id = String(x.v.vod_id); P.vod = d.vod; P.lines = d.lines; P.li = 0; P.ei = epMatch(d.lines[0].eps, epName, epIdx);
          renderInfo(); renderLines(); favState(); playCurrent(pos > 5 ? pos : 0);
        }).catch(function (er) { toast('该来源打开失败：' + er.message); msg(''); });
      };
      var old = cleanup; cleanup = function () { es.close(); old && old(); };
    };

    // ---- boot ----
    if (q.auto) { P.dbName = q.name; P.dbYear = q.year; autoFind(); }
    else Promise.all([loadDetail(P.site, P.id), api('/api/history/one?' + qs({ site: P.repo + '|' + P.site, id: P.id })).catch(function () { return {}; })]).then(function (r) {
      if (P.destroyed) return;
      P.vod = r[0].vod; P.lines = r[0].lines;
      var h = r[1] && r[1].item, start = 0;
      if (h) {
        var li = P.lines.findIndex ? P.lines.findIndex(function (l) { return l.flag === h.flag; }) : -1;
        if (li >= 0) P.li = li;
        P.ei = epMatch(P.lines[P.li].eps, h.ep_name, h.ep_index);
        start = h.position || 0;
        if (start > 5) toast('从 ' + fmtTime(start) + ' 继续播放（' + (h.ep_name || '') + '）');
      }
      renderInfo(); renderLines(); favState();
      playCurrent(start);
    }).catch(function (e) {
      $('#eps').innerHTML = '<div class="empty">详情加载失败：' + esc(e.message) + '</div>';
      // detail failed: try the same title elsewhere
      if (q.name) { P.vod = { vod_name: q.name, vod_pic: q.pic }; P.lines = [{ flag: '-', eps: [{ name: '', url: '' }] }]; crossSiteSwitch(0, e.message); }
    });

    // douban pick: search the preferred repo, race the best-matching sites, play whichever answers first
    function autoFind() {
      var name = q.name || '', nt = normTitle(name), year = String(q.year || '').slice(0, 4);
      var repoName = (state.repos.filter(function (r) { return r.id === P.repo; })[0] || {}).name || '';
      if (q.pic) $('#dbg').style.backgroundImage = 'url("' + picUrl(q.pic).replace(/"/g, '%22') + '")';
      $('#info').innerHTML = (q.pic ? '<div class="iposter">' + img(q.pic) + '</div>' : '') + '<div class="itxt"><h1>' + esc(name) + '</h1><div class="autofind" id="af"><span class="spin"></span>正在「' + esc(repoName) + '」里查找最快的片源…</div></div>';
      msg('查找片源…'); $('#eps').innerHTML = '<div class="muted">查找中…</div>';
      var cands = P.srcs, done = false, racing = false, raceTimer = null, sitesN = 0, adopted = false, relayed = [], rounds = 0;
      function score(v) {
        var t = normTitle(v.vod_name), s;
        if (t === nt) s = 100; else if (t.indexOf(nt) === 0 && t.length - nt.length <= 3) s = 60; else return -1;
        var vy = String(v.vod_year || '').slice(0, 4); if (year && vy) s += vy === year ? 20 : -40;
        return s;
      }
      function af(t) { var e = $('#af'); if (e) e.textContent = t; }
      var hist = api('/api/history').then(function (j) { return (j.list || []).filter(function (h) { return normTitle(h.vod_name) === nt && h.site.split('|')[0] === String(P.repo); })[0]; }).catch(function () { return null; });
      var es = streamSearch(name, function (r) {
        sitesN++;
        (r.list || []).forEach(function (v) { var sc = score(v); if (sc >= 0) cands.push({ site: r.site, siteName: r.siteName, v: v, s: sc, sms: r.ms }); });
        af('已搜索 ' + sitesN + ' 个站点，匹配 ' + cands.length + ' 个片源…');
        if (!raceTimer && cands.some(function (c) { return c.s >= 100; })) raceTimer = setTimeout(race, 1500);
        if (cands.length >= 8 && !racing) race();
      }, function () { done = true; race(); }, P.repo);
      P.afStop = function () { es.close(); clearTimeout(raceTimer); };
      function pickRelayed() { var pool = relayed.slice(); relayed = []; pool.sort(function (a, b) { return (b.c.s - a.c.s) || (tier(b.q) - tier(a.q)) || ((a.ms || 9e9) - (b.ms || 9e9)); }); hist.then(function (h) { adopt(pool[0].c, pool[0].d, h, pool[0]); }); }
      function tier(q) { return !q ? 1 : q >= (DEV.mobile ? 680 : 980) ? 2 : 0; }
      function adopt(c, d, h, pr) {
        if (adopted || P.destroyed) return; adopted = true; es.close(); clearTimeout(raceTimer);
        P.site = c.site; P.id = String(c.v.vod_id); P.vod = d.vod; P.lines = d.lines; P.li = 0; P.ei = 0;
        if (!P.vod.vod_pic) P.vod.vod_pic = q.pic;
        P.cands = cands.filter(function (x) { return x !== c; });
        var start = 0;
        if (h) { // resume the episode and position by title, whichever source plays it
          if (h.site === P.repo + '|' + P.site && h.vod_id === P.id) { var li = -1; P.lines.forEach(function (l, i) { if (li < 0 && l.flag === h.flag) li = i; }); if (li >= 0) P.li = li; }
          P.ei = epMatch(P.lines[P.li].eps, h.ep_name, h.ep_index); start = h.position || 0;
          if (start > 5) toast('从 ' + fmtTime(start) + ' 继续播放（' + (h.ep_name || '') + '）');
        }
        P.probedLines = 0;
        var rq = pr && pr.q; toast('片源：' + c.siteName + (rq ? ' · ' + resLabel(rq) : '') + (DEV.mobile ? '（手机优先 720P–1080P）' : rq ? '（电脑优先高清）' : ''));
        renderInfo(); renderLines(); favState(); playCurrent(start);
      }
      function race() {
        if (racing || adopted) return; racing = true;
        hist.then(function (h) {
          // no source memory (user 2026-11-03): every play races for the fastest source that meets the resolution bar
          cands.sort(function (a, b) { return (b.s - a.s) || ((state.siteMap[a.site] ? state.siteMap[a.site].score : 3000) - (state.siteMap[b.site] ? state.siteMap[b.site].score : 3000)); });
          var batch = cands.filter(function (c) { return !c.tried; }).slice(0, 4);
          if (!batch.length) {
            racing = false;
            if (relayed.length && (done || rounds >= 3)) { pickRelayed(); return; } // no direct source anywhere: fall back to the NAS-relayed best
            if (done && q.hsite && q.hid) { go('/detail', { repo: P.repo, site: q.hsite, id: q.hid, name: name, pic: q.pic || '' }); return; } // title not found by search: open the saved source
            if (done) { msg('没有找到可播放的片源'); af('在「' + repoName + '」里没有找到「' + name + '」，可以换一个首选源或手动搜索。'); $('#eps').innerHTML = '<div class="empty"><a href="#/search?' + qs({ wd: name }) + '">手动搜索「' + esc(name) + '」</a></div>'; }
            return;
          }
          af('正在比较 ' + batch.map(function (c) { return c.siteName; }).join('、') + ' …');
          var pend = batch.length, got = [], fin = false, timer = null;
          function maybe() { if (!fin && !adopted && pend === 0 && !got.some(function (g) { return !g.done; })) finish(); }
          function finish() {
            if (fin || adopted) return; fin = true; clearTimeout(timer);
            if (!got.length) { racing = false; race(); return; }
            var ok = got.filter(function (g) { return g.ok; }), pool = ok.length ? ok : got;
            rounds++;
            // nothing in this batch plays direct: keep them as backups and race the next batch, unless we've looked enough
            if (!pool.some(function (g) { return g.dir; }) && rounds < 3 && cands.some(function (c) { return !c.tried; })) {
              relayed = relayed.concat(ok); af('这一批都需要中转，继续找能直连的…'); racing = false; race(); return;
            }
            pool = pool.concat(relayed);
            // title match first; then direct-play sources before NAS-relayed ones (user 2026-11-03); then sources meeting this device's resolution bar, fastest first; then unknown resolution by speed; then the rest by resolution
            pool.sort(function (a, b) { return (b.c.s - a.c.s) || ((b.dir || 0) - (a.dir || 0)) || (tier(b.q) - tier(a.q)) || (tier(a.q) === 0 ? b.q - a.q : 0) || ((a.ms || 9e9) - (b.ms || 9e9)); });
            window.__tvbRace = got.map(function (g) { return g.c.siteName + ':' + (g.ok ? (g.q || '?') + '/' + g.ms + 'ms' : g.ok === false ? 'fail' : 'pending'); });
            adopt(pool[0].c, pool[0].d, h, pool[0]);
          }
          batch.forEach(function (c) {
            c.tried = true;
            loadDetail(c.site, c.v.vod_id).then(function (d) {
              if (adopted || fin) return;

              var g = { c: c, d: d, done: false }; got.push(g); c.d = d;
              if (!timer) timer = setTimeout(finish, 4000);
              var l = d.lines && d.lines[0], ep = l && l.eps[0];
              if (!ep || !ep.url) { g.done = true; return maybe(); }
              var t0 = Date.now();
              api('/api/play?' + playQs(c.site, l.flag, ep.url), { timeout: 6000 }).then(function (r) {
                g.ok = true; g.ms = Date.now() - t0; g.dir = r.mode === 'direct' ? 2 : (r.mode === 'proxy-m3u8' && !r.sp) || r.mode === 'local' ? 1 : 0; g.q = r.res ? resQ(r.res.w, r.res.h) : resGet(c.site, l.flag);
                if (r.res) resSet(c.site, l.flag, g.q);
                c.ok = true; c.ms = g.ms; c.dir = g.dir; c.q = g.q;
              }).catch(function () { g.ok = false; c.ok = false; }).then(function () { g.done = true; af('正在比较清晰度…'); maybe(); });
            }).catch(function () { }).then(function () { pend--; maybe(); });
          });
        });
      }
    }

    cleanup = function () {
      P.destroyed = true; document.body.classList.remove('watching'); if (P.afStop) P.afStop(); saveHistory(true); destroyEngine();
      document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide);
    };
  }

  // ---------------- boot ----------------
  function init() {
    $('#menuUser').textContent = state.user ? '当前用户：' + state.user.username : '';
    var hp = parseHash().path, fast = hp === '/' || hp === '/home' || hp === '/cat' || hp === '';
    if (fast) route(); // douban home/category don't need the repo list
    loadRepos().catch(function (e) { toast(e.message); }).then(function () { if (!fast) route(); });
  }
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.addEventListener('hashchange', function () {
    if (document.startViewTransition && !reduceMotion && !document.hidden) {
      try { document.startViewTransition(function () { route(); }); return; } catch (e) { }
    }
    route();
  });
  api('/api/me').then(function (j) {
    if (!j.user) { showLogin(); return; }
    state.user = j.user; init();
  }).catch(function (e) { app.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
})();
