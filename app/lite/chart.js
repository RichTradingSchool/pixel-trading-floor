/* PIXEL TRADING FLOOR 데모 버전 — 상단 차트 (hq.js 다음에 로드, app.js의 drawChart를 대신 그린다)
   최근 12시간 5분봉 캔들 + MA20·MA50 위에
   · 매수▲·매도▼ 표시, 진입가→목표가 초록·진입가→손절가 빨강 구역(트레이딩뷰 포지션 도구처럼), 청산가
   · 현재가 선 — 보유 중이면 실시간 손익(ROE·USDT)
   · 관망이면 규칙이 보고 있는 6시간 박스와 "돌파 대기"선
   · 끝난 거래는 익절·손절 자리에 표시
   차트가 화면에 보일 때만 5초마다 최근 봉을 받아 이어 그린다.
   model()까지는 순수 함수(Node 테스트), install()이 브라우저에서 그린다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./brain.js'));
  else root.LiteChart = factory(root.LiteBrain);
})(typeof self !== 'undefined' ? self : this, function (Brain) {
  'use strict';

  const BARS = 144;
  const BAR_MS = 300000;
  const fmt = Brain.fmtPrice;
  const signed = (v, d) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(d)}`;
  const movePct = (entry, x) => ((x - entry) / entry) * 100;
  const EXIT = { 익절: ['win', '익절'], 손절: ['loss', '손절'], '강제 청산': ['liq', '청산'], '보유 시간 만료': ['exit', '만료'], '수동 청산': ['exit', '정리'] };

  // 진행 중인 봉을 이어 붙인다 — 같은 시각은 새 값으로, 새 시각은 뒤에, 최대 max개
  function mergeCandles(base, recent, max = BARS) {
    const by = new Map();
    for (const c of base || []) by.set(c.t, c);
    for (const c of recent || []) by.set(c.t, c);
    return [...by.values()].sort((a, b) => a.t - b.t).slice(-max);
  }

  // 실시간 틱(1분봉 현재 상태)을 진행 중인 5분봉에 반영 — 종가·고저만 바꾸고, 봉이 바뀌었으면 새 봉을 연다. 원본은 그대로.
  function applyTick(candles, tick, max = BARS) {
    if (!candles || !candles.length || !tick || !Number.isFinite(tick.price)) return candles;
    const step = barMs(candles);
    const bucket = Math.floor(tick.t / step) * step;
    const last = candles[candles.length - 1];
    if (bucket < last.t) return candles;
    const hi = Number.isFinite(tick.high) ? tick.high : tick.price;
    const lo = Number.isFinite(tick.low) ? tick.low : tick.price;
    if (bucket === last.t) {
      const next = { ...last, c: tick.price, h: Math.max(last.h, hi, tick.price), l: Math.min(last.l, lo, tick.price) };
      return [...candles.slice(0, -1), next];
    }
    const o = Number.isFinite(tick.open) ? tick.open : tick.price;
    return [...candles, { t: bucket, o, h: Math.max(hi, o, tick.price), l: Math.min(lo, o, tick.price), c: tick.price }].slice(-max);
  }

  function barMs(candles) {
    return candles && candles.length > 1 ? candles[candles.length - 1].t - candles[candles.length - 2].t : BAR_MS;
  }

  // 이번에 받아 올 봉 개수 — 마지막 봉(진행 중이었을 수 있음)부터 지금까지 + 여유, 오래 비었으면 전부 새로
  function barsToFetch(candles, now) {
    if (!candles || !candles.length) return BARS;
    const gap = now - candles[candles.length - 1].t;
    return Math.max(3, Math.min(BARS, Math.ceil(gap / barMs(candles)) + 2));
  }

  // 세로 범위 — 캔들 고저 + 보여 줄 레벨, 위아래 8% 여유
  function priceRange(candles, levels = []) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of candles || []) {
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
    }
    for (const v of levels) {
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    const pad = (hi - lo || Math.abs(hi) * 0.002 || 1) * 0.08;
    return { min: lo - pad, max: hi + pad };
  }

  // 캔들이 차트 높이의 minShare 이상을 쓰게 — 가까운 레벨부터 범위에 넣고, 더 넣으면 캔들이 납작해지는 먼 레벨은 off
  // (off 레벨은 가장자리에 화살표 가격표로 보여 준다. 20배 손절 −2.5%·청산 −4.5%가 12시간 캔들보다 먼 경우가 많다)
  function fitLevels(candles, levels, minShare = 0.45) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of candles || []) {
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
    }
    if (!Number.isFinite(lo)) return { range: priceRange([], levels), off: [] };
    const allowed = (hi - lo || Math.abs(hi) * 0.002 || 1) / minShare;
    const dist = (v) => (v > hi ? v - hi : v < lo ? lo - v : 0);
    const inside = [];
    const off = [];
    for (const v of levels.filter(Number.isFinite).sort((a, b) => dist(a) - dist(b))) {
      const nlo = Math.min(lo, v);
      const nhi = Math.max(hi, v);
      if (nhi - nlo <= allowed) {
        lo = nlo;
        hi = nhi;
        inside.push(v);
      } else off.push(v);
    }
    return { range: priceRange(candles, inside), off };
  }

  // 오른쪽 가격표가 겹치면 위아래로 밀어낸다 (y = 가운데)
  function layoutTags(tags, top, bottom) {
    const out = tags.map((t) => ({ ...t })).sort((a, b) => a.y - b.y);
    let cur = top;
    for (const t of out) {
      t.y = Math.max(t.y, cur + t.h / 2);
      cur = t.y + t.h / 2 + 1;
    }
    cur = bottom;
    for (let i = out.length - 1; i >= 0; i--) {
      const t = out[i];
      t.y = Math.min(t.y, cur - t.h / 2);
      cur = t.y - t.h / 2 - 1;
    }
    return out;
  }

  function held(ms) {
    const m = Math.max(0, Math.floor(ms / 60000));
    return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
  }

  // 데모 버전은 관망 없이 매번 방향을 고른다 — 관망은 리스크 게이트·PM이 막을 때만
  function holdWhy(r) {
    if (r.blocked === 'LIQ') return '이 배율은 청산가가 손절보다 가까워 진입하지 않습니다';
    if (r.blocked === 'PM') return 'PM이 기각했습니다';
    return '조건을 기다립니다';
  }

  // 그릴 것 목록(가격·시각 공간). s = { candles, price, open, closed, plan, rule, conf, kiosk, now }
  function model(s) {
    const out = { levels: [], zones: [], lines: [], links: [], markers: [], tags: [], liq: null, hud: null };
    const candles = s.candles || [];
    if (!candles.length) return out;
    const t0 = candles[0].t;
    const price = Number.isFinite(s.price) ? s.price : candles[candles.length - 1].c;
    const now = s.now || Date.now();

    // 끝난 거래 — 차트 구간 안에서 정리된 것만 (스냅숏 순서 = 최근 것부터)
    for (const p of s.closed || []) {
      const exitT = Date.parse(p.closedAt);
      if (!(exitT >= t0)) continue;
      const long = p.side === 'LONG';
      if (p.openedMs >= t0) out.markers.push({ kind: long ? 'buy' : 'sell', t: p.openedMs, price: p.entry, label: '' });
      const [kind, word] = EXIT[p.closeReason] || ['exit', '정리'];
      out.markers.push({ kind, t: exitT, price: p.exitPrice, label: `${word} ${signed(p.realizedAmt, 2)}` });
      out.links.push({ from: { t: Math.max(t0, p.openedMs), price: p.entry }, to: { t: exitT, price: p.exitPrice }, tone: p.realizedAmt > 0 ? 'up' : 'down' });
    }

    const pos = (s.open || [])[0] || null;
    const plan = pos ? null : s.plan || null;
    const live = pos || plan;
    let tone = null;
    if (live) {
      const long = live.side === 'LONG';
      const dir = long ? 1 : -1;
      const lev = live.leverage || live.lev;
      const from = live.openedMs || live.at || candles[candles.length - 1].t;
      out.zones.push(
        { kind: 'profit', from, to: null, lo: Math.min(live.entry, live.target), hi: Math.max(live.entry, live.target) },
        { kind: 'loss', from, to: null, lo: Math.min(live.entry, live.stop), hi: Math.max(live.entry, live.stop) },
      );
      out.lines.push({ kind: 'target', price: live.target, from }, { kind: 'entry', price: live.entry, from }, { kind: 'stop', price: live.stop, from });
      out.markers.push({ kind: long ? 'buy' : 'sell', t: from, price: live.entry, label: long ? '매수' : '매도' });
      out.tags.push(
        { kind: 'target', price: live.target, text: `목표 ${fmt(live.target)}`, sub: `${signed(movePct(live.entry, live.target), 2)}%` },
        { kind: 'entry', price: live.entry, text: `진입 ${fmt(live.entry)}`, sub: `${long ? '롱' : '숏'} ${lev}x` },
        { kind: 'stop', price: live.stop, text: `손절 ${fmt(live.stop)}`, sub: `${signed(movePct(live.entry, live.stop), 2)}%` },
      );
      if (Number.isFinite(live.liq)) out.liq = { price: live.liq, side: live.side };
      out.levels.push(live.entry, live.target, live.stop);
      const roe = movePct(live.entry, price) * dir * lev;
      tone = roe >= 0 ? 'up' : 'down';
      if (pos) {
        const amt = (pos.qty || 0) * (price - pos.entry) * dir;
        out.hud = { text: `${long ? 'LONG' : 'SHORT'} ${lev}x 보유 중 · ${held(now - from)}`, pnl: { text: `${signed(amt, 2)} USDT · ROE ${signed(roe, 1)}%`, tone } };
      } else {
        const act = `${long ? '매수' : '매도'} 판정${Number.isFinite(s.conf) ? ` ${s.conf}%` : ''}`;
        out.hud = { text: `${act} · ${s.kiosk ? '시연이라 진입하지 않음' : '모의 포지션 보류'}`, pnl: { text: `가상 ROE ${signed(roe, 1)}%`, tone } };
      }
    } else if (s.rule && s.action === 'HOLD') {
      out.hud = { text: `관망 · ${holdWhy(s.rule)}`, pnl: null };
    } else {
      // 보유도 관망 판정도 없으면(진입했던 포지션이 끝났거나 다시 들어온 화면) 방금 거래 결과를
      const done = (s.closed || []).find((p) => Date.parse(p.closedAt) >= t0);
      if (done) {
        const [, word] = EXIT[done.closeReason] || ['exit', '정리'];
        out.hud = { text: `방금 거래 ${word} ${signed(done.realizedAmt, 2)} USDT · 다음 판정은 ▶ ANALYZE`, pnl: null };
      }
    }

    out.lines.push({ kind: 'current', price, from: null });
    const posRoe = pos ? movePct(pos.entry, price) * (pos.side === 'LONG' ? 1 : -1) * pos.leverage : null;
    out.tags.push({ kind: 'current', price, text: `현재 ${fmt(price)}`, sub: pos ? `ROE ${signed(posRoe, 1)}%` : '', tone: pos ? tone : null });
    out.levels.push(price);
    return out;
  }

  /* ----------------------------------------------------------------- 브라우저 */
  const COL = { bg: '#000', grid: '#161622', up: '#3fb950', down: '#f85149', gold: '#e8c84a', blue: '#4a9de8', ink: '#e8e8f0', dim: '#6a6a84', liq: '#c2362c' };
  const TAG = {
    target: ['#3fb950', '#04150a'], entry: ['#e8e8f0', '#101018'], stop: ['#f85149', '#1a0303'],
    current: ['#e8c84a', '#1a1408'], wait: ['#3a300c', '#f5d76e'], liq: ['#4a0f0c', '#ffb4ab'],
  };
  const LINE = { target: [COL.up, []], entry: [COL.ink, [4, 3]], stop: [COL.down, []], wait: [COL.gold, [5, 3]] };
  const MARK = { win: COL.up, loss: COL.down, liq: COL.liq, exit: COL.dim };
  const FONT = '"Galmuri11", "Galmuri9", monospace';
  const ease = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

  function sma(arr, n) {
    const out = new Array(arr.length).fill(null);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      sum += arr[i];
      if (i >= n) sum -= arr[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }
  const norm = (c) => (c.o == null ? { t: c.t, o: c.c, h: c.c, l: c.c, c: c.c } : { t: c.t, o: c.o, h: c.h, l: c.l, c: c.c });

  function install(win) {
    const doc = win.document;
    const LITE = win.LITE;
    const cv = doc.querySelector('#chart');
    if (!LITE || !cv) return null;
    const st = { symbol: null, display: null, axis: 'perp', candles: [], price: null, plan: null, rule: null, conf: null, born: 0, flash: null, liveAt: 0 };
    let last = model({ candles: [] });
    let raf = 0;
    let seen = true;
    let busy = false;

    function current() {
      let open = [];
      let closed = [];
      if (st.symbol && LITE.paper) {
        const snap = LITE.paper.snapshot();
        open = snap.open.filter((p) => p.symbol === st.symbol);
        closed = snap.closed.filter((p) => p.symbol === st.symbol).slice(0, 8);
      }
      return model({ candles: st.candles, price: st.price, open, closed, plan: st.plan, rule: st.rule, conf: st.conf, kiosk: LITE.kiosk, now: Date.now() });
    }

    function text(ctx, s, x, y, color, size, align = 'left') {
      ctx.font = `${size}px ${FONT}`;
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.fillText(s, x, y);
    }

    // 한 장 그리기 — 애니메이션이 남았으면 true
    function draw() {
      raf = 0;
      const rect = cv.getBoundingClientRect();
      const W = Math.max(1, Math.round(rect.width));
      const H = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(2, win.devicePixelRatio || 1);
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
      }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = COL.bg;
      ctx.fillRect(0, 0, W, H);
      const compact = W < 560 || H < 72;
      const fs = compact ? 9 : 11;
      const candles = st.candles;
      const m = (last = current());
      if (candles.length < 2) {
        text(ctx, compact ? '▶ ANALYZE → 여기에 진입·목표·손절' : '▶ ANALYZE를 누르면 여기에 진입가·목표가·손절가가 그려집니다', W / 2, H / 2, COL.dim, fs, 'center');
        return false;
      }
      const nowMs = Date.now();
      const tagH = fs + 5;
      const gutter = compact ? 86 : 164;
      const P = { l: 4, r: gutter, t: 4, b: compact ? 4 : 13 };
      const plotW = Math.max(10, W - P.l - P.r);
      const plotH = Math.max(10, H - P.t - P.b);
      const right = P.l + plotW;
      // 캔들이 최소 45%는 쓰게 — 너무 먼 레벨(손절·청산이 흔하다)은 가장자리 화살표 가격표로
      const range = fitLevels(candles, m.levels, 0.45).range;
      const inRange = (v) => v >= range.min && v <= range.max;
      const n = candles.length;
      // 오른쪽에 "앞으로" 칸을 남긴다 — 방금 연 포지션의 목표·손절 상자가 캔들 한 칸 폭이 아니라 앞쪽으로 펼쳐 보이게
      const future = compact ? Math.round(plotW * 0.12) : Math.round(Math.min(96, Math.max(52, plotW * 0.08)));
      const step = (plotW - future) / n;
      const t0 = candles[0].t;
      const bm = barMs(candles);
      const X = (i) => P.l + step * (i + 0.5);
      const Y = (v) => P.t + (1 - (v - range.min) / (range.max - range.min)) * plotH;
      const YC = (v) => Math.max(P.t, Math.min(P.t + plotH, Y(v)));
      const XT = (t) => X(Math.max(0, Math.min(n - 1, Math.floor((t - t0) / bm))));
      const px = (v) => Math.round(v) + 0.5;
      let animating = false;

      // 배경 점 격자
      ctx.fillStyle = COL.grid;
      for (let gx = P.l; gx < right; gx += 16) for (let gy = P.t; gy < P.t + plotH; gy += 12) ctx.fillRect(gx, gy, 1, 1);

      // 구역 — 포지션 상자는 진입 자리에서 오른쪽으로 자라며 나타난다
      const grow = ease((nowMs - st.born) / 650);
      if (grow < 1) animating = true;
      for (const z of m.zones) {
        const x1 = z.from != null ? XT(z.from) - step / 2 : P.l;
        const xEnd = z.to != null ? XT(z.to - 1) + step / 2 : right;
        const x2 = z.kind === 'box' ? xEnd : x1 + (xEnd - x1) * grow;
        const y1 = YC(z.hi);
        const y2 = YC(z.lo);
        ctx.fillStyle = z.kind === 'profit' ? 'rgba(63,185,80,.17)' : z.kind === 'loss' ? 'rgba(248,81,73,.15)' : 'rgba(232,200,74,.07)';
        ctx.fillRect(x1, y1, Math.max(0, x2 - x1), Math.max(1, y2 - y1));
        if (z.kind === 'box') {
          ctx.strokeStyle = 'rgba(232,200,74,.4)';
          ctx.setLineDash([2, 3]);
          ctx.lineWidth = 1;
          ctx.strokeRect(px(x1), px(y1), Math.round(x2 - x1), Math.round(y2 - y1));
          ctx.setLineDash([]);
        }
      }

      // 이동평균 (MA20 금색 · MA50 파랑)
      const closes = candles.map((c) => c.c);
      [[sma(closes, 50), COL.blue], [sma(closes, 20), COL.gold]].forEach(([series, col]) => {
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1;
        ctx.beginPath();
        let on = false;
        series.forEach((v, i) => {
          if (v == null) return;
          if (on) ctx.lineTo(X(i), Y(v));
          else { ctx.moveTo(X(i), Y(v)); on = true; }
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
      });

      // 캔들
      const bw = Math.max(1, Math.floor(step * 0.62));
      candles.forEach((c, i) => {
        const x = Math.round(X(i));
        const up = c.c >= c.o;
        ctx.fillStyle = up ? COL.up : COL.down;
        const yh = Y(c.h);
        ctx.fillRect(x, Math.round(yh), 1, Math.max(1, Math.round(Y(c.l) - yh)));
        const yo = Y(c.o);
        const yc = Y(c.c);
        ctx.fillRect(x - Math.floor(bw / 2), Math.round(Math.min(yo, yc)), bw, Math.max(1, Math.round(Math.abs(yc - yo))));
      });

      // 끝난 거래: 진입 → 청산 점선
      for (const lk of m.links) {
        ctx.strokeStyle = lk.tone === 'up' ? 'rgba(63,185,80,.75)' : 'rgba(248,81,73,.75)';
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(XT(lk.from.t), YC(lk.from.price));
        ctx.lineTo(XT(lk.to.t), YC(lk.to.price));
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 레벨 선 (목표·진입·손절·돌파 대기) — 가격표 칸까지 이어진다
      for (const ln of m.lines) {
        if (!LINE[ln.kind] || !inRange(ln.price)) continue;
        const [col, dash] = LINE[ln.kind];
        const y = px(Y(ln.price));
        ctx.strokeStyle = col;
        ctx.setLineDash(dash);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ln.from != null ? XT(ln.from) - step / 2 : P.l, y);
        ctx.lineTo(right + 5, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const liqIn = !!m.liq && inRange(m.liq.price);
      if (liqIn) {
        const y = px(Y(m.liq.price));
        ctx.strokeStyle = COL.liq;
        ctx.setLineDash([1, 3]);
        ctx.beginPath();
        ctx.moveTo(m.zones.length ? XT(m.zones[0].from) - step / 2 : P.l, y);
        ctx.lineTo(right + 5, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 현재가 선 + 마지막 봉 점
      const cur = m.tags.find((t) => t.kind === 'current');
      const curCol = cur.tone === 'up' ? COL.up : cur.tone === 'down' ? COL.down : COL.gold;
      const yc = px(Y(cur.price));
      ctx.strokeStyle = curCol;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(P.l, yc);
      ctx.lineTo(right + 5, yc);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = curCol;
      ctx.fillRect(Math.round(X(n - 1)) - 2, Math.round(yc) - 2, 5, 5);

      // 매수▲ 매도▼ · 익절·손절 표시
      for (const mk of m.markers) {
        const x = Math.round(XT(mk.t));
        const y = YC(mk.price);
        if (mk.kind === 'buy' || mk.kind === 'sell') {
          const buy = mk.kind === 'buy';
          const d = buy ? 1 : -1;
          ctx.fillStyle = buy ? COL.up : COL.down;
          ctx.strokeStyle = '#000';
          ctx.beginPath();
          ctx.moveTo(x, y + d * 3);
          ctx.lineTo(x - 5, y + d * 10);
          ctx.lineTo(x + 5, y + d * 10);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          if (mk.label) {
            const ly = Math.max(P.t + fs / 2, Math.min(P.t + plotH - fs / 2, y + d * (12 + fs / 2)));
            ctx.font = `${fs}px ${FONT}`;
            const w = ctx.measureText(mk.label).width + 6;
            ctx.fillStyle = buy ? COL.up : COL.down;
            ctx.fillRect(Math.round(x - w / 2), Math.round(ly - fs / 2 - 2), Math.round(w), fs + 4);
            text(ctx, mk.label, x, ly + 0.5, buy ? '#04150a' : '#fff', fs, 'center');
          }
        } else {
          const col = MARK[mk.kind] || COL.dim;
          ctx.fillStyle = col;
          ctx.strokeStyle = '#000';
          ctx.fillRect(x - 3, Math.round(y) - 3, 7, 7);
          ctx.strokeRect(x - 3.5, Math.round(y) - 3.5, 8, 8);
          if (mk.label) {
            ctx.font = `${fs}px ${FONT}`;
            const w = ctx.measureText(mk.label).width + 6;
            const lx = Math.min(right - w / 2 - 2, Math.max(P.l + w / 2, x));
            const ly = Math.max(P.t + fs / 2 + 1, y - fs - 4);
            ctx.fillStyle = 'rgba(0,0,0,.75)';
            ctx.fillRect(Math.round(lx - w / 2), Math.round(ly - fs / 2 - 2), Math.round(w), fs + 4);
            text(ctx, mk.label, lx, ly + 0.5, col === COL.dim ? COL.ink : col, fs, 'center');
          }
        }
      }

      // 오른쪽 가격표 — 겹치면 밀어내고 원래 높이로 짧은 연결선, 범위 밖 레벨은 위·아래 끝에 화살표로
      const edgeTag = (t) => {
        if (inRange(t.price)) return { ...t, y: Y(t.price), h: tagH };
        const up = t.price > range.max;
        return { ...t, text: `${up ? '↑' : '↓'} ${t.text}`, y: up ? P.t + tagH / 2 : P.t + plotH - tagH / 2, h: tagH };
      };
      const tags = m.tags.map(edgeTag);
      if (m.liq) tags.push(edgeTag({ kind: 'liq', price: m.liq.price, text: `청산 ${fmt(m.liq.price)}`, sub: '' }));
      const laid = layoutTags(tags, 1, H - 1);
      const tx = right + 7;
      const tw = gutter - 10;
      for (const t of laid) {
        const [bg, fg] = t.kind === 'current' && t.tone ? [t.tone === 'up' ? COL.up : COL.down, t.tone === 'up' ? '#04150a' : '#fff'] : TAG[t.kind];
        const y0 = Y(t.price);
        if (Math.abs(y0 - t.y) > 2 && y0 >= P.t && y0 <= P.t + plotH) {
          ctx.strokeStyle = bg;
          ctx.beginPath();
          ctx.moveTo(right + 5, px(y0));
          ctx.lineTo(tx, px(t.y));
          ctx.stroke();
        }
        ctx.fillStyle = bg;
        ctx.fillRect(tx, Math.round(t.y - t.h / 2), tw, t.h);
        if (t.kind === 'wait') {
          ctx.strokeStyle = COL.gold;
          ctx.strokeRect(tx + 0.5, Math.round(t.y - t.h / 2) + 0.5, tw - 1, t.h - 1);
        }
        text(ctx, t.text, tx + 4, t.y + 0.5, fg, fs);
        if (!compact && t.sub) text(ctx, t.sub, tx + tw - 4, t.y + 0.5, fg, fs, 'right');
      }

      // 아래: 시각 + 범례
      if (!compact) {
        const hm = (t) => {
          const d = new Date(t);
          return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        };
        [Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75), n - 1].forEach((i) => text(ctx, hm(candles[i].t), X(i), H - 6, '#5a5a72', 9, 'center'));
        text(ctx, 'MA20', P.l + 2, H - 6, COL.gold, 9);
        text(ctx, 'MA50', P.l + 34, H - 6, COL.blue, 9);
        text(ctx, '5분봉', P.l + 66, H - 6, '#5a5a72', 9);
      }

      // 왼쪽 위 상태판 — 보유 중이면 실시간 손익 (좁은 화면은 손익 또는 첫 마디만)
      if (m.hud) {
        ctx.font = `${fs}px ${FONT}`;
        const head = compact ? (m.hud.pnl ? '' : m.hud.text.split(' · ')[0]) : m.hud.text;
        const w1 = head ? ctx.measureText(head).width : 0;
        const w2 = m.hud.pnl ? ctx.measureText(m.hud.pnl.text).width + (head ? 10 : 0) : 0;
        const w = Math.min(plotW - 4, w1 + w2 + 10);
        ctx.fillStyle = 'rgba(0,0,0,.78)';
        ctx.fillRect(P.l + 2, P.t + 1, w, tagH + 2);
        ctx.strokeStyle = '#2a2a3a';
        ctx.strokeRect(P.l + 2.5, P.t + 1.5, w - 1, tagH + 1);
        if (head) text(ctx, head, P.l + 7, P.t + 2 + tagH / 2, COL.ink, fs);
        if (m.hud.pnl) text(ctx, m.hud.pnl.text, P.l + 7 + w1 + (head ? 10 : 0), P.t + 2 + tagH / 2, m.hud.pnl.tone === 'down' ? COL.down : COL.up, fs);
      }

      // 방금 끝난 거래 — 화면이 번쩍이며 결과 한 줄
      if (st.flash) {
        const k = (nowMs - st.flash.at) / 2600;
        if (k >= 1) st.flash = null;
        else {
          animating = true;
          const a = 1 - k;
          const win_ = st.flash.kind === 'win';
          ctx.fillStyle = win_ ? `rgba(63,185,80,${0.3 * a})` : `rgba(248,81,73,${0.3 * a})`;
          ctx.fillRect(0, 0, W, H);
          const size = compact ? 14 : 22;
          const cx = P.l + plotW / 2;
          const cy = H / 2 - (1 - a) * 8;
          ctx.globalAlpha = Math.min(1, a * 1.6);
          text(ctx, st.flash.text, cx + 2, cy + 2, '#000', size, 'center');
          text(ctx, st.flash.text, cx, cy, win_ ? '#9dffb4' : '#ffb0aa', size, 'center');
          ctx.globalAlpha = 1;
        }
      }
      return animating;
    }

    function render() {
      if (raf) return;
      raf = win.requestAnimationFrame(() => {
        if (draw()) render();
      });
    }

    function setMarket(symbol, display, axis, candles, price) {
      st.symbol = symbol;
      st.display = display;
      st.axis = axis || 'perp';
      st.candles = mergeCandles(candles.map(norm), [], BARS);
      st.price = Number.isFinite(price) ? price : null;
      st.liveAt = 0;
    }

    LITE.bus.subscribe((ev) => {
      if (!ev || !ev.type) return;
      if (ev.type === 'market' && Array.isArray(ev.candles) && ev.candles.length) {
        setMarket(ev.symbol || null, ev.display || null, ev.axis, ev.candles, null);
        st.plan = null;
        st.rule = null;
        st.conf = null;
        st.flash = null;
        render();
      } else if (ev.type === 'decision') {
        st.plan = ev.plan || null;
        st.rule = ev.rule || null;
        st.conf = Number.isFinite(ev.confidence) ? ev.confidence : null;
        st.born = Date.now();
        render();
      } else if (ev.type === 'position' && ev.position && ev.position.symbol === st.symbol) {
        if (ev.action === 'open') {
          st.plan = null;
          st.born = Date.now();
        } else if (ev.action === 'close') {
          const p = ev.position;
          const [, word] = EXIT[p.closeReason] || ['exit', '정리'];
          st.flash = { kind: p.realizedAmt > 0 ? 'win' : 'loss', text: `${word}! ${signed(p.realizedAmt, 2)} USDT`, at: Date.now() };
        }
        render();
      }
    });

    // 웹소켓 틱(live.js) — 진행 중인 봉과 현재가를 바로 갱신. 받고 있는 동안은 아래 5초 폴링이 쉰다.
    function tickChart(tk) {
      if (!tk || tk.symbol !== st.symbol || st.axis === 'spot' || !st.candles.length) return false;
      st.candles = applyTick(st.candles, { t: tk.t, price: tk.c, high: tk.h, low: tk.l, open: tk.o });
      st.price = tk.c;
      st.liveAt = Date.now();
      const pEl = doc.querySelector('#board-price');
      if (pEl) pEl.textContent = `$${fmt(st.price)}`;
      render();
      return true;
    }

    // 실시간 — 화면에 보이고 탭이 앞에 있을 때만 5초마다 (웹소켓이 살아 있으면 쉰다)
    async function poll() {
      if (!st.symbol || busy || doc.hidden || !seen) return;
      if (Date.now() - st.liveAt < 12000) return;
      busy = true;
      const sym = st.symbol;
      try {
        const rows = await LITE.data.fetchRecentCandles(sym, { axis: st.axis, limit: barsToFetch(st.candles, Date.now()) });
        if (sym === st.symbol && rows && rows.length) {
          st.candles = mergeCandles(st.candles, rows.map(norm), BARS);
          st.price = rows[rows.length - 1].c;
          // 전광판 큰 가격도 차트 현재가와 같이 — 분석 때 가격에 멈춰 있으면 두 "현재가"가 달라 보인다
          const pEl = doc.querySelector('#board-price');
          if (pEl) pEl.textContent = `$${fmt(st.price)}`;
          render();
        }
      } catch (_) { /* 잠깐 끊기면 다음 차례에 */ } finally {
        busy = false;
      }
    }
    if (typeof win.IntersectionObserver === 'function') {
      new win.IntersectionObserver((es) => {
        seen = es.some((e) => e.isIntersecting);
        if (seen) poll();
      }).observe(cv);
    }
    if (typeof win.ResizeObserver === 'function') new win.ResizeObserver(render).observe(cv);
    doc.addEventListener('visibilitychange', () => { if (!doc.hidden) poll(); });
    win.setInterval(poll, 5000);
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(render);

    // 다시 들어왔을 때 보유 중인 포지션이 있으면 그 종목 차트부터 — 분석 없이도 손익이 움직이게
    async function restore() {
      if (LITE.kiosk || st.symbol || !LITE.paper) return;
      const open = LITE.paper.snapshot().open;
      if (!open.length) return;
      const p = open[0];
      try {
        const rows = await LITE.data.fetchRecentCandles(p.symbol, { axis: p.axis, limit: BARS });
        if (st.symbol || !rows || !rows.length) return;
        setMarket(p.symbol, p.display, p.axis, rows, rows[rows.length - 1].c);
        const sEl = doc.querySelector('#board-symbol');
        const pEl = doc.querySelector('#board-price');
        if (sEl && sEl.textContent.trim() === '—') sEl.textContent = p.display;
        if (pEl && pEl.textContent.trim() === '—') pEl.textContent = `$${fmt(st.price)}`;
        render();
      } catch (_) { /* 시세를 못 받으면 분석할 때 그린다 */ }
    }
    win.setTimeout(restore, 800);

    win.drawChart = render; // app.js가 시세 수신·창 크기 변경 때 부르는 함수를 이쪽으로
    render();
    const api = {
      render,
      poll,
      model: () => last,
      applyTick: tickChart,
      isSeen: () => seen,
      state: () => ({ symbol: st.symbol, display: st.display, axis: st.axis, bars: st.candles.length, price: st.price, liveAt: st.liveAt, lastT: st.candles.length ? st.candles[st.candles.length - 1].t : null }),
      candles: () => st.candles.slice(),
      tags: () => last.tags.map((t) => t.text),
    };
    LITE.chart = api;
    return api;
  }

  if (typeof window !== 'undefined' && window.document && window.LITE && !window.LITE_NO_BOOT) install(window);

  return { BARS, mergeCandles, applyTick, barsToFetch, priceRange, fitLevels, layoutTags, model, install };
});
