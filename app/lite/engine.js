/* PIXEL TRADING FLOOR 체험판 — 엔진
   서버 engine.js와 같은 이벤트를 브라우저 안에서 만든다. 판정은 LiteBrain, 대사는 LiteScript.
   직원별 "생각 시간"은 연출이다(pace 0이면 즉시 — 테스트용). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./brain.js'), require('./script.js'));
  else root.LiteEngine = factory(root.LiteBrain, root.LiteScript);
})(typeof self !== 'undefined' ? self : this, function (Brain, Script) {
  'use strict';

  const THINK = {
    taro: 1800, vibe: 2200, diana: 2000, nova: 1200, bull: 2000, bear: 2200, blitz: 1800,
    guard: 1600, ace: 2400, risky: 1600, safe: 1800, neutral: 1800, pm: 2000,
  };
  const r2 = (n) => Math.round(n * 100) / 100;
  const CHART_BARS = 144; // 상단 차트 = 최근 12시간 5분봉

  function createBus() {
    const subs = new Set();
    return {
      emit(ev) {
        for (const fn of [...subs]) {
          try { fn(ev); } catch (_) { /* 구독자 오류가 방송을 막지 않게 */ }
        }
      },
      subscribe(fn) {
        subs.add(fn);
        return () => subs.delete(fn);
      },
    };
  }

  function createEngine(deps) {
    const bus = deps.bus;
    const pace = deps.pace == null ? 1 : deps.pace;
    const sleep = deps.sleep || ((ms) => new Promise((ok) => setTimeout(ok, ms)));
    const wait = (ms) => (pace > 0 && ms > 0 ? sleep(ms * pace) : Promise.resolve());
    const now = deps.now || (() => Date.now());
    const emit = (ev) => bus.emit(ev);
    const log = (line, kind = 'sys') => emit({ type: 'log', kind, line: String(line) });
    // 오류는 토스트(run:error)만으로는 몇 초 뒤 사라진다 — 콘솔에도 이유를 남긴다
    const fail = (message) => {
      log(`> ⚠ ${message}`);
      emit({ type: 'run:error', message });
    };
    let running = false;

    // 한 라운드 — 전원 동시에 생각 시작, 생각 시간이 짧은 순서로 발언
    async function round(items) {
      for (const it of items) emit({ type: 'agent:start', id: it.id, ...(it.turn ? { turn: it.turn } : {}) });
      const order = items.slice().sort((a, b) => (THINK[a.id] || 1500) - (THINK[b.id] || 1500));
      let elapsed = 0;
      for (const it of order) {
        const t = THINK[it.id] || 1500;
        await wait(t - elapsed);
        elapsed = t;
        emit({ type: 'agent:done', id: it.id, ...(it.turn ? { turn: it.turn } : {}), bubble: it.text.bubble, report: it.text.report });
      }
    }

    async function run(input, opts = {}) {
      if (running) {
        const err = new Error('이미 분석이 진행 중입니다.');
        err.code = 409;
        throw err;
      }
      running = true;
      const mode = opts.mode === 'algo' ? 'algo' : 'scalp';
      const lev = Brain.clampLev(opts.lev);
      const kiosk = !!opts.kiosk;
      try {
        let sym;
        try {
          sym = deps.data.resolveSymbol(input);
        } catch (e) {
          fail(e.message);
          return;
        }
        // auto는 늘 false — 화면(hq.js)이 auto면 "자동 분석 개시 · AI <모델>" 배너를 띄워 AI 판정처럼 보인다
        emit({ type: 'run:start', symbol: sym.symbol, display: sym.display, mock: false, mode, auto: false, model: '자체 로직' });
        log('> 데모 버전 — AI 엔진 대신 자체 트레이딩 로직으로 판정합니다 (실제 버전은 13명이 각자 AI로 분석)');
        log(`> 바이낸스 ${sym.display} 시세 요청…`);
        const snap = await deps.data.fetchSnapshot(sym);
        const an = Brain.analyze(snap, { lev, mode });
        const T = Script.texts(an, snap);
        // 전광판 배지: 한국 주식은 "KRX 장 시간 · 무기한은 24H", 나머지(코인·미국 주식·금 무기한)는 24시간 거래
        emit({
          type: 'market', priceLine: Script.priceLine(snap), symbol: sym.symbol, display: sym.display, kind: sym.kind === 'krstock' ? 'krstock' : 'crypto',
          axis: snap.axis, tf: '5m',
          candles: snap.k5.slice(-CHART_BARS).map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c })),
        });
        log('> 실시간 시세 수신 완료');
        log(`> ${Script.priceLine(snap)}`);
        for (const l of Script.marketLines(an, snap)) log(`> ${l}`);
        await wait(600);

        log('── 애널리스트 팀 분석 ──', 'stage');
        if (mode === 'algo') {
          await round([{ id: 'taro', text: T.taro }, { id: 'diana', text: T.diana }, { id: 'nova', text: T.nova }, { id: 'vibe', text: T.vibe }]);
          log('── 리서치 토론 (BULL vs BEAR) ──', 'stage');
          await round([{ id: 'bull', turn: 1, text: T.bull[0] }, { id: 'bear', turn: 2, text: T.bear[0] }]);
          await round([{ id: 'bull', turn: 3, text: T.bull[1] }, { id: 'bear', turn: 4, text: T.bear[1] }]);
          log('── 수석 트레이더 1차 판정 ──', 'stage');
          await round([{ id: 'ace', text: T.ace }]);
          log('── 리스크 위원회 심사 ──', 'stage');
          await round([{ id: 'risky', text: T.risky }, { id: 'safe', text: T.safe }]);
          await round([{ id: 'neutral', text: T.neutral }]);
          log('── 포트폴리오 매니저 최종 승인 ──', 'stage');
          await round([{ id: 'pm', text: T.pm }]);
        } else {
          await round([{ id: 'taro', text: T.taro }, { id: 'vibe', text: T.vibe }]);
          log(`── 스캘핑 데스크 (${lev}x) ──`, 'stage');
          await round([{ id: 'blitz', text: T.blitz }]);
          await round([{ id: 'guard', text: T.guard }]);
          log('── 최종 판정 ──', 'stage');
          await round([{ id: 'ace', text: T.ace }]);
        }

        const { plan, gate, final } = an;
        const bal = deps.paper ? deps.paper.balance() : null;
        const sizing = final.side && bal != null
          ? { marginRequired: r2((bal * final.marginPct) / 100), notional: r2((bal * final.marginPct * lev) / 100), notionalPctOfAccount: final.marginPct * lev }
          : null;
        emit({
          type: 'risk', rr: gate.rr, ok: gate.ok, reasons: gate.reasons.slice(), sizing,
          downgradeReasons: gate.downgradeReasons.slice(), scope: 'scalp', side: plan.side, liq: gate.liq,
          stopBeyondLiq: gate.stopBeyondLiq, downgrade: gate.downgrade, minRR: null, mode,
        });
        log('── 리스크 게이트 ──', 'stage');
        for (const r of gate.reasons) log(`> ${r}`);

        const lv = (v) => (plan.side ? Script.fmtPrice(v) : '-');
        const dec = {
          type: 'decision', action: final.action, confidence: plan.confidence,
          entry: lv(plan.entry), stop: lv(plan.stop), target: lv(plan.target), rationale: T.rationale, report: T.ace.report,
        };
        if (mode === 'scalp') dec.scalp = { bias: final.bias, entry: lv(plan.entry), stop: lv(plan.stop), target: lv(plan.target), note: T.scalpNote };
        if (mode === 'algo') {
          dec.verdict = final.verdict;
          dec.sizing = T.pmSizing;
        }
        dec.rr = gate.rr;
        dec.riskOk = gate.ok;
        dec.riskReasons = gate.reasons.slice();
        dec.liq = gate.liq;
        if (sizing) dec.riskSizing = sizing;
        // 상단 차트용 — 실제로 들어가는 판정의 숫자 레벨, 그리고 규칙이 본 6시간 박스(관망일 때 "돌파 대기"선)
        dec.plan = final.side
          ? { side: final.side, entry: plan.entry, target: plan.target, stop: plan.stop, liq: plan.liq, lev, at: now() }
          : null;
        // 분석이 끝난 뒤에도 사무실이 이어서 이야기할 재료(VIBE 등)
        dec.mood = { rsi: an.sig.rsi, fng: snap.fng || null, fundingPct: Number.isFinite(snap.fundingPct) ? snap.fundingPct : null };
        const k5 = snap.k5;
        const box = an.sig.box;
        const n = k5.length;
        dec.rule = {
          trend: an.sig.trend, candidate: plan.candidate, trigger: plan.trigger, reason: plan.reason, trial: !!plan.trial,
          blocked: gate.downgrade ? 'LIQ' : final.verdict === 'REJECT' ? 'PM' : null,
          // 박스 = 마지막 봉 직전 72개 — 끝 시각은 그 마지막 봉이 닫히는 때
          box: box && n > box.bars + 2
            ? { high: box.high, low: box.low, from: k5[n - 1 - box.bars].t, to: k5[n - 2].t + (k5[n - 2].t - k5[n - 3].t) }
            : null,
        };
        emit(dec);
        log(`>>> 최종 판정: ${final.action} (${plan.confidence}%)${final.verdict ? ` · PM ${final.verdict}` : ''}`, 'stage');

        if (final.side && kiosk) {
          log('> 소개 화면 자동 시연 — 모의 포지션은 열지 않습니다');
        } else if (final.side && deps.paper) {
          const res = deps.paper.open({
            symbol: sym.symbol, display: sym.display, side: final.side, mode, entry: plan.entry, stop: plan.stop,
            target: plan.target, liq: plan.liq, leverage: lev, confidence: plan.confidence, rr: gate.rr,
            axis: snap.axis, marginPct: final.marginPct,
          });
          if (res.position) {
            emit({ type: 'position', action: 'open', position: res.position });
            log(`> 가상 포지션 오픈: ${sym.display} ${final.side} ${lev}x @ ${Script.fmtPrice(plan.entry)} · 증거금 ${res.position.margin.toFixed(2)} USDT · 청산가 ${Script.fmtPrice(plan.liq)}`);
          } else {
            log(`> 가상 포지션 보류 — ${res.skipped}`);
          }
        } else if (!final.side) {
          log('> 관망 — 이번 판정으로는 포지션을 열지 않습니다');
        }
      } catch (e) {
        fail(e && e.message ? e.message : String(e));
      } finally {
        emit({ type: 'run:end' });
        running = false;
      }
    }

    return { run, isRunning: () => running };
  }

  return { THINK, createBus, createEngine };
});
