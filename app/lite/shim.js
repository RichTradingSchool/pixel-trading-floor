/* PIXEL TRADING FLOOR 체험판 — 서버 흉내
   app.js·hq.js가 부르는 /api/*를 가로채 LiteEngine·LitePaper로 답하고,
   EventSource('/api/stream')를 이벤트 버스 구독으로 바꾼다. 없는 기능은 "풀버전 전용" 404.
   index.html에서 app.js보다 먼저 로드돼야 한다(build.js가 순서를 보장). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LiteShim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 칩 글자가 그대로 입력칸에 들어가 분석된다 — 한글 이름도 data.js가 바이낸스 무기한 심볼로 바꾼다
  const WATCHLIST = ['BTC', 'ETH', 'SOL', 'TSLA', 'NVDA', '삼성전자', '하이닉스', '금'];
  const FULL_ONLY = 'AI 실제 버전 기능입니다 — 텔레그램 자료실에서 받으세요';
  const LEV_KEY = 'pixel-lite-lev';
  const RUNS_KEY = 'pixel-lite-runs-v1';
  const TRIAL_RUNS = 3;
  const trialDone = (n) => `무료 분석 ${n}회를 모두 썼습니다 — AI 실제 버전은 텔레그램 자료실에서 받으세요`;

  // 무료 분석 횟수 — 모의 포지션이 실제로 열린 분석만 센다(wireQuota). 이 브라우저에 저장(막히면 메모리).
  // 다른 탭(소개 페이지 속 화면 ↔ 단독 화면)과 나눠 쓰도록 매번 저장소를 다시 읽는다.
  function createQuota(opts = {}) {
    const limit = opts.limit > 0 ? Math.round(opts.limit) : TRIAL_RUNS;
    let storage = opts.storage || null;
    let mem = 0;
    const read = () => {
      if (storage) {
        try {
          const v = Number(storage.getItem(RUNS_KEY));
          if (Number.isFinite(v) && v > 0) mem = Math.max(mem, Math.floor(v));
        } catch (_) { storage = null; }
      }
      return mem;
    };
    return {
      limit,
      used: read,
      left: () => Math.max(0, limit - read()),
      use() {
        mem = read() + 1;
        try { if (storage) storage.setItem(RUNS_KEY, String(mem)); } catch (_) { storage = null; }
        return mem;
      },
    };
  }

  // 모의 포지션이 실제로 열린 분석만 센다 — 관망·보류(이미 보유)·시세 오류는 무료 횟수를 쓰지 않는다
  function wireQuota(bus, quota) {
    return bus.subscribe((ev) => { if (ev && ev.type === 'position' && ev.action === 'open') quota.use(); });
  }

  // 레버리지 — 방문자가 고른 값은 저장, 시연 화면(fixedLev)은 늘 같은 배율이고 방문자 설정을 건드리지 않는다
  function createSettings(storage, opts = {}) {
    const ok = (v) => v >= 1 && v <= 125;
    let mem = null;
    return {
      get lev() {
        if (opts.fixedLev) return opts.fixedLev;
        if (mem != null) return mem;
        let v = 20;
        try { const s = storage && storage.getItem(LEV_KEY); if (s) v = Math.round(Number(s)); } catch (_) { /* 저장소 막힘 */ }
        return ok(v) ? v : 20;
      },
      set lev(v) {
        if (opts.fixedLev) return;
        const n = Math.round(Number(v));
        mem = ok(n) ? n : 20;
        try { if (storage) storage.setItem(LEV_KEY, String(mem)); } catch (_) { /* 저장소 막힘 */ }
      },
    };
  }

  function createRouter(ctx) {
    const json = (status, body) => ({ status, body });
    async function route(method, path, body) {
      const p = String(path).split('?')[0];
      if (method === 'GET' && p === '/api/config') {
        return json(200, { ok: true, watchlist: WATCHLIST.slice(), watcher: { enabled: false, intervalSec: 60 }, ui: { sound: true } });
      }
      if (method === 'GET' && p === '/api/tape') {
        let tape = [];
        try { tape = await ctx.data.fetchTape({ fetch: ctx.fetchImpl || undefined }); } catch (_) { tape = []; }
        return json(200, tape);
      }
      if (method === 'GET' && p === '/api/positions') return json(200, ctx.paper.snapshot());
      if (method === 'POST' && p === '/api/positions/close') {
        const id = body && body.id;
        const pos = id ? ctx.paper.getOpen(id) : null;
        if (!pos) return json(404, { ok: false, error: '열린 포지션을 찾지 못했습니다' });
        let price = pos.lastPrice;
        try { price = await ctx.data.fetchPrice(pos.symbol, { fetch: ctx.fetchImpl || undefined, axis: pos.axis }); } catch (_) { /* 마지막 평가가로 */ }
        const done = ctx.paper.closeManual(id, price);
        ctx.bus.emit({ type: 'position', action: 'close', position: done });
        return json(200, { ok: true, position: done });
      }
      if (method === 'GET' && p === '/api/autopilot') {
        return json(200, {
          ok: true,
          config: { enabled: false, ai: false, intervalMin: 30, mode: 'scalp', model: 'rule', maxOpen: 3, symbols: [], settle: true, reports: true, officeLife: true },
          risk: { leverage: ctx.settings.lev, maintenanceMarginPct: 0.5, feePct: 0 },
          running: ctx.engine.isRunning(), nextRunAt: null, lastRun: null, lastSkip: null, cyclesToday: 0, estCallsPerHour: 0, callsPerRun: 0,
        });
      }
      if (method === 'POST' && p === '/api/analyze') {
        if (ctx.engine.isRunning()) return json(409, { ok: false, error: '이미 분석이 진행 중입니다.' });
        if (ctx.quota && ctx.quota.left() <= 0) {
          // app.js는 2xx가 아니면 "요청 실패 (코드)" 토스트만 띄운다 — 조용히 받고 안내 창은 ui.js가 이 신호로 연다
          ctx.bus.emit({ type: 'lite:limit', limit: ctx.quota.limit });
          return json(202, { ok: false, code: 'TRIAL_LIMIT', error: trialDone(ctx.quota.limit) });
        }
        const b = body || {};
        const lev = Math.round(Number(b.leverage));
        if (lev >= 1 && lev <= 125) ctx.settings.lev = lev;
        ctx.engine.run(b.symbol, { mode: b.mode, lev: ctx.settings.lev }).catch(() => {});
        return json(202, { ok: true });
      }
      return json(404, { ok: false, error: FULL_ONLY });
    }
    return { route };
  }

  function install(win, ctx) {
    const origFetch = win.fetch.bind(win);
    ctx.fetchImpl = origFetch;
    const router = createRouter(ctx);
    const here = new URL(win.location.href);
    const ours = (u) => u.origin === here.origin
      && (u.pathname.startsWith('/api/') || u.pathname === '/reports' || u.pathname.startsWith('/reports/') || u.pathname === '/stats');

    win.fetch = async function liteFetch(input, init) {
      const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
      let u = null;
      try { u = new URL(url, win.location.href); } catch (_) { u = null; }
      if (!u || !ours(u)) return origFetch(input, init);
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      let body = null;
      if (init && typeof init.body === 'string') {
        try { body = JSON.parse(init.body); } catch (_) { body = null; }
      }
      const r = await router.route(method, u.pathname + u.search, body);
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    };

    const OrigES = win.EventSource;
    function LiteEventSource(url) {
      let u = null;
      try { u = new URL(url, win.location.href); } catch (_) { u = null; }
      if (!(u && u.origin === here.origin && u.pathname === '/api/stream') && OrigES) return new OrigES(url);
      this.url = String(url);
      this.readyState = 1;
      this.onmessage = null;
      this.onerror = null;
      this.onopen = null;
      this._listeners = [];
      const self = this;
      this._off = ctx.bus.subscribe((ev) => {
        if (self.readyState !== 1) return;
        const msg = { data: JSON.stringify(ev) };
        if (typeof self.onmessage === 'function') self.onmessage(msg);
        self._listeners.forEach((fn) => fn(msg));
      });
    }
    LiteEventSource.prototype.addEventListener = function (type, fn) { if (type === 'message') this._listeners.push(fn); };
    LiteEventSource.prototype.removeEventListener = function (type, fn) { this._listeners = this._listeners.filter((x) => x !== fn); };
    LiteEventSource.prototype.close = function () { this.readyState = 2; if (this._off) this._off(); };
    win.EventSource = LiteEventSource;

    async function applyCandles(symbol, candles) {
      const done = ctx.paper.settle(symbol, candles);
      for (const p of done) ctx.bus.emit({ type: 'position', action: 'close', position: p });
      return done;
    }
    let ticking = false;
    async function settleTick() {
      if (ticking) return;
      ticking = true;
      try {
        for (const s of ctx.paper.openSymbols()) {
          try {
            const candles = await ctx.data.fetchMinuteCandles(s.symbol, s.from, { fetch: origFetch, axis: s.axis });
            await applyCandles(s.symbol, candles);
          } catch (_) { /* 잠깐 끊기면 다음 틱에 */ }
        }
      } finally {
        ticking = false;
      }
    }
    return { applyCandles, settleTick, router };
  }

  // 브라우저 자동 부팅
  function boot(win) {
    const kiosk = new URLSearchParams(win.location.search).get('kiosk') === '1';
    let storage = null;
    try { storage = win.localStorage; } catch (_) { storage = null; }
    // 데모 버전은 100배 고정(대표 결정 2026-10-01: 빨리 체결돼야 재밌다) — 시연 화면도 같다
    const settings = createSettings(storage, { fixedLev: win.LiteBrain ? win.LiteBrain.RULES.defaultLev : 100 });
    const bus = win.LiteEngine.createBus();
    // 소개 페이지 시연 화면은 방문자 계좌를 건드리지 않게 메모리 계좌를 쓴다
    const paper = win.LitePaper.create({ storage: kiosk ? null : storage });
    // 시연 화면은 방문자의 무료 분석 횟수를 쓰지 않는다
    // 설정이 0이면 횟수 제한 없음(대표 결정 2026-10-01) — quota가 null이면 ui.js도 횟수·안내 창을 만들지 않는다
    const cfgRuns = win.LITE_CONFIG && Number.isFinite(win.LITE_CONFIG.trialRuns) ? win.LITE_CONFIG.trialRuns : TRIAL_RUNS;
    const quota = kiosk || cfgRuns <= 0 ? null : createQuota({ storage, limit: cfgRuns });
    if (quota) wireQuota(bus, quota);
    const ctx = { bus, paper, data: win.LiteData, settings, engine: null, fetchImpl: null, quota };
    ctx.engine = win.LiteEngine.createEngine({
      bus, paper,
      data: { resolveSymbol: win.LiteData.resolveSymbol, fetchSnapshot: (sym) => win.LiteData.fetchSnapshot(sym, { fetch: ctx.fetchImpl }) },
    });
    const api = install(win, ctx);
    if (kiosk) {
      const go = () => { if (!ctx.engine.isRunning()) ctx.engine.run('BTC', { mode: 'scalp', lev: settings.lev, kiosk: true }).catch(() => {}); };
      win.setTimeout(go, 3000); // 화면 코드가 접속 직후 2.5초 동안의 이벤트는 연출을 건너뛴다
      win.setInterval(go, 90000);
    } else {
      win.setTimeout(api.settleTick, 1500);
      win.setInterval(api.settleTick, 10000);
    }
    win.LITE = { bus, engine: ctx.engine, paper, data: win.LiteData, settings, applyCandles: api.applyCandles, kiosk, quota };
  }

  if (typeof window !== 'undefined' && window.document && window.LiteEngine && !window.LITE_NO_BOOT) boot(window);

  return { WATCHLIST, FULL_ONLY, RUNS_KEY, TRIAL_RUNS, createQuota, wireQuota, createSettings, createRouter, install, boot };
});
