/* PIXEL TRADING FLOOR 체험판 — 시장 데이터 (키 없는 공개 API만, 브라우저·Node 공용)
   바이낸스 USDT 무기한(fapi) + alternative.me 공포탐욕지수. 전부 CORS 허용(2026-09-30 실측).
   5분봉·1시간봉만 필수이고, 나머지는 실패해도 missing에 이름만 남기고 계속한다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LiteData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FAPI = 'https://fapi.binance.com';
  const SPOT = 'https://api.binance.com';
  const FNG = 'https://api.alternative.me/fng/?limit=1';
  const TAPE = ['BTC', 'ETH', 'SOL', 'XRP', 'TSLA', 'NVDA', 'SAMSUNG', 'XAU'];

  const KOREAN = {
    비트코인: 'BTC', 비트: 'BTC', 이더리움: 'ETH', 이더: 'ETH', 솔라나: 'SOL', 리플: 'XRP',
    도지: 'DOGE', 도지코인: 'DOGE', 에이다: 'ADA', 바이낸스코인: 'BNB', 트론: 'TRX',
    체인링크: 'LINK', 아발란체: 'AVAX', 수이: 'SUI', 페페: 'PEPE', 시바이누: 'SHIB',
    테슬라: 'TSLA', 엔비디아: 'NVDA', 애플: 'AAPL', 마이크로소프트: 'MSFT', 마소: 'MSFT', 아마존: 'AMZN',
    구글: 'GOOGL', 알파벳: 'GOOGL', 메타: 'META', 넷플릭스: 'NFLX', 팔란티어: 'PLTR', 코인베이스: 'COIN',
    마이크로스트래티지: 'MSTR', 스트래티지: 'MSTR', 브로드컴: 'AVGO', TSMC: 'TSM', 마이크론: 'MU', 인텔: 'INTC',
    하이닉스: 'SKHYNIX', SK하이닉스: 'SKHYNIX', HYNIX: 'SKHYNIX', '000660': 'SKHYNIX',
    삼성전자: 'SAMSUNG', 삼성: 'SAMSUNG', '005930': 'SAMSUNG',
    금: 'XAU', 골드: 'XAU', GOLD: 'XAU',
  };
  // 바이낸스 무기한에서 1000개 단위로 거래되는 밈코인
  const THOUSAND = { PEPE: '1000PEPE', SHIB: '1000SHIB', BONK: '1000BONK', FLOKI: '1000FLOKI' };
  // 코인이 아닌 바이낸스 USDⓈ-M 무기한(TradFi, 2026-10-01 확인) — 코인 전용 지표(공포탐욕지수)는 쓰지 않는다
  const ASSETS = {
    TSLA: {}, NVDA: {}, AAPL: {}, MSFT: {}, AMZN: {}, GOOGL: {}, META: {}, NFLX: {}, AMD: {}, PLTR: {},
    COIN: {}, MSTR: {}, AVGO: {}, TSM: {}, MU: {}, INTC: {}, SPY: {}, QQQ: {},
    SKHYNIX: { kind: 'krstock', display: 'SK하이닉스' }, SAMSUNG: { kind: 'krstock', display: '삼성전자' },
    XAU: { kind: 'commodity', display: '금' },
  };

  class LiteError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  const num = (v) => (v == null || v === '' ? null : Number.isFinite(+v) ? +v : null);

  // 사용자가 친 문자열 → { symbol:'BTCUSDT', display:'BTC', kind:'crypto'|'stock'|'krstock'|'commodity' }
  function resolveSymbol(input) {
    const raw = String(input == null ? '' : input).trim();
    if (!raw) throw new LiteError('EMPTY', '심볼을 입력하세요 (예: BTC, 테슬라, 삼성전자, 금)');
    const up = raw.toUpperCase().replace(/\s+/g, '');
    let base = (KOREAN[up] || KOREAN[raw] || up).replace(/[-_/]?(USDT|USD|PERP)$/, '');
    if (!/^[A-Z0-9]{2,15}$/.test(base)) {
      throw new LiteError('BAD_SYMBOL', '종목을 영문 심볼이나 이름으로 입력하세요 (예: BTC, 테슬라, 삼성전자, 금)');
    }
    const asset = ASSETS[base];
    if (asset) return { symbol: base + 'USDT', display: asset.display || base, kind: asset.kind || 'stock' };
    base = THOUSAND[base] || base;
    return { symbol: base + 'USDT', display: base, kind: 'crypto' };
  }

  // JSON GET — 10초 타임아웃, 2xx가 아니면 status·body를 단 LiteError
  async function getJson(fetchFn, url, timeoutMs = 10000) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await fetchFn(url, ctrl ? { signal: ctrl.signal } : undefined);
      let body = null;
      try { body = await res.json(); } catch (_) { body = null; }
      if (!res.ok) {
        const err = new LiteError('HTTP', `HTTP ${res.status}`);
        err.status = res.status;
        err.body = body;
        throw err;
      }
      return body;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const toCandles = (rows) => rows.map((r) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }));
  const invalid = (e) => !!(e && e.status === 400 && e.body && e.body.code === -1121);

  async function klines(f, symbol, interval, limit, axis) {
    const url = axis === 'spot'
      ? `${SPOT}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${Math.min(limit, 1000)}`
      : `${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    return toCandles(await getJson(f, url));
  }

  // 분석 한 번에 필요한 시장 스냅숏
  async function fetchSnapshot(sym, opts = {}) {
    const f = opts.fetch || fetch;
    const noSymbol = () => new LiteError('NO_SYMBOL', `${sym.display}: 바이낸스 USDT 무기한에 없는 종목입니다 (코인·미국 주식·삼성전자·하이닉스·금을 넣어 보세요)`);
    const crypto = !sym.kind || sym.kind === 'crypto';
    let axis = 'perp';
    let k5;
    let k1h;
    try {
      [k5, k1h] = await Promise.all([klines(f, sym.symbol, '5m', 300, 'perp'), klines(f, sym.symbol, '1h', 120, 'perp')]);
    } catch (e) {
      if (invalid(e)) throw noSymbol();
      // 주식·금 무기한은 현물 시장이 없다 — 현물로 다시 물으면 "없는 종목"으로 잘못 나온다
      if (!crypto) throw new LiteError('NETWORK', '바이낸스 시세에 접속하지 못했습니다 (네트워크·지역 차단) — 잠시 후 다시 시도하세요');
      try { // 선물 API가 막힌 지역 — 현물 차트로 한 번 더
        [k5, k1h] = await Promise.all([klines(f, sym.symbol, '5m', 300, 'spot'), klines(f, sym.symbol, '1h', 120, 'spot')]);
        axis = 'spot';
      } catch (e2) {
        if (invalid(e2)) throw noSymbol();
        throw new LiteError('NETWORK', '바이낸스 시세에 접속하지 못했습니다 (네트워크·지역 차단) — 잠시 후 다시 시도하세요');
      }
    }
    if (k5.length < 80 || k1h.length < 60) {
      throw new LiteError('SHORT_HISTORY', `${sym.display}: 캔들이 부족합니다 (5분봉 ${k5.length}개 · 1시간봉 ${k1h.length}개) — 상장 초기 종목은 분석하지 않습니다`);
    }

    const q = `symbol=${sym.symbol}`;
    const settled = await Promise.allSettled([
      getJson(f, `${FAPI}/fapi/v1/ticker/24hr?${q}`),
      getJson(f, `${FAPI}/fapi/v1/premiumIndex?${q}`),
      getJson(f, `${FAPI}/futures/data/openInterestHist?${q}&period=1h&limit=25`),
      getJson(f, `${FAPI}/futures/data/topLongShortPositionRatio?${q}&period=1h&limit=1`),
      crypto ? getJson(f, FNG) : Promise.resolve(null), // 공포탐욕지수는 코인 시장 지표
    ]);
    const [t24, prem, oiRows, lsRows, fngBody] = settled.map((r) => (r.status === 'fulfilled' ? r.value : null));
    const missing = [];
    const price = k5[k5.length - 1].c;

    let change24hPct = t24 ? num(t24.priceChangePercent) : null;
    if (change24hPct == null) {
      const ref = k1h[k1h.length - 25];
      change24hPct = ref && ref.c ? ((price - ref.c) / ref.c) * 100 : null;
    }

    const rate = prem ? num(prem.lastFundingRate) : null;
    const fundingPct = rate == null ? null : rate * 100;
    if (fundingPct == null) missing.push('funding');

    let oi = null;
    if (Array.isArray(oiRows) && oiRows.length >= 2) {
      const first = num(oiRows[0].sumOpenInterest);
      const last = num(oiRows[oiRows.length - 1].sumOpenInterest);
      if (first > 0 && last != null) oi = { changePct: ((last - first) / first) * 100, hours: oiRows.length - 1 };
    }
    if (!oi) missing.push('oi');

    const ls = Array.isArray(lsRows) && lsRows.length ? lsRows[lsRows.length - 1] : null;
    const ratio = ls ? num(ls.longShortRatio) : null;
    const topLS = ratio == null ? null : { ratio, longPct: num(ls.longAccount) * 100, shortPct: num(ls.shortAccount) * 100 };
    if (!topLS) missing.push('ls');

    const g = fngBody && Array.isArray(fngBody.data) ? fngBody.data[0] : null;
    const fv = g ? num(g.value) : null;
    const fng = fv == null ? null : { value: fv, label: String(g.value_classification || '') };
    if (!fng && crypto) missing.push('fng');

    return {
      symbol: sym.symbol, display: sym.display, kind: sym.kind || 'crypto', axis, price, change24hPct,
      k5, k1h, fundingPct, oi, topLS, fng, missing, fetchedAt: Date.now(),
    };
  }

  // 상단 티커 테이프 — 실패한 종목만 빠진다
  async function fetchTape(opts = {}) {
    const f = opts.fetch || fetch;
    const rows = await Promise.allSettled(TAPE.map((s) => getJson(f, `${FAPI}/fapi/v1/ticker/24hr?symbol=${s}USDT`, 6000)));
    const out = [];
    rows.forEach((r, i) => {
      const price = r.status === 'fulfilled' && r.value ? num(r.value.lastPrice) : null;
      if (price != null) out.push({ sym: TAPE[i], price, changePct: num(r.value.priceChangePercent) });
    });
    return out;
  }

  // 정산용 1분봉 — startMs부터 (선물 1500개·현물 1000개가 한 번 최대치 = 25시간·16시간)
  async function fetchMinuteCandles(symbol, startMs, opts = {}) {
    const f = opts.fetch || fetch;
    const from = Math.floor(startMs);
    const url = opts.axis === 'spot'
      ? `${SPOT}/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${from}&limit=1000`
      : `${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=1m&startTime=${from}&limit=1500`;
    return toCandles(await getJson(f, url));
  }

  // 상단 차트 실시간 갱신 — 최근 5분봉 몇 개(마지막 봉은 진행 중)
  async function fetchRecentCandles(symbol, opts = {}) {
    return klines(opts.fetch || fetch, symbol, opts.interval || '5m', opts.limit || 3, opts.axis === 'spot' ? 'spot' : 'perp');
  }

  // 수동 청산용 현재가
  async function fetchPrice(symbol, opts = {}) {
    const f = opts.fetch || fetch;
    const url = opts.axis === 'spot'
      ? `${SPOT}/api/v3/ticker/price?symbol=${symbol}`
      : `${FAPI}/fapi/v1/ticker/price?symbol=${symbol}`;
    const p = num((await getJson(f, url)).price);
    if (p == null) throw new LiteError('NO_PRICE', `${symbol} 현재가를 읽지 못했습니다`);
    return p;
  }

  return { LiteError, resolveSymbol, fetchSnapshot, fetchTape, fetchMinuteCandles, fetchRecentCandles, fetchPrice, TAPE };
});
