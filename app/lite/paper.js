/* PIXEL TRADING FLOOR 체험판 — 모의 계좌 (이 브라우저에만 저장, 실주문 없음)
   응답 모양은 서버 /api/positions({summary, open, closed, account, trades})와 같다 — app.js·hq.js가 그대로 읽는다.
   정산은 1분봉 고가·저가로: 같은 봉에서 손실 쪽과 목표를 함께 건드리면 손실로 본다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LitePaper = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEY = 'pixel-lite-paper-v1';
  const MIN = 60000;
  // 데모 버전은 수수료 없이(대표 결정 2026-10-01) — 실제 거래소처럼 계산하려면 config.feePct(편도 %)
  const DEFAULTS = Object.freeze({ start: 10000, marginPct: 10, feePct: 0, maxOpen: 3, holdMs: 24 * 3600000 });
  const r2 = (n) => Math.round(n * 100) / 100;
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  function create(opts = {}) {
    const cfg = { ...DEFAULTS, ...(opts.config || {}) };
    const now = opts.now || (() => Date.now());
    let storage = opts.storage || null;
    let raw = null;
    if (storage) {
      try { raw = storage.getItem(KEY); } catch (_) { storage = null; }
    }
    if (storage) { // 쓰기까지 되는지 확인 — 막혔으면 메모리로만 돈다
      try {
        storage.setItem(KEY + ':probe', '1');
        storage.removeItem(KEY + ':probe');
      } catch (_) { storage = null; }
    }

    function fresh() {
      const t = now();
      return { v: 1, start: cfg.start, balance: cfg.start, createdAt: t, seq: 0, open: [], closed: [], trades: [], curve: [{ t, b: cfg.start }] };
    }
    function valid(s) {
      return !!s && s.v === 1 && Number.isFinite(s.balance) && Number.isFinite(s.start)
        && ['open', 'closed', 'trades', 'curve'].every((k) => Array.isArray(s[k]));
    }
    let state = null;
    try { state = raw ? JSON.parse(raw) : null; } catch (_) { state = null; }
    if (!valid(state)) state = fresh();
    let lastRaw = raw; // 이 창이 마지막으로 읽거나 쓴 저장값

    function save() {
      if (!storage) return;
      try {
        const s = JSON.stringify(state);
        storage.setItem(KEY, s);
        lastRaw = s;
      } catch (_) { storage = null; }
    }

    // 같은 브라우저의 다른 창(소개 페이지 속 화면 ↔ 단독 화면)이 계좌를 바꿨으면 먼저 그걸 읽는다
    // — 안 그러면 이 창의 옛 계좌가 다음 저장에서 상대 창의 포지션·초기화를 덮어쓴다
    function sync() {
      if (!storage) return;
      let cur = null;
      try { cur = storage.getItem(KEY); } catch (_) { return; }
      if (cur == null || cur === lastRaw) return;
      let s = null;
      try { s = JSON.parse(cur); } catch (_) { s = null; }
      if (valid(s)) {
        state = s;
        lastRaw = cur;
      }
    }

    function open(p) {
      sync();
      if (p.side !== 'LONG' && p.side !== 'SHORT') return { skipped: '방향이 없는 판정' };
      if (state.open.some((x) => x.symbol === p.symbol)) return { skipped: `${p.display} 이미 보유 중` };
      if (state.open.length >= cfg.maxOpen) return { skipped: `동시 보유 ${cfg.maxOpen}개 한도` };
      const marginPct = p.marginPct > 0 ? p.marginPct : cfg.marginPct;
      const margin = r2((state.balance * marginPct) / 100);
      if (!(margin >= 0.01)) return { skipped: '잔고 부족' };
      const t = now();
      state.seq += 1;
      const notional = margin * p.leverage;
      const pos = {
        id: `${p.display}-${t.toString(36)}-${state.seq}`,
        symbol: p.symbol, display: p.display, side: p.side, mode: p.mode || 'scalp', axis: p.axis || 'perp',
        entry: p.entry, stop: p.stop, target: p.target, liq: p.liq, rr: p.rr == null ? null : p.rr,
        leverage: p.leverage, margin, marginPct, notional: r2(notional), qty: notional / p.entry,
        confidence: p.confidence == null ? null : p.confidence, source: 'lite', status: 'open',
        openedAt: new Date(t).toISOString(), openedMs: t, checkFrom: Math.floor(t / MIN) * MIN + MIN,
        lastPrice: p.entry, markedAt: new Date(t).toISOString(),
        unrealizedPct: 0, roePct: 0, unrealizedAmt: 0, hitStop: false, hitTarget: false,
      };
      state.open.unshift(pos);
      save();
      return { position: { ...pos } };
    }

    function mark(pos, price) {
      const dir = pos.side === 'LONG' ? 1 : -1;
      const move = ((price - pos.entry) / pos.entry) * 100 * dir;
      pos.lastPrice = price;
      pos.markedAt = new Date(now()).toISOString();
      pos.unrealizedPct = r2(move);
      pos.roePct = r2(move * pos.leverage);
      pos.unrealizedAmt = r2(pos.qty * (price - pos.entry) * dir);
    }

    function close(pos, exit) {
      const dir = pos.side === 'LONG' ? 1 : -1;
      const movePct = ((exit.price - pos.entry) / pos.entry) * 100 * dir;
      const liquidated = exit.reason === '강제 청산';
      let pnl = -pos.margin; // 격리 청산 — 증거금 전액
      if (!liquidated) {
        const gross = pos.qty * (exit.price - pos.entry) * dir;
        const fees = (pos.qty * (pos.entry + exit.price) * cfg.feePct) / 100;
        pnl = Math.max(-pos.margin, gross - fees);
      }
      pnl = r2(pnl);
      state.balance = r2(state.balance + pnl);
      const closedMs = Math.min(exit.at, now());
      const closedAt = new Date(closedMs).toISOString();
      const roePct = liquidated ? -100 : r2(movePct * pos.leverage);
      const holdMin = Math.max(0, Math.round((closedMs - pos.openedMs) / MIN));
      const done = {
        ...pos, status: 'closed', exitPrice: exit.price, closedAt, closeReason: exit.reason,
        realizedPct: r2(movePct), realizedRoePct: roePct, realizedAmt: pnl, holdMin, note: exit.note || null,
      };
      delete done.unrealizedPct;
      delete done.unrealizedAmt;
      delete done.roePct;
      state.open = state.open.filter((x) => x.id !== pos.id);
      state.closed.unshift(done);
      state.closed.length = Math.min(state.closed.length, 200);
      state.trades.unshift({
        id: pos.id, symbol: pos.symbol, display: pos.display, side: pos.side, mode: pos.mode, leverage: pos.leverage,
        entry: pos.entry, exit: exit.price, reason: exit.reason, note: exit.note || null, movePct: r2(movePct), roePct,
        pnl, balanceAfter: state.balance, openedAt: pos.openedAt, closedAt, holdMin, excluded: false,
      });
      state.trades.length = Math.min(state.trades.length, 200);
      state.curve.push({ t: closedMs, b: state.balance });
      if (state.curve.length > 500) state.curve.splice(1, state.curve.length - 500);
      return { ...done };
    }

    // 1분봉으로 목표·손절·청산·만료 판정. 진입한 분의 봉은 진입 전 가격이 섞여 있어 보지 않는다.
    function settle(symbol, candles) {
      sync();
      const list = (candles || []).slice().sort((a, b) => a.t - b.t);
      const done = [];
      const mine = state.open.filter((x) => x.symbol === symbol);
      if (!mine.length) return done; // 바꿀 게 없으면 저장도 안 한다
      for (const pos of mine) {
        const dir = pos.side === 'LONG' ? 1 : -1;
        // 청산가가 손절가와 같거나 더 가까우면 손절이 아니라 강제 청산 — 유지증거금 때문에 거래소가 먼저 정리한다
        const liqFirst = dir === 1 ? pos.liq >= pos.stop : pos.liq <= pos.stop;
        const lossLevel = liqFirst ? pos.liq : pos.stop;
        const expireAt = pos.openedMs + cfg.holdMs;
        let exit = null;
        let last = null;
        for (const c of list) {
          if (c.t < pos.checkFrom) continue;
          last = c;
          const lossHit = dir === 1 ? c.l <= lossLevel : c.h >= lossLevel;
          const winHit = dir === 1 ? c.h >= pos.target : c.l <= pos.target;
          if (lossHit) {
            exit = { price: lossLevel, reason: liqFirst ? '강제 청산' : '손절', at: c.t + MIN, note: winHit ? '같은 1분봉에서 목표와 손절을 모두 건드려 손실로 처리' : null };
            break;
          }
          if (winHit) {
            exit = { price: pos.target, reason: '익절', at: c.t + MIN, note: null };
            break;
          }
          if (c.t + MIN >= expireAt) {
            exit = { price: c.c, reason: '보유 시간 만료', at: expireAt, note: '최대 보유 24시간 도달 — 그 시점 1분봉 종가로 정리' };
            break;
          }
        }
        if (exit) done.push(close(pos, exit));
        else if (last) {
          pos.checkFrom = last.t; // 진행 중인 봉은 다음 틱에 다시 본다
          mark(pos, last.c);
        }
      }
      save();
      return done;
    }

    // 실시간 틱 — 웹소켓 현재가 하나로 바로 평가한다. 목표·손절·청산가를 넘었으면 그 가격으로 체결(1분봉 정산을 기다리지 않는다).
    // 진입한 분에도 평가해야 해서(정산은 다음 분부터 본다) 따로 둔다. 평가값은 저장하지 않고, 체결이 났을 때만 저장한다.
    function tick(symbol, price) {
      if (!Number.isFinite(price) || !(price > 0)) return { done: [], marked: 0 };
      sync();
      const done = [];
      let marked = 0;
      for (const pos of state.open.filter((x) => x.symbol === symbol)) {
        const dir = pos.side === 'LONG' ? 1 : -1;
        const liqFirst = dir === 1 ? pos.liq >= pos.stop : pos.liq <= pos.stop;
        const lossLevel = liqFirst ? pos.liq : pos.stop;
        const lossHit = dir === 1 ? price <= lossLevel : price >= lossLevel;
        const winHit = dir === 1 ? price >= pos.target : price <= pos.target;
        if (lossHit) done.push(close(pos, { price: lossLevel, reason: liqFirst ? '강제 청산' : '손절', at: now(), note: null }));
        else if (winHit) done.push(close(pos, { price: pos.target, reason: '익절', at: now(), note: null }));
        else {
          mark(pos, price);
          marked += 1;
        }
      }
      if (done.length) save();
      return { done, marked };
    }

    function closeManual(id, price) {
      sync();
      const pos = state.open.find((x) => x.id === id);
      if (!pos || !Number.isFinite(price)) return null;
      const done = close(pos, { price, reason: '수동 청산', at: now(), note: '직접 정리' });
      save();
      return done;
    }

    function maxDrawdown(curve) {
      let peak = -Infinity;
      let dd = 0;
      for (const p of curve) {
        peak = Math.max(peak, p.b);
        if (peak > 0) dd = Math.max(dd, ((peak - p.b) / peak) * 100);
      }
      return r2(dd);
    }

    function snapshot() {
      sync();
      const t = now();
      const trades = state.trades;
      const n = trades.length;
      const wins = trades.filter((x) => x.pnl > 0);
      const losses = trades.filter((x) => !(x.pnl > 0));
      const lossSum = sum(losses.map((x) => x.pnl));
      const unrealized = r2(sum(state.open.map((p) => p.unrealizedAmt || 0)));
      const equity = r2(state.balance + unrealized);
      const midnight = new Date(t);
      midnight.setHours(0, 0, 0, 0);
      const today = trades.filter((x) => Date.parse(x.closedAt) >= midnight.getTime());
      const winRate = n ? r2((wins.length / n) * 100) : null;
      const rrs = state.closed.map((p) => p.rr).filter(Number.isFinite);
      return {
        ok: true,
        summary: {
          openCount: state.open.length, closedCount: n, evaluated: n, wins: wins.length, losses: losses.length, winRate,
          avgWinPct: wins.length ? r2(sum(wins.map((x) => x.movePct)) / wins.length) : null,
          avgLossPct: losses.length ? r2(sum(losses.map((x) => x.movePct)) / losses.length) : null,
          profitFactor: lossSum < 0 ? r2(sum(wins.map((x) => x.pnl)) / -lossSum) : null,
          expectancyPct: n ? r2(sum(trades.map((x) => x.movePct)) / n) : null,
          avgRR: rrs.length ? r2(sum(rrs) / rrs.length) : null,
          note: n < 30 ? `평가 표본 ${n}건 — 통계적 의미 없음` : null,
        },
        open: state.open.map((p) => ({ ...p })),
        closed: state.closed.slice(0, 50).map((p) => ({ ...p })),
        account: {
          start: state.start, balance: state.balance, equity, unrealized, pnl: r2(state.balance - state.start),
          returnPct: r2(((state.balance - state.start) / state.start) * 100),
          equityReturnPct: r2(((equity - state.start) / state.start) * 100),
          todayPnl: r2(sum(today.map((x) => x.pnl))), todayTrades: today.length,
          wins: wins.length, losses: losses.length, winRate, maxDrawdownPct: maxDrawdown(state.curve),
          curve: state.curve.map((p) => ({ ...p })), marginPct: cfg.marginPct, feePct: cfg.feePct,
          basis: `데모 버전 계좌 · 이 브라우저에만 저장 · 거래마다 잔고 ${cfg.marginPct}% 증거금 · ${cfg.feePct > 0 ? `수수료 편도 ${cfg.feePct}% 반영` : '수수료 없음(실제 거래소는 수수료가 붙습니다)'}`,
        },
        trades: trades.slice(0, 50).map((x) => ({ ...x })),
      };
    }

    function openSymbols() {
      sync();
      const by = new Map();
      for (const p of state.open) {
        const cur = by.get(p.symbol);
        if (!cur || p.checkFrom < cur.from) by.set(p.symbol, { symbol: p.symbol, axis: p.axis, from: p.checkFrom });
      }
      return [...by.values()];
    }

    return {
      open, settle, tick, closeManual, snapshot, openSymbols,
      getOpen: (id) => { sync(); const p = state.open.find((x) => x.id === id); return p ? { ...p } : null; },
      balance: () => { sync(); return state.balance; },
      reset: () => { state = fresh(); save(); },
      persistent: () => !!storage,
    };
  }

  return { KEY, DEFAULTS, create };
});
