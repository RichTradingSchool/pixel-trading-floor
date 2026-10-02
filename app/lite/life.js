/* PIXEL TRADING FLOOR 데모 버전 — 사무실 자율 활동 (chart.js 다음, ui.js 앞에 로드)
   분석이 없을 때도 직원들이 실시간 시장을 보며 돌아가며 말한다 — "한 번 분석하고 멈춘 사무실"이 아니게.
   · TARO: 실시간 5분봉 흐름(급등락·12시간 고저·MA20)      · BLITZ: 보유 포지션의 목표·손절까지 거리
   · GUARD: 청산가까지 거리(배율 경고와 함께)              · VIBE: 마지막 분석의 심리 지표
   · NOVA: 최신 헤드라인(초파리 서버 ext/news.json — 제목·출처만, 기사 해석은 AI 실제 버전의 몫)
   · PM: 모의 계좌 보고, 할 게 없으면 다음 분석 안내
   lineFor·nextLine은 순수 함수(Node 테스트), install이 브라우저에서 말풍선·콘솔에 띄운다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./brain.js'));
  else root.LiteLife = factory(root.LiteBrain);
})(typeof self !== 'undefined' ? self : this, function (Brain) {
  'use strict';

  const SLOTS = ['taro', 'nova', 'blitz', 'vibe', 'guard', 'nova', 'pm'];
  const NAME = { taro: 'TARO', nova: 'NOVA', blitz: 'BLITZ', vibe: 'VIBE', guard: 'GUARD', pm: 'PM' };
  const SIDE_KO = { LONG: '롱', SHORT: '숏' };
  const FNG_KO = { 'Extreme Fear': '극단적 공포', Fear: '공포', Neutral: '중립', Greed: '탐욕', 'Extreme Greed': '극단적 탐욕' };
  const fmt = Brain.fmtPrice;
  const signed = (v, d) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(d)}`;
  const money = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const choose = (arr, rnd) => arr[Math.min(arr.length - 1, Math.floor(rnd() * arr.length))];
  const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const toMs = (t) => (t < 1e12 ? t * 1000 : t);
  const ago = (ms) => {
    const m = Math.max(0, Math.round(ms / 60000));
    return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.floor(m / 60)}시간 전` : `${Math.floor(m / 1440)}일 전`;
  };

  // TARO — 실시간 5분봉 (급등락 > 12시간 고저 > MA20)
  function taro(s, rnd) {
    const c = s.chart;
    if (!c || !c.candles || c.candles.length < 21) return null;
    const cs = c.candles;
    const n = cs.length;
    const price = Number.isFinite(c.price) ? c.price : cs[n - 1].c;
    const ch15 = ((price - cs[n - 4].c) / cs[n - 4].c) * 100;
    const ch60 = ((price - cs[Math.max(0, n - 13)].c) / cs[Math.max(0, n - 13)].c) * 100;
    const hi = Math.max(...cs.map((x) => x.h));
    const lo = Math.min(...cs.map((x) => x.l));
    const ma = cs.slice(-20).reduce((a, x) => a + x.c, 0) / 20;
    const d = c.display;
    const range = `12시간 범위 ${fmt(lo)}~${fmt(hi)}`;
    if (Math.abs(ch15) >= 0.4) {
      const up = ch15 > 0;
      return {
        id: 'taro',
        bubble: choose([`${d} 15분 만에 ${signed(ch15, 2)}% — 급${up ? '등' : '락'}!`, `순식간에 ${signed(ch15, 2)}% — 급${up ? '등' : '락'} 나왔어요!`], rnd),
        report: `[TARO · 실시간 차트] ${d} 최근 15분 ${signed(ch15, 2)}% — 급${up ? '등' : '락'}. ${range}. 변동성이 커졌으니 추격은 신중하게.`,
      };
    }
    if ((hi - lo) / price >= 0.005 && (price >= hi * 0.9995 || price <= lo * 1.0005)) {
      const top = price >= hi * 0.9995;
      return {
        id: 'taro',
        bubble: top ? `12시간 고점 ${fmt(hi)} 코앞 — 뚫으면 가속` : `12시간 저점 ${fmt(lo)} 시험 중 — 깨지면 조심`,
        report: `[TARO · 실시간 차트] ${d} 현재 ${fmt(price)} — ${top ? '고점 돌파 시도' : '저점 지지 시험'}. ${range} · 1시간 ${signed(ch60, 2)}%.`,
      };
    }
    const above = price >= ma;
    return {
      id: 'taro',
      bubble: above ? choose(['MA20 위 유지 — 단기 매수세 살아 있어요', `5분봉 MA20 ${fmt(ma)} 위에서 버티는 중`], rnd)
        : choose(['MA20 아래 — 단기 매도 우위', `5분봉 MA20 ${fmt(ma)} 아래로 눌려 있어요`], rnd),
      report: `[TARO · 실시간 차트] ${d} 현재 ${fmt(price)} · 5분봉 MA20 ${fmt(ma)} ${above ? '위' : '아래'} · 1시간 ${signed(ch60, 2)}% · ${range}.`,
    };
  }

  // BLITZ — 보유 포지션 중 청산(익절·손절)에 가장 가까운 것
  function blitz(s) {
    const ps = s.positions || [];
    if (!ps.length) return null;
    const x = ps.map((p) => {
      const last = Number.isFinite(p.lastPrice) ? p.lastPrice : p.entry;
      return { p, last, dT: (Math.abs(p.target - last) / last) * 100, dS: (Math.abs(last - p.stop) / last) * 100 };
    }).sort((a, b) => Math.min(a.dT, a.dS) - Math.min(b.dT, b.dS))[0];
    const { p, dT, dS } = x;
    const who = `${p.display} ${SIDE_KO[p.side] || p.side}`;
    const roe = Number.isFinite(p.roePct) ? `ROE ${signed(p.roePct, 1)}%` : '평가 대기';
    const bubble = dT < 0.05 ? `${p.display} 목표까지 ${dT.toFixed(2)}%! 곧 익절각`
      : dS < 0.08 ? `${p.display} 손절선 ${fmt(p.stop)}까지 ${dS.toFixed(2)}% — 버텨라…`
        : `${who} ${roe} — 목표까지 ${dT.toFixed(2)}%`;
    return {
      id: 'blitz', bubble,
      report: `[BLITZ · 포지션 감시] ${who} · 진입 ${fmt(p.entry)} · 현재 ${fmt(x.last)} · ${roe} · 목표 ${fmt(p.target)}까지 ${dT.toFixed(2)}% · 손절 ${fmt(p.stop)}까지 ${dS.toFixed(2)}%`,
    };
  }

  // GUARD — 청산가까지 거리 (배율을 말하면 청산 경고를 함께)
  function guard(s, rnd) {
    const ps = s.positions || [];
    if (!ps.length) return null;
    const p = choose(ps, rnd);
    const last = Number.isFinite(p.lastPrice) ? p.lastPrice : p.entry;
    const dL = (Math.abs(last - p.liq) / last) * 100;
    return {
      id: 'guard',
      bubble: `${p.display} 청산가까지 ${dL.toFixed(2)}% — 손절이 먼저예요`,
      report: `[GUARD · 리스크] ${p.display} ${SIDE_KO[p.side] || p.side} ${p.leverage}배 — 청산가 ${fmt(p.liq)}까지 ${dL.toFixed(2)}%, 손절 ${fmt(p.stop)}이 먼저 작동합니다. ⚠ ${p.leverage}배 격리는 가격이 약 ${(100 / p.leverage - 0.5).toFixed(2)}%만 반대로 가도 증거금 전액이 청산됩니다.`,
    };
  }

  // VIBE — 마지막 분석 때 받은 심리 지표
  function vibe(s) {
    const g = s.lastSig;
    if (!g) return null;
    if (g.fng && Number.isFinite(g.fng.value)) {
      const v = g.fng.value;
      const mood = v >= 75 ? '과열 — 추격 조심' : v <= 25 ? '공포 — 역발상 관심 구간' : v >= 55 ? '살짝 탐욕 쪽' : v <= 45 ? '살짝 공포 쪽' : '쏠림 없음';
      return {
        id: 'vibe',
        bubble: `공포탐욕 ${v} — ${mood}`,
        report: `[VIBE · 심리] 마지막 분석 기준 공포탐욕지수 ${v} (${FNG_KO[g.fng.label] || g.fng.label || '분류 없음'}). 쏠림의 반대편을 봅니다.`,
      };
    }
    if (Number.isFinite(g.fundingPct)) {
      const f = g.fundingPct;
      const lean = f >= 0.03 ? '롱 쏠림' : f <= -0.03 ? '숏 쏠림' : '한쪽 쏠림은 없어요';
      return { id: 'vibe', bubble: `펀딩비 ${signed(f, 4)}% — ${lean}`, report: `[VIBE · 심리] 마지막 분석 기준 펀딩비 ${signed(f, 4)}% — ${lean}.` };
    }
    return null;
  }

  // NOVA — 아직 전하지 않은 가장 새 헤드라인
  function nova(s) {
    const seen = s.seen || new Set();
    const it = (s.news || []).filter((x) => x && x.title && !seen.has(x.title)).sort((a, b) => toMs(b.t) - toMs(a.t))[0];
    if (!it) return null;
    const when = ago((s.now || Date.now()) - toMs(it.t));
    return {
      id: 'nova', newsKey: it.title,
      bubble: `📰 ${short(it.title, 34)}`,
      report: `[NOVA · 최신 헤드라인] ${it.title} — ${it.source || '출처 미상'} · ${when}\n데모 버전은 헤드라인만 전합니다. 기사를 읽고 호재·악재를 판단하는 건 AI 실제 버전의 NOVA입니다.`,
      // '> '로 시작해야 휴대폰 분석 피드(hq.js feedLog)가 '[주제]'를 리스크 게이트 줄로 받지 않는다 — 콘솔 전용
      log: `> [${it.topic || '뉴스'}] ${it.title} (${it.source || '출처 미상'} · ${when})`,
    };
  }

  // PM — 모의 계좌 보고, 아무 일 없으면 다음 분석 안내 (항상 할 말이 있다)
  function pm(s, rnd) {
    const a = s.account;
    const open = (s.positions || []).length;
    if (a) {
      return {
        id: 'pm',
        bubble: `대표님, 모의 계좌 ${money(a.equity)} USDT (${signed(a.equityReturnPct, 2)}%)`,
        report: `[PM · 계좌 보고] 평가 잔고 ${money(a.equity)} USDT (${signed(a.equityReturnPct, 2)}%) · ${a.wins}승 ${a.losses}패 · 보유 ${open}개 — 데모 버전은 수수료 없이 계산합니다(실제 거래소는 왕복 수수료가 붙습니다)`,
      };
    }
    return {
      id: 'pm',
      bubble: choose(['다음 분석 대기 중 — 코인·미국 주식·금 뭐든지', '대표님, 어떤 종목부터 볼까요?'], rnd),
      report: '[PM · 대기] 종목을 넣고 ▶ ANALYZE를 누르면 직원들이 바로 분석을 시작합니다 — 코인·테슬라·엔비디아·삼성전자·하이닉스·금',
    };
  }

  const GEN = { taro, nova, blitz, vibe, guard, pm };
  function lineFor(slot, state, rnd = Math.random) {
    return GEN[slot] ? GEN[slot](state, rnd) : null;
  }

  // idx부터 한 바퀴 돌며 할 말이 있는 첫 직원 — { line, next }
  function nextLine(state, idx, rnd = Math.random) {
    for (let k = 0; k < SLOTS.length; k++) {
      const i = (idx + k) % SLOTS.length;
      const line = lineFor(SLOTS[i], state, rnd);
      if (line) return { line, next: (i + 1) % SLOTS.length };
    }
    return { line: null, next: idx };
  }

  /* ----------------------------------------------------------------- 브라우저 */
  function install(win) {
    const LITE = win.LITE;
    if (!LITE || !LITE.bus) return null;
    const cfg = win.LITE_CONFIG || {};
    const doc = win.document;
    const st = { idx: 0, seen: new Set(), news: [], feed: null, lastSig: null, quietUntil: Date.now() + 6000 };

    LITE.bus.subscribe((ev) => {
      if (!ev) return;
      if (ev.type === 'decision' && ev.mood) st.lastSig = ev.mood;
      if (ev.type === 'run:end') st.quietUntil = Date.now() + 12000; // 판정 말풍선이 읽힐 시간
    });

    function state() {
      const snap = LITE.paper ? LITE.paper.snapshot() : null;
      const ch = LITE.chart ? LITE.chart.state() : null;
      return {
        now: Date.now(),
        chart: ch && ch.symbol ? { display: ch.display, candles: LITE.chart.candles(), price: ch.price } : null,
        positions: snap ? snap.open : [],
        account: snap && (snap.trades.length || snap.open.length) ? snap.account : null,
        lastSig: st.lastSig, news: st.news, seen: st.seen,
      };
    }

    // 소개 페이지 속 화면(iframe)은 스크롤해서 화면 밖으로 나가면 말하지 않는다 — 다른 구간을 읽는 동안 말풍선·타자 소리가 나지 않게
    // (같은 출처 iframe의 IntersectionObserver는 맨 위 창의 화면을 기준으로 잰다)
    let onScreen = true;
    if (win.parent && win.parent !== win && typeof win.IntersectionObserver === 'function') {
      new win.IntersectionObserver((es) => { onScreen = es.some((e) => e.isIntersecting); }).observe(doc.documentElement);
    }

    // 한마디 — force면 조용한 시간·가려진 탭·화면 밖이어도 바로(검증용). 분석 중에는 끼어들지 않는다
    function speak(force) {
      if (LITE.engine && LITE.engine.isRunning()) return;
      if (!force && (doc.hidden || !onScreen || Date.now() < st.quietUntil)) return;
      const r = nextLine(state(), st.idx, Math.random);
      if (!r.line) return;
      st.idx = r.next;
      const l = r.line;
      if (l.newsKey) st.seen.add(l.newsKey);
      if (typeof win.typeBubble === 'function') {
        try { win.typeBubble(l.id, l.bubble, l.report); } catch (_) { /* 말풍선 실패가 사무실을 멈추지 않게 */ }
      }
      LITE.bus.emit({ type: 'log', kind: l.id === 'nova' ? 'news' : 'sys', line: l.id === 'nova' ? l.log : `> ${NAME[l.id]} · ${l.bubble}` });
    }
    function tick() {
      win.setTimeout(tick, 16000 + Math.random() * 9000);
      speak(false);
    }

    // 최신 헤드라인 — 초파리 feed.json이 알려 주는 터널 주소의 ext/news.json (5분마다)
    async function loadNews() {
      if (!cfg.flyFeed) return;
      try {
        if (!st.feed) {
          const f = await (await win.fetch(`${cfg.flyFeed}?t=${Date.now()}`, { cache: 'no-store' })).json();
          st.feed = /^https?:\/\//.test(f.feed || '') ? f.feed.replace(/\/?$/, '/') : null;
        }
        if (!st.feed) return;
        const r = await win.fetch(`${st.feed}ext/news.json?t=${Date.now()}`, { cache: 'no-store' });
        if (r.ok) st.news = ((await r.json()).items || []).slice(0, 40);
      } catch (_) {
        st.feed = null; // 터널 주소가 바뀌었을 수 있다 — 다음 차례에 feed.json부터
      }
    }
    loadNews();
    win.setInterval(loadNews, 300000);
    win.setTimeout(tick, 6000);
    const api = { state, say: speak, news: () => st.news.slice() };
    LITE.life = api;
    return api;
  }

  if (typeof window !== 'undefined' && window.document && window.LITE && !window.LITE_NO_BOOT) install(window);

  return { SLOTS, lineFor, nextLine, install };
});
