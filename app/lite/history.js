/* PIXEL TRADING FLOOR 데모 버전 — 매매 내역 (순수 함수)
   paper.snapshot().trades(청산된 거래, 최근 것이 앞)를 표 한 줄씩으로. 숫자는 가상 계좌 원장 그대로 — 손실도 같은 모양으로 낸다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LiteHistory = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const SIDE_KO = { LONG: '롱', SHORT: '숏' };
  const r2 = (n) => Math.round(n * 100) / 100;

  function when(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function rows(trades, n = 50) {
    if (!Array.isArray(trades)) return [];
    return trades.slice(0, n).map((t) => ({
      time: when(t.closedAt), who: t.display || t.symbol || '—', side: SIDE_KO[t.side] || t.side, lev: t.leverage,
      result: t.reason, roe: t.roePct, pnl: t.pnl, tone: t.pnl > 0 ? 'up' : t.pnl < 0 ? 'down' : '',
    }));
  }

  function summary(trades) {
    const list = Array.isArray(trades) ? trades : [];
    const wins = list.filter((t) => t.pnl > 0).length;
    return { n: list.length, wins, losses: list.length - wins, pnl: r2(list.reduce((a, t) => a + (Number(t.pnl) || 0), 0)) };
  }

  return { rows, summary };
});
