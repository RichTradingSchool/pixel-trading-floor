/* PIXEL TRADING FLOOR 체험판 — 지표 계산 (브라우저·Node 공용, 의존성 0)
   EMA·Wilder RSI는 server/indicators.js와 같은 식이다(패리티 테스트로 고정). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LiteInd = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // EMA 시리즈 — values[0]을 시작값으로 잡아 짧은 배열에서도 모든 칸이 채워진다
  function emaSeries(values, period) {
    const k = 2 / (period + 1);
    const out = new Array(values.length);
    let prev = values.length ? values[0] : 0;
    for (let i = 0; i < values.length; i++) {
      prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  // Wilder RSI. 데이터가 period+1개 미만이면 null
  function wilderRsi(closes, period = 14) {
    if (!Array.isArray(closes) || closes.length < period + 1) return null;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gains += d;
      else losses -= d;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    }
    if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
    if (avgGain === 0) return 0;
    return 100 - 100 / (1 + avgGain / avgLoss);
  }

  // closes[end]에서 끝나는 period개로 계산한 볼린저 밴드(모표준편차)
  function bollingerAt(closes, end, period = 20, mult = 2) {
    if (!Array.isArray(closes) || end < period - 1 || end >= closes.length) return null;
    let sum = 0;
    for (let i = end - period + 1; i <= end; i++) sum += closes[i];
    const mid = sum / period;
    let v = 0;
    for (let i = end - period + 1; i <= end; i++) v += (closes[i] - mid) ** 2;
    const sd = Math.sqrt(v / period);
    return { mid, upper: mid + mult * sd, lower: mid - mult * sd };
  }

  // 박스 — 마지막(진행 중) 봉을 뺀 직전 n개 봉의 최고가·최저가
  function boxBefore(candles, n = 72) {
    if (!Array.isArray(candles) || candles.length < n + 1) return null;
    const win = candles.slice(-(n + 1), -1);
    return { high: Math.max(...win.map((c) => c.h)), low: Math.min(...win.map((c) => c.l)), bars: n };
  }

  return { emaSeries, wilderRsi, bollingerAt, boxBefore };
});
