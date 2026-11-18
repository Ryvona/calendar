// ひびカレンダー: Windows 11 Widgets Board (PWA widgets).
// Loaded from sw.js with importScripts('./sw-widgets.js'). Everything here is self-contained:
// it reads the app's IndexedDB (ryvona-calendar / kv / 'data', a JSON string of DB),
// expands repeating events the same way index.html does (occs / endShow / occCmp, ported),
// and pushes Adaptive Card template + data to the widgets declared in manifest.webmanifest.
// Refresh triggers: widgetinstall, widgetresume, activate, periodicsync (tag = widget tag),
// and a message {type: 'widgets-refresh'} posted by the page after each save.
// Browsers without self.widgets (everything except Edge on Windows 11) ignore all of this.
'use strict';
(() => {
  const W_CACHE = 'hibi-widgets-v1'; // not 'hibi-cal-*', so sw.js activate never deletes it
  const TAGS = ['today', 'week'];
  const OPEN_URL = './', ADD_URL = './?a=new';

  /* ---- date helpers (same as index.html) ---- */
  const pad = n => String(n).padStart(2, '0');
  const DAY = 864e5;
  const dnYMD = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / DAY);
  const dn = s => { const [y, m, d] = s.split('-').map(Number); return dnYMD(y, m, d); };
  const ymd = n => { const t = new Date(n * DAY); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
  const ds = n => { const o = ymd(n); return o.y + '-' + pad(o.m) + '-' + pad(o.d); };
  const wd = n => ((n + 4) % 7 + 7) % 7;
  const todayDn = () => { const t = new Date(); return dnYMD(t.getFullYear(), t.getMonth() + 1, t.getDate()); };
  const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const WD = '日月火水木金土';
  const tmin = s => { if (!s) return 0; const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
  const md = n => { const o = ymd(n); return o.m + '月' + o.d + '日'; };
  const mdw = n => md(n) + '（' + WD[wd(n)] + '）';

  /* ---- Japanese holidays (ported from index.html, 2000-2099) ---- */
  const HC = {};
  const nthMon = (y, m, n) => { const f = dnYMD(y, m, 1); return f + ((1 - wd(f) + 7) % 7) + (n - 1) * 7; };
  const equinox = (y, base) => Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  function holidays(y) {
    if (HC[y]) return HC[y];
    const H = new Map(), add = (m, d, n) => H.set(dnYMD(y, m, d), n);
    add(1, 1, '元日');
    H.set(y >= 2000 ? nthMon(y, 1, 2) : dnYMD(y, 1, 15), '成人の日');
    add(2, 11, '建国記念の日');
    if (y >= 2020) add(2, 23, '天皇誕生日');
    add(3, equinox(y, 20.8431), '春分の日');
    add(4, 29, y >= 2007 ? '昭和の日' : 'みどりの日');
    add(5, 3, '憲法記念日'); if (y >= 2007) add(5, 4, 'みどりの日'); add(5, 5, 'こどもの日');
    if (y === 2020) add(7, 23, '海の日'); else if (y === 2021) add(7, 22, '海の日'); else if (y >= 2003) H.set(nthMon(y, 7, 3), '海の日'); else if (y >= 1996) add(7, 20, '海の日');
    if (y === 2020) add(8, 10, '山の日'); else if (y === 2021) add(8, 8, '山の日'); else if (y >= 2016) add(8, 11, '山の日');
    H.set(y >= 2003 ? nthMon(y, 9, 3) : dnYMD(y, 9, 15), '敬老の日');
    add(9, equinox(y, 23.2488), '秋分の日');
    const sp = y >= 2020 ? 'スポーツの日' : '体育の日';
    if (y === 2020) add(7, 24, sp); else if (y === 2021) add(7, 23, sp); else H.set(y >= 2000 ? nthMon(y, 10, 2) : dnYMD(y, 10, 10), sp);
    add(11, 3, '文化の日'); add(11, 23, '勤労感謝の日');
    if (y >= 1989 && y <= 2018) add(12, 23, '天皇誕生日');
    if (y === 2019) { add(5, 1, '天皇の即位の日'); add(10, 22, '即位礼正殿の儀の行われる日'); }
    const base = [...H.keys()].sort((a, b) => a - b);
    for (const k of base) if (H.has(k + 2) && !H.has(k + 1) && wd(k + 1) !== 0) H.set(k + 1, '国民の休日');
    for (const k of [...H.keys()].sort((a, b) => a - b)) if (wd(k) === 0 && H.get(k) !== '振替休日') { let d = k + 1; while (H.has(d)) d++; H.set(d, '振替休日'); }
    return HC[y] = H;
  }
  const holName = n => holidays(ymd(n).y).get(n) || '';

  /* ---- events & repeats (ported from index.html; keep in step with occs/endShow/occCmp there) ---- */
  const durDays = e => dn(e.ed) - dn(e.sd);
  function occs(e, a, b) {
    const s = dn(e.sd), dur = durDays(e), r = e.rep, out = [];
    const lo = a - dur, hi = b, until = r && r.until ? dn(r.until) : Infinity, ex = e.ex || [];
    const top = Math.min(hi, until);
    const push = d => { if (d >= lo && d <= top && d >= s && !ex.includes(ds(d))) out.push(d); };
    if (!r || !r.f) { push(s); return out; }
    const iv = Math.max(1, +r.i || 1);
    if (r.f === 'd') { const k = Math.max(0, Math.ceil((lo - s) / iv)); for (let d = s + k * iv; d <= top; d += iv) push(d); }
    else if (r.f === 'w' || r.f === 'wd') {
      const days = r.f === 'wd' ? [1, 2, 3, 4, 5] : (r.wd && r.wd.length ? r.wd : [wd(s)]), w0 = s - wd(s);
      for (let d = Math.max(lo, s); d <= top; d++) { if (!days.includes(wd(d))) continue; if (r.f === 'w' && Math.floor((d - wd(d) - w0) / 7) % iv) continue; push(d); }
    } else if (r.f === 'm' || r.f === 'y') {
      const o = ymd(s), L = ymd(Math.max(lo, s)), step = r.f === 'm' ? iv : iv * 12, m0 = o.y * 12 + o.m - 1;
      let k = Math.max(0, Math.floor((L.y * 12 + L.m - 1 - m0) / step) - 1);
      for (; ; k++) {
        const mi = m0 + k * step, y = Math.floor(mi / 12), m = mi % 12 + 1;
        if (dnYMD(y, m, 1) > top) break;
        if (o.d <= dim(y, m)) push(dnYMD(y, m, o.d));
      }
    }
    return out;
  }
  const endShow = (e, s) => s + durDays(e) - (!e.all && durDays(e) > 0 && tmin(e.et) === 0 ? 1 : 0);
  const occCmp = (x, y) => (y.e.all - x.e.all) || (x.e.all ? (y.en - y.s) - (x.en - x.s) : 0) || (x.s - y.s) || (tmin(x.e.st) - tmin(y.e.st)) || String(x.e.t).localeCompare(y.e.t);
  function byDay(DB, a, b) {
    const on = new Set((DB.cals || []).filter(c => c && c.on).map(c => c.id)), m = new Map();
    for (const e of DB.events || []) {
      if (!e || !on.has(e.cal) || !/^\d{4}-\d\d-\d\d$/.test(e.sd) || !/^\d{4}-\d\d-\d\d$/.test(e.ed)) continue;
      for (const s of occs(e, a, b)) {
        const o = { e, s, en: endShow(e, s) };
        for (let d = Math.max(a, o.s); d <= Math.min(b, o.en); d++) { if (!m.has(d)) m.set(d, []); m.get(d).push(o); }
      }
    }
    for (const l of m.values()) l.sort(occCmp);
    return m;
  }

  /* ---- read the app's data ---- */
  function readDB() {
    return new Promise(res => {
      let r;
      try { r = indexedDB.open('ryvona-calendar'); } catch (e) { res(null); return; }
      // never create the database here: the app's own upgrade must create the 'kv' store
      r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) { } };
      r.onerror = r.onblocked = () => res(null);
      r.onsuccess = () => {
        const d = r.result;
        try {
          if (!d.objectStoreNames.contains('kv')) { d.close(); res(null); return; }
          const q = d.transaction('kv').objectStore('kv').get('data');
          q.onsuccess = () => { d.close(); try { res(q.result ? JSON.parse(q.result) : null); } catch (e) { res(null); } };
          q.onerror = () => { d.close(); res(null); };
        } catch (e) { try { d.close(); } catch (e2) { } res(null); }
      };
    });
  }

  /* ---- data for the cards ---- */
  const now = () => { const t = new Date(); return t.getHours() * 60 + t.getMinutes(); };
  function row(o, d, DB) {
    const e = o.e, dur = durDays(e), multi = o.en > o.s;
    let time, end = '';
    if (e.all) { time = '終日'; if (multi) end = (d - o.s + 1) + '/' + (o.en - o.s + 1) + '日目'; }
    else {
      time = d === o.s ? (e.st || '') : '前日から';
      end = d === o.s + dur ? '〜' + (e.et || '') : '〜翌日';
    }
    let sub = '';
    if (e.kind === 'shift') { const j = (DB.jobs || []).find(x => x.id === e.job); sub = j && j.name ? j.name : 'シフト'; }
    return { time, end, title: String(e.t || '（無題）').slice(0, 60), sub: sub.slice(0, 40) };
  }
  // timed occurrence already over today?
  const isPast = (o, d, t) => !o.e.all && d === t && d === o.s + durDays(o.e) && tmin(o.e.et) <= now();
  const stamp = () => { const t = new Date(); return pad(t.getHours()) + ':' + pad(t.getMinutes()) + ' 更新'; };

  function dataToday(DB) {
    const t = todayDn(), list = DB ? (byDay(DB, t, t).get(t) || []) : [];
    const MAX = 5, rows = list.map(o => row(o, t, DB));
    const hol = holName(t);
    return {
      label: '今日', date: mdw(t), hol, hasHol: !!hol,
      items: rows.slice(0, MAX), count: rows.length, empty: rows.length === 0,
      more: Math.max(0, rows.length - MAX), hasMore: rows.length > MAX,
      emptyText: DB ? '予定はありません' : 'アプリを開くと予定が表示されます',
      updated: stamp(),
    };
  }
  function dataWeek(DB) {
    const t = todayDn(), N = 7, MAXR = 8, days = [];
    const m = DB ? byDay(DB, t, t + N - 1) : new Map();
    let used = 0, total = 0;
    for (let d = t; d < t + N; d++) {
      const l = (m.get(d) || []).filter(o => !isPast(o, d, t));
      total += l.length;
      if (!l.length || used >= MAXR) continue;
      const take = l.slice(0, MAXR - used); used += take.length;
      const hol = holName(d);
      days.push({ head: (d === t ? '今日 ' : d === t + 1 ? '明日 ' : '') + mdw(d) + (hol ? ' ' + hol : ''), weekend: !!hol || wd(d) === 0 || wd(d) === 6, items: take.map(o => row(o, d, DB)) });
    }
    return {
      label: 'これからの予定', range: mdw(t) + '〜' + md(t + N - 1),
      days, empty: days.length === 0, more: Math.max(0, total - used), hasMore: total > used,
      emptyText: DB ? '7日以内の予定はありません' : 'アプリを開くと予定が表示されます',
      updated: stamp(),
    };
  }

  /* ---- templates: cached copy so widgets render offline ---- */
  async function getText(url) {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (r.ok) { const cp = r.clone(); caches.open(W_CACHE).then(c => c.put(url, cp)).catch(() => { }); return await r.text(); }
    } catch (e) { }
    const hit = await caches.match(url, { cacheName: W_CACHE }).catch(() => null);
    return hit ? hit.text() : null;
  }
  const defUrl = (def, k) => new URL(def[k] || def[k === 'msAcTemplate' ? 'ms_ac_template' : k] || '', self.registration.scope).href;

  let busy = null;
  async function refreshAll() {
    if (!self.widgets) return;
    if (busy) return busy.then(() => refreshAll());
    busy = (async () => {
      const DB = await readDB();
      for (const tag of TAGS) {
        try {
          const w = await self.widgets.getByTag(tag);
          if (!w || !w.instances || !w.instances.length) continue;
          await render(w, DB);
        } catch (e) { }
      }
    })().finally(() => { busy = null; });
    return busy;
  }
  async function render(w, DB) {
    const def = w.definition || {}, tag = def.tag;
    const template = await getText(defUrl(def, 'msAcTemplate'));
    if (!template) return;
    if (DB === undefined) DB = await readDB();
    const data = tag === 'week' ? dataWeek(DB) : dataToday(DB);
    await self.widgets.updateByTag(tag, { template, data: JSON.stringify(data) });
  }
  async function periodic(def, on) {
    const ps = self.registration.periodicSync;
    if (!ps || !def || !def.tag) return;
    try {
      const tags = await ps.getTags();
      if (on && !tags.includes(def.tag)) await ps.register(def.tag, { minInterval: (+def.update || 3600) * 1000 });
      if (!on && tags.includes(def.tag)) await ps.unregister(def.tag);
    } catch (e) { } // needs an installed app + permission; the other triggers still work
  }

  self.addEventListener('widgetinstall', e => e.waitUntil((async () => { await periodic(e.widget && e.widget.definition, true); await render(e.widget); })().catch(() => { })));
  self.addEventListener('widgetresume', e => e.waitUntil(render(e.widget).catch(() => { })));
  self.addEventListener('widgetuninstall', e => e.waitUntil((async () => {
    const w = e.widget; if (w && w.instances && w.instances.length <= 1) await periodic(w.definition, false);
  })().catch(() => { })));
  self.addEventListener('widgetclick', e => {
    const url = e.action === 'add' ? ADD_URL : OPEN_URL;
    e.waitUntil(e.action === 'refresh' ? refreshAll() : self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      if (e.action !== 'add') for (const c of cs) if ('focus' in c) return c.focus();
      return self.clients.openWindow(url);
    }));
  });
  self.addEventListener('periodicsync', e => { if (TAGS.includes(e.tag)) e.waitUntil(refreshAll().catch(() => { })); });
  self.addEventListener('activate', e => e.waitUntil(refreshAll().catch(() => { })));
  self.addEventListener('message', e => { if (e.data && e.data.type === 'widgets-refresh') e.waitUntil(refreshAll().catch(() => { })); });

  // for tests: build the widget data without the widgets host
  self.__hibiWidgets = { dataToday, dataWeek, readDB, refreshAll };
})();
