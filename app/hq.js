/* ==========================================================================
   PIXEL TRADING FLOOR — hq.js
   "스스로 돈 버는 회사" 레이어 (app.js · stage.js 다음에 로드)
   · 수익 전광판 — 모의 계좌 잔고가 실시간으로 굴러간다
   · 대표실 — 체결·진입이 나면 직원이 걸어와 대표님께 보고한다
   · 자동 운영 — 상단 칩 + 설정창 (항목별 켜고 끄기, 토큰 드는 것만 따로)
   · 휴대폰(쇼츠) — 자막 바 · 판정 한 줄 · 벽 소품(창문·세계 시계·월 TV)
   숫자는 전부 서버 원장(/api/positions)에서 온다. 여기서 만들어내는 값은 없다.
   ========================================================================== */
'use strict';

const HQ = (() => {
  const MOBILE = document.documentElement.classList.contains('m');
  const S = {
    account: null,
    trades: [],
    open: [],
    seeded: false,
    seen: new Set(),
    shownEquity: null,
    rollRaf: 0,
    ap: null,
    running: false,
    runAuto: false,
    queue: [],
    reporting: false,
    lastReportAt: 0,
    capTimer: 0,
    challenge: null, // 서버 config.challenge — 실계좌 캡처 체크포인트
  };

  // 대표님 — 네이비 정장 + 빨간 넥타이 + 금테 안경
  if (typeof CHARACTERS === 'object' && !CHARACTERS.ceo) {
    CHARACTERS.ceo = {
      palette: { H: '#1c1c24', s: '#f0c8a0', E: '#241a2e', M: '#9a4a40', B: '#1d2a4a', D: '#c0392b', X: '#f2f2f8', G: '#e8c84a' },
      overrides: {
        5: '..HsGGGssGGGsH..',
        9: '...BBBXXXXBBB...',
        10: '..BBBXDDXBBBBB..',
        11: '..BBBBXDDXBBBB..',
        12: '..BBBBBDDBBBBB..',
      },
    };
  }

  const $ = (sel) => document.querySelector(sel);
  const fin = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const sideKo = (s) => (String(s).toUpperCase() === 'SHORT' ? '숏' : '롱');
  const escH = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function money(n, sign) {
    const v = fin(n);
    if (v == null) return '—';
    const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (!sign) return (v < 0 ? '-' : '') + s;
    return (v > 0 ? '+' : v < 0 ? '-' : '±') + s;
  }
  function pct(n, d) {
    const v = fin(n);
    if (v == null) return '—';
    const dd = d == null ? 2 : d;
    const a = Math.abs(v);
    // +4,558.73% 처럼 천 단위 콤마 — 챌린지 누적 수익률이 네 자리다
    const s = a >= 1000 ? a.toLocaleString('en-US', { minimumFractionDigits: dd, maximumFractionDigits: dd }) : a.toFixed(dd);
    return (v > 0 ? '+' : v < 0 ? '-' : '') + s + '%';
  }
  function cls(n) {
    const v = fin(n);
    return v == null || v === 0 ? 'flat' : v > 0 ? 'up' : 'down';
  }
  function sound(o) {
    try { if (typeof tone === 'function') tone(o); } catch (_) { /* 소리는 실패해도 무시 */ }
  }

  /* ---------------------------------------------------------------------
     1. 수익 전광판
     --------------------------------------------------------------------- */
  function onPositions(d) {
    if (!d) return;
    if (d.account) {
      S.account = d.account;
      S.challenge = d.challenge && Array.isArray(d.challenge.points) && d.challenge.points.length ? d.challenge : null;
    }
    if (Array.isArray(d.trades)) S.trades = d.trades;
    if (Array.isArray(d.open)) S.open = d.open;

    // 처음 받은 기록은 "이미 있던 것" — 새로 생긴 체결만 보고 연출한다
    const fresh = [];
    for (const t of S.trades) {
      if (!t || !t.id) continue;
      if (!S.seen.has(t.id)) {
        S.seen.add(t.id);
        if (S.seeded) fresh.push(t);
      }
    }
    S.seeded = true;
    renderBoard(fresh.map((t) => t.id));
    fresh.reverse().forEach((t) => queueCloseReport(t));
    renderTv();
  }

  function renderBoard(newIds) {
    const a = S.account;
    if (!a) return;
    rollEquity(fin(a.equity) != null ? fin(a.equity) : fin(a.balance));
    const ch = S.challenge;
    const lab = $('#pb-label-text');
    if (lab) lab.textContent = ch ? `◆ ${ch.title} ◆` : '◆ 모의 계좌 잔고 ◆';
    const basis = $('#pb-basis');
    if (basis) {
      const last = ch ? ch.points[ch.points.length - 1] : null;
      basis.textContent = last
        ? `${last.day}일차까지 실계좌 기록 · 이후 앱 모의 매매(실제 시세·수수료 반영) · 실주문 없음 · 투자 조언 아님`
        : '모의 계좌 · 실제 시세로 계산 · 수수료 반영 · 실주문 없음 · 투자 조언 아님';
    }

    const rp = $('#pb-ret-pct');
    if (rp) {
      const r = fin(a.equityReturnPct) != null ? a.equityReturnPct : a.returnPct;
      rp.textContent = (fin(r) > 0 ? '▲ ' : fin(r) < 0 ? '▼ ' : '') + pct(r);
      rp.className = cls(r);
    }
    const ra = $('#pb-ret-amt');
    if (ra) {
      const eq = fin(a.equity) != null ? a.equity : a.balance;
      const unr = fin(a.unrealized);
      ra.textContent =
        money(eq - a.start, true) + ' USDT' + (unr ? ' · 미실현 ' + money(unr, true) : '');
    }
    setStat('#pb-today', money(a.todayPnl, true), cls(a.todayPnl));
    setStat('#pb-wl', `${a.wins || 0}승 ${a.losses || 0}패`, '');
    setStat('#pb-wr', a.winRate == null ? '—' : Math.round(a.winRate) + '%', '');
    setStat('#pb-dd', a.maxDrawdownPct == null ? '—' : a.maxDrawdownPct.toFixed(1) + '%', '');
    drawCurve();

    const openBox = $('#pb-open');
    if (openBox) {
      const rows = S.open.filter((p) => p && !p.gateFailed);
      openBox.innerHTML = rows.length
        ? rows
            .map((p) => {
              const roe = fin(p.roePct);
              return `<span class="pb-chip open">${escH(p.display || p.symbol)} ${sideKo(p.side)} ${escH(p.leverage || '')}x <b class="${cls(roe)}">${roe == null ? '평가 대기' : pct(roe, 1) + ' ROE'}</b></span>`;
            })
            .join('')
        : '';
    }
    const tb = $('#pb-trades');
    if (tb) {
      const list = S.trades.slice(0, 8);
      tb.innerHTML = list.length
        ? list
            .map((t) => {
              const win = fin(t.pnl) > 0 || (t.pnl == null && fin(t.roePct) > 0);
              const k = t.excluded ? 'excl' : win ? 'win' : 'loss';
              const mark = t.excluded ? '·' : win ? '✓' : '✗';
              const fresh = newIds && newIds.includes(t.id) ? ' new' : '';
              return `<span class="pb-chip ${k}${fresh}" title="${escH(t.note || '')}">${mark} ${escH(t.display)} ${sideKo(t.side)} ${escH(t.reason || '')} <b class="${cls(t.roePct)}">${pct(t.roePct, 1)}</b>${t.pnl != null ? ` <em>${money(t.pnl, true)}</em>` : t.excluded ? ' <em>통계 제외</em>' : ''}</span>`;
            })
            .join('')
        : '<span class="pb-empty">첫 체결을 기다리는 중</span>';
    }
    const pile = $('#cash-pile');
    if (pile) {
      const r = fin(a.equityReturnPct) != null ? a.equityReturnPct : a.returnPct;
      pile.className = r < 0 ? 't0' : r < 5 ? 't1' : r < 15 ? 't2' : 't3';
    }
  }

  function setStat(sel, text, c) {
    const el = $(sel);
    if (!el) return;
    el.textContent = text;
    el.className = c || '';
  }

  // 잔고 숫자가 이전 값에서 새 값으로 굴러간다(슬롯머신처럼)
  function rollEquity(target) {
    const el = $('#pb-bal-num');
    if (!el || target == null) return;
    // 10만 USDT 이상(자릿수 증가)이면 글자를 줄여 옆 칸을 침범하지 않게
    el.classList.toggle('long', Math.abs(target) >= 100000);
    const from = S.shownEquity == null ? target : S.shownEquity;
    cancelAnimationFrame(S.rollRaf);
    if (from === target || (typeof STILL !== 'undefined' && STILL)) {
      S.shownEquity = target;
      el.textContent = money(target);
      return;
    }
    el.classList.remove('up', 'down');
    el.classList.add(target > from ? 'up' : 'down');
    const t0 = performance.now();
    const dur = Math.min(1800, 500 + Math.abs(target - from) * 20);
    // 프레임이 멈춘 탭에서도 최종값은 반드시 찍힌다
    clearTimeout(S.rollGuard);
    S.rollGuard = setTimeout(() => {
      cancelAnimationFrame(S.rollRaf);
      S.shownEquity = target;
      el.textContent = money(target);
      el.classList.remove('up', 'down');
    }, dur + 1500);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      const v = from + (target - from) * e;
      el.textContent = money(v);
      if (k < 1) {
        S.rollRaf = requestAnimationFrame(step);
      } else {
        S.shownEquity = target;
        clearTimeout(S.rollGuard);
        setTimeout(() => el.classList.remove('up', 'down'), 900);
      }
    };
    S.rollRaf = requestAnimationFrame(step);
  }

  function drawCurve() {
    const cv = $('#pb-curve');
    const a = S.account;
    if (!cv || !a) return;
    const w = Math.max(120, Math.round(cv.clientWidth || 360));
    const h = Math.max(24, Math.round(cv.clientHeight || 56));
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    let pts = (a.curve || []).map((p) => p.b).filter((b) => fin(b) != null);
    // 챌린지 기록이 있으면 1일차부터 이어 그린다 — 앱 곡선의 첫 점은 마지막 기록과 같은 잔고라 뺀다
    if (S.challenge) pts = S.challenge.points.map((p) => p.balance).concat(pts.slice(1));
    const eq = fin(a.equity);
    if (eq != null) pts.push(eq);
    if (pts.length < 2) {
      ctx.fillStyle = '#4f7a61';
      ctx.font = '10px Galmuri11, monospace';
      ctx.fillText('수익 곡선 — 체결이 쌓이면 그려집니다', 6, h / 2 + 3);
      return;
    }
    const lo = Math.min(a.start, ...pts);
    const hi = Math.max(a.start, ...pts);
    const pad = (hi - lo) * 0.15 || 1;
    const y = (v) => h - 3 - ((v - (lo - pad)) / (hi - lo + pad * 2)) * (h - 6);
    const x = (i) => 3 + (i / (pts.length - 1)) * (w - 6);
    // 시작 잔고 기준선
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, y(a.start));
    ctx.lineTo(w, y(a.start));
    ctx.stroke();
    ctx.setLineDash([]);
    const up = pts[pts.length - 1] >= a.start;
    const line = up ? '#3ddc84' : '#ff5c5c';
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, up ? 'rgba(61,220,132,.35)' : 'rgba(255,92,92,.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.moveTo(x(0), h);
    pts.forEach((v, i) => ctx.lineTo(x(i), y(v)));
    ctx.lineTo(x(pts.length - 1), h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    pts.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    ctx.stroke();
    // 마지막 점
    ctx.fillStyle = '#fff';
    ctx.fillRect(x(pts.length - 1) - 2, y(pts[pts.length - 1]) - 2, 4, 4);
  }

  /* ---------------------------------------------------------------------
     1-b. 수익표 — 챌린지 일차별 잔고(실계좌 캡처) + 앱 모의 매매 기록
     전광판을 누르거나 [📈 수익표]로 연다. 녹화용으로 줄이 하나씩 올라온다.
     --------------------------------------------------------------------- */
  function openProfitTable() {
    let m = $('#pt-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'pt-modal';
      m.className = 'hidden';
      m.innerHTML = '<div class="modal-box pt-box"><button id="pt-close" type="button">✕</button><div id="pt-body"></div></div>';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m || e.target.id === 'pt-close') m.classList.add('hidden'); });
    }
    const ch = S.challenge;
    const a = S.account;
    const eq = a ? (fin(a.equity) != null ? fin(a.equity) : fin(a.balance)) : null;
    let html = '';
    if (ch) {
      const rows = ch.points.map((p, i) => {
        const prev = i ? ch.points[i - 1].balance : ch.start;
        return { label: `${p.day}일차`, sub: p.note || '', bal: p.balance, chg: i ? p.balance - prev : null, chgPct: i && prev ? ((p.balance - prev) / prev) * 100 : null };
      });
      const last = ch.points[ch.points.length - 1];
      if (eq != null) {
        rows.push({ label: '지금', sub: '앱 모의', bal: eq, chg: eq - last.balance, chgPct: ((eq - last.balance) / last.balance) * 100, live: true });
      }
      const max = Math.max(...rows.map((r) => r.bal));
      const cum = (b) => ((b - ch.start) / ch.start) * 100;
      const now = rows[rows.length - 1];
      html += `<div class="pt-title">📈 ${escH(ch.title)} 수익표</div>`;
      html += `<div class="pt-hero"><span>${money(ch.start)}</span><i>→</i><b>${money(now.bal)}</b><small>USDT</small><em class="${cls(cum(now.bal))}">${pct(cum(now.bal))}</em></div>`;
      html += '<div class="pt-table"><div class="pt-row pt-head"><span>일차</span><span>잔고 (USDT)</span><span>직전 대비</span><span>누적</span></div>';
      rows.forEach((r, i) => {
        const w = Math.max(2, Math.round((r.bal / max) * 100));
        html += `<div class="pt-row${r.live ? ' live' : ''}" style="animation-delay:${(i * 0.09).toFixed(2)}s">` +
          `<span class="pt-day">${escH(r.label)}${r.sub ? `<small>${escH(r.sub)}</small>` : ''}</span>` +
          `<span class="pt-bal"><i style="width:${w}%"></i><b>${money(r.bal)}</b></span>` +
          `<span class="${cls(r.chg)}">${r.chg == null ? '시작' : pct(r.chgPct, 1)}</span>` +
          `<span class="${cls(cum(r.bal))}">${pct(cum(r.bal), 0)}</span></div>`;
      });
      html += '</div>';
      html += `<div class="pt-note">${last.day}일차까지: ${escH(ch.source)} · 이후: 앱 모의 매매(실주문 없음) · 기록 사이 구간의 손실·낙폭은 표에 보이지 않습니다</div>`;
    } else {
      html += '<div class="pt-title">📈 수익표</div>';
      html += '<div class="pt-note">챌린지 기록이 없습니다. config.json의 challenge.points에 일차별 잔고를 넣으면 여기 표로 나옵니다.</div>';
    }
    // 앱 모의 매매 기록 (최근 12건)
    const trades = S.trades.filter((t) => t && !t.excluded).slice(0, 12);
    html += '<div class="pt-sub">앱 모의 매매 기록' + (a ? ` · ${a.wins || 0}승 ${a.losses || 0}패` + (a.winRate == null ? '' : ` · 승률 ${Math.round(a.winRate)}%`) : '') + '</div>';
    html += trades.length
      ? '<div class="pt-trades">' + trades.map((t) => {
          const d = new Date(t.closedAt);
          const when = Number.isFinite(d.getTime()) ? d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
          return `<div class="pt-trow"><span>${escH(when)}</span><span>${escH(t.display)} ${sideKo(t.side)} ${escH(t.leverage)}x</span><span class="${cls(t.roePct)}">${pct(t.roePct, 1)}</span><span class="${cls(t.pnl)}">${money(t.pnl, true)}</span></div>`;
        }).join('') + '</div>'
      : '<div class="pt-note">아직 앱에서 청산된 거래가 없습니다.</div>';
    const body = $('#pt-body');
    if (body) body.innerHTML = html;
    m.classList.remove('hidden');
  }

  /* ---------------------------------------------------------------------
     2. 대표님 보고 — 직원이 걸어와서 보고하고 돌아간다 (큐로 하나씩)
     --------------------------------------------------------------------- */
  function reportsOn() {
    return !(S.ap && S.ap.config && S.ap.config.reports === false);
  }

  function fxLayer() {
    let fx = document.getElementById('fx-layer');
    if (!fx) {
      const f = $('#floor');
      if (!f) return null;
      fx = document.createElement('div');
      fx.id = 'fx-layer';
      f.appendChild(fx);
    }
    return fx;
  }

  function floorPos(el) {
    const f = $('#floor');
    if (!el || !f) return null;
    const a = el.getBoundingClientRect();
    const b = f.getBoundingClientRect();
    if (!a.width && !a.height) return null;
    const k = f.offsetWidth ? b.width / f.offsetWidth : 1; // 녹화 프레임 zoom 보정
    return { x: (a.left - b.left + a.width / 2) / k, y: (a.top - b.top + a.height / 2) / k, k };
  }

  function visibleDesk(id) {
    const d = deskEl(id);
    if (!d || getComputedStyle(d).display === 'none' || d.classList.contains('idle')) return null;
    return d;
  }

  function reporterFor(mode) {
    const pref = mode === 'algo' ? ['pm', 'ace'] : ['ace', 'blitz', 'pm'];
    for (const id of pref) if (visibleDesk(id)) return id;
    return 'ace';
  }

  function queueReport(r) {
    S.queue.push(r);
    pumpReports();
  }

  function queueCloseReport(t) {
    if (t.excluded) return;
    const win = fin(t.pnl) > 0;
    const who = reporterFor(t.mode);
    const reasonLine =
      t.reason === '익절'
        ? '목표가 도달로 익절했습니다!'
        : t.reason === '손절'
        ? '손절 라인에서 정리했습니다.'
        : t.reason === '강제 청산'
        ? '강제 청산됐습니다… 죄송합니다.'
        : t.reason === '보유 시간 만료'
        ? '보유 시간이 다 돼서 정리했습니다.'
        : '포지션 정리했습니다.';
    const text = win
      ? `대표님! ${t.display} ${sideKo(t.side)} ${reasonLine} ${pct(t.roePct, 1)} ROE, 계좌 ${money(t.pnl, true)} USDT 벌었습니다 💰`
      : `대표님… ${t.display} ${sideKo(t.side)} ${reasonLine} ${pct(t.roePct, 1)} ROE (${money(t.pnl, true)} USDT). 다음에 만회하겠습니다.`;
    queueReport({ who, text, kind: win ? 'win' : 'loss', pnl: t.pnl, title: `${NAMES[who] || who} → 대표님` });
  }

  function pumpReports() {
    if (S.reporting || !S.queue.length) return;
    const r = S.queue.shift();
    S.reporting = true;
    S.lastReportAt = Date.now();
    deliver(r).finally(() => {
      S.reporting = false;
      setTimeout(pumpReports, 400);
    });
  }

  function deliver(r) {
    return new Promise((resolve) => {
      caption(r.who, r.title || '대표님께 보고', r.text, r.kind);
      const walk = reportsOn() && !(typeof STILL !== 'undefined' && STILL) && !document.hidden;
      const fx = fxLayer();
      const desk = visibleDesk(r.who) || deskEl(r.who);
      const ceo = $('#ceo-desk');
      const from = floorPos(desk && desk.querySelector('.sprite'));
      const to = floorPos($('#ceo-sprite'));
      if (!walk || !fx || !from || !to) {
        showCeoReport(r);
        settleEffects(r);
        setTimeout(resolve, 3200);
        return;
      }
      const sprite = desk.querySelector('.sprite');
      const size = sprite.clientWidth || 48;
      const walker = document.createElement('canvas');
      walker.width = 48;
      walker.height = 48;
      walker.className = 'walker reporter';
      walker.style.width = size + 'px';
      walker.style.height = size + 'px';
      drawSprite(walker, r.who);
      walker.style.left = from.x - size / 2 + 'px';
      walker.style.top = from.y - size / 2 + 'px';
      fx.appendChild(walker);
      const paper = document.createElement('i');
      paper.className = 'carry';
      fx.appendChild(paper);
      if (sprite) sprite.classList.add('away');

      // 대표님 책상 왼쪽 앞까지 걸어간다. 움직임은 CSS 전환, 순서는 타이머로 잡는다 —
      // 탭이 잠깐 가려져 애니메이션 프레임이 멈춰도 보고 대기열이 막히지 않게.
      const dest = { x: to.x - size * 1.1, y: to.y + size * 0.1 };
      const dx = dest.x - from.x;
      const dy = dest.y - from.y;
      const dur = Math.round(Math.max(900, Math.min(2600, Math.hypot(dx, dy) * 6)));
      const steps = Math.max(6, Math.round(dur / 90));
      paper.style.left = from.x + size * 0.25 + 'px';
      paper.style.top = from.y - size * 0.1 + 'px';
      const move = (x, y) => {
        const tr = `transform ${dur}ms steps(${steps}, end)`;
        walker.style.transition = tr;
        paper.style.transition = tr;
        walker.style.transform = `translate(${x}px, ${y}px)`;
        paper.style.transform = `translate(${x}px, ${y}px)`;
      };
      walker.classList.add('walking');
      void walker.offsetWidth;
      setTimeout(() => move(dx, dy), 30);
      setTimeout(arrive, dur + 60);

      function arrive() {
        walker.classList.remove('walking');
        paper.remove();
        showCeoReport(r);
        settleEffects(r, walker);
        setTimeout(() => {
          walker.classList.add('walking');
          move(0, 0);
          setTimeout(() => {
            walker.remove();
            if (sprite) sprite.classList.remove('away');
            resolve();
          }, dur + 60);
        }, 3600);
      }
    });
  }

  function showCeoReport(r) {
    const box = $('#ceo-report');
    if (!box) return;
    box.innerHTML = `<b>${escH(r.title || '보고')}</b>${escH(r.text)}`;
    box.className = r.kind === 'win' ? 'win' : r.kind === 'loss' ? 'loss' : '';
    clearTimeout(box._t);
    box._t = setTimeout(() => box.classList.add('hidden'), 4200);
  }

  function settleEffects(r, walker) {
    const ceo = $('#ceo-sprite');
    const board = $('#pnl-board');
    if (r.kind === 'win') {
      if (ceo) { ceo.classList.remove('cheer'); void ceo.offsetWidth; ceo.classList.add('cheer'); }
      if (board) { board.classList.remove('flash-win'); void board.offsetWidth; board.classList.add('flash-win'); }
      coinBurst(fin(r.pnl));
      cheerOffice();
      sound({ freq: 988, dur: 0.06, vol: 0.05 });
      sound({ freq: 1319, dur: 0.14, vol: 0.05, delay: 0.07 });
      sound({ freq: 1760, dur: 0.18, vol: 0.04, delay: 0.16 });
    } else if (r.kind === 'loss') {
      if (ceo) { ceo.classList.remove('sad'); void ceo.offsetWidth; ceo.classList.add('sad'); }
      if (board) { board.classList.remove('flash-loss'); void board.offsetWidth; board.classList.add('flash-loss'); }
      floatAmount(fin(r.pnl), 'loss');
      if (walker) sweat(walker);
      sound({ freq: 330, to: 140, dur: 0.35, vol: 0.05, type: 'sawtooth' });
    } else {
      sound({ freq: 880, dur: 0.05, vol: 0.035 });
    }
  }

  function coinBurst(amount) {
    if (typeof STILL !== 'undefined' && STILL) return;
    const src = $('#ceo-sprite');
    const dst = $('#pb-bal-num');
    if (!src || !dst) return;
    const a = src.getBoundingClientRect();
    const b = dst.getBoundingClientRect();
    const n = 14;
    for (let i = 0; i < n; i++) {
      const c = document.createElement('i');
      c.className = 'coin';
      const sx = a.left + a.width / 2 + (Math.random() * 30 - 15);
      const sy = a.top + a.height / 2;
      c.style.left = sx + 'px';
      c.style.top = sy + 'px';
      document.body.appendChild(c);
      const tx = b.left + b.width * (0.2 + Math.random() * 0.6) - sx;
      const ty = b.top + b.height / 2 - sy;
      const lift = -60 - Math.random() * 70;
      const anim = c.animate(
        [
          { transform: 'translate(0,0)' },
          { transform: `translate(${tx * 0.35}px, ${lift}px)` },
          { transform: `translate(${tx}px, ${ty}px)` },
        ],
        { duration: 900 + i * 45, easing: 'steps(14, end)', fill: 'forwards' }
      );
      anim.onfinish = () => c.remove();
      setTimeout(() => sound({ freq: 1500 + (i % 4) * 120, dur: 0.03, vol: 0.02 }), 700 + i * 45);
    }
    setTimeout(() => floatAmount(amount, 'win'), 850);
  }

  function floatAmount(amount, kind) {
    const dst = $('#pb-bal-num');
    if (!dst || amount == null) return;
    const b = dst.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'float-amt ' + kind;
    el.textContent = money(amount, true) + ' USDT';
    el.style.left = b.left + b.width + 6 + 'px';
    el.style.top = b.top - 4 + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }

  function sweat(walker) {
    const fx = fxLayer();
    if (!fx) return;
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        const s = document.createElement('i');
        s.className = 'sweat';
        s.style.left = parseFloat(walker.style.left) + 30 + 'px';
        s.style.top = parseFloat(walker.style.top) + 4 + 'px';
        s.style.transform = walker.style.transform;
        fx.appendChild(s);
        setTimeout(() => s.remove(), 1100);
      }, i * 350);
    }
  }

  // 이익이 나면 사무실 전체가 들썩인다
  function cheerOffice() {
    AGENT_IDS.forEach((id, i) => {
      const d = visibleDesk(id);
      if (!d) return;
      setTimeout(() => {
        d.classList.remove('jump');
        void d.offsetWidth;
        d.classList.add('jump');
        setTimeout(() => d.classList.remove('jump'), 1100);
      }, i * 60);
    });
  }

  // 정기 보고 — 오늘 성과와 보유 현황 (원장 숫자 그대로)
  function periodicBriefing() {
    if (!reportsOn() || S.running || S.reporting || document.hidden) return;
    const a = S.account;
    if (!a) return;
    const open = S.open.filter((p) => p && !p.gateFailed);
    if (!open.length && !(a.wins + a.losses)) return;
    const parts = [`대표님, 정기 보고입니다. 계좌 ${money(a.equity)} USDT (${pct(a.equityReturnPct)})`];
    if (a.todayTrades) parts.push(`오늘 ${a.todayTrades}건 ${money(a.todayPnl, true)} USDT`);
    if (open.length) {
      parts.push(
        '보유 ' +
          open
            .slice(0, 2)
            .map((p) => `${p.display || p.symbol} ${sideKo(p.side)} ${p.roePct == null ? '평가 대기' : pct(p.roePct, 1)}`)
            .join(', ')
      );
    }
    queueReport({ who: visibleDesk('pm') ? 'pm' : 'ace', text: parts.join(' · ') + '.', kind: 'info', title: '정기 보고' });
  }

  /* ---------------------------------------------------------------------
     3. 자동 운영 — 칩 · 설정창 · 월 TV
     --------------------------------------------------------------------- */
  const CALLS = { algo: 13, scalp: 5, attack: 5 };
  const MODE_KO = { algo: '알고리즘', scalp: '⚡스캘핑', attack: '⚔공격' };

  async function loadAutopilot() {
    try {
      const r = await fetch('/api/autopilot', { cache: 'no-store' });
      if (!r.ok) return;
      applyAp(await r.json());
    } catch (_) { /* 서버가 구버전이면 칩만 꺼진 채로 둔다 */ }
  }

  function applyAp(st) {
    if (!st || !st.config) return;
    S.ap = st;
    // 레버리지 배율 — 선택 상자·화면 곳곳의 "20x" 표기를 설정값으로
    if (st.risk && fin(st.risk.leverage) > 0) {
      setLevUI(st.risk.leverage);
      document.querySelectorAll('.dp-scalp-head').forEach((el) => {
        el.textContent = el.textContent.replace(/\d+x/, window.LEV + 'x');
      });
    }
    document.body.classList.toggle('no-life', st.config.officeLife === false);
    renderChip();
    renderTv();
  }

  function mmss(ms) {
    if (!(ms > 0)) return '0:00';
    const s = Math.round(ms / 1000);
    const m = Math.floor(s / 60);
    return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  function renderChip() {
    const chip = $('#auto-chip');
    if (!chip) return;
    const st = S.ap;
    const on = !!(st && st.config && st.config.enabled);
    chip.classList.toggle('on', on);
    chip.classList.toggle('demo', on && st.config.ai === false);
    chip.classList.toggle('busy', on && S.running);
    const txt = $('#ac-text');
    const nx = $('#ac-next');
    if (!on) {
      if (txt) txt.textContent = 'AUTO OFF';
      if (nx) nx.textContent = '';
      return;
    }
    const c = st.config;
    if (txt) txt.textContent = `AUTO ${c.ai ? c.model.toUpperCase() : '연출'} · ${MODE_KO[c.mode] || c.mode}`;
    if (nx) {
      if (S.running) nx.textContent = S.runAuto ? '· 분석 중' : '· 수동 분석 중';
      else if (st.nextRunAt) nx.textContent = '· ' + mmss(st.nextRunAt - Date.now());
      else nx.textContent = '';
    }
  }

  function renderTv() {
    const l1 = $('#tv-line1');
    const l2 = $('#tv-line2');
    const st = S.ap;
    const on = !!(st && st.config && st.config.enabled);
    if (l1) {
      if (S.running) l1.textContent = '분석 진행 중';
      else if (on && st.nextRunAt) l1.textContent = `자동 운영 · 다음 분석 ${mmss(st.nextRunAt - Date.now())}`;
      else if (on) l1.textContent = st.lastSkip ? st.lastSkip.reason : '자동 운영 중';
      else l1.textContent = '자동 운영 대기';
    }
    if (l2) {
      const a = S.account;
      const open = S.open.filter((p) => p && !p.gateFailed).length;
      l2.textContent = a ? `보유 ${open} · 오늘 ${money(a.todayPnl, true)} · 누적 ${pct(a.equityReturnPct)}` : '';
    }
  }

  function openApModal() {
    const m = $('#ap-modal');
    if (!m) return;
    const c = (S.ap && S.ap.config) || {};
    const set = (sel, v) => { const el = $(sel); if (el) el.value = String(v); };
    const chk = (sel, v) => { const el = $(sel); if (el) el.checked = !!v; };
    chk('#ap-enabled', c.enabled);
    const q = $('#ap-quick');
    if (q) {
      q.classList.toggle('stop', !!c.enabled);
      q.textContent = c.enabled ? '⏹ 자동 운영 끄기' : '▶ 자동 운영 켜기 (지금 설정대로)';
    }
    set('#ap-ai', c.ai === false ? '0' : '1');
    set('#ap-model', c.model || 'sonnet');
    set('#ap-mode', c.mode || 'scalp');
    set('#ap-interval', c.intervalMin || 30);
    set('#ap-maxopen', c.maxOpen || 3);
    set('#ap-symbols', (c.symbols || []).join(', '));
    chk('#ap-settle', c.settle !== false);
    chk('#ap-reports', c.reports !== false);
    chk('#ap-life', c.officeLife !== false);
    setLevUI(S.ap && S.ap.risk ? S.ap.risk.leverage : 20);
    const os = $('#once-symbol');
    const sym = $('#board-symbol') && $('#board-symbol').textContent.trim();
    if (os && !os.dataset.touched && sym && sym !== '—') os.value = sym;
    updateCost();
    const stEl = $('#ap-state');
    if (stEl) {
      const st = S.ap || {};
      stEl.textContent = st.lastRun
        ? `마지막: ${st.lastRun.symbol} ${new Date(st.lastRun.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} · 오늘 ${st.cyclesToday || 0}회`
        : st.lastSkip ? st.lastSkip.reason : '아직 실행 기록 없음';
    }
    m.classList.remove('hidden');
  }

  function formPatch() {
    const v = (sel) => ($(sel) ? $(sel).value : '');
    const c = (sel) => !!($(sel) && $(sel).checked);
    return {
      enabled: c('#ap-enabled'),
      ai: v('#ap-ai') !== '0',
      model: v('#ap-model'),
      mode: v('#ap-mode'),
      intervalMin: Number(v('#ap-interval')),
      maxOpen: Number(v('#ap-maxopen')),
      symbols: v('#ap-symbols').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
      settle: c('#ap-settle'),
      reports: c('#ap-reports'),
      officeLife: c('#ap-life'),
      leverage: Number(v('#once-lev')) || undefined,
    };
  }

  // 레버리지 선택 상자 두 개(상단 바·1회 분석 줄)를 같은 값으로 맞춘다.
  // 목록에 없는 배율(config.json에서 직접 바꾼 값)도 그대로 보이게 항목을 추가한다
  function setLevUI(lev) {
    const v = fin(lev);
    if (!(v > 0)) return;
    ['#lev-select', '#once-lev'].forEach((sel) => {
      const el = $(sel);
      if (!el) return;
      if (![...el.options].some((o) => Number(o.value) === v)) {
        const o = document.createElement('option');
        o.value = String(v);
        o.textContent = v + '배';
        el.appendChild(o);
        [...el.options].sort((a, b) => Number(a.value) - Number(b.value)).forEach((o) => el.appendChild(o));
      }
      el.value = String(v);
    });
    window.LEV = v;
    const rl = $('#scalp-room-label');
    if (rl) rl.textContent = rl.textContent.replace(/\d+x/, v + 'x');
    updateLevWarn();
  }

  // 배율을 고르면 청산까지 여유·왕복 수수료를 바로 보여 준다 (격리 기준)
  function updateLevWarn() {
    const el = $('#ap-lev-warn');
    if (!el) return;
    const lev = Number($('#once-lev') ? $('#once-lev').value : 0);
    if (!(lev > 0)) { el.textContent = ''; return; }
    const r = (S.ap && S.ap.risk) || {};
    const mm = fin(r.maintenanceMarginPct) != null ? r.maintenanceMarginPct : 0.5;
    const fee = fin(r.feePct) != null ? r.feePct : 0.06;
    const buf = Math.max(0, 100 / lev - mm);
    const feeOfMargin = fee * 2 * lev;
    el.className = 'ap-lev-warn' + (lev >= 50 ? ' hot' : '');
    el.textContent =
      `⚠ ${lev}배 격리: 약 ${buf.toFixed(2)}% 역행하면 증거금 전액 청산 · ` +
      `왕복 수수료만 증거금의 ${feeOfMargin.toFixed(1)}%` +
      (lev >= 50 ? ' · 손절이 청산가 너머면 리스크 게이트가 판정을 강등합니다' : '');
  }

  async function runOnce() {
    const sym = ($('#once-symbol') ? $('#once-symbol').value : '').trim();
    if (!sym) { if (typeof toast === 'function') toast('종목을 입력하세요', 'err'); return; }
    const mode = $('#once-mode') ? $('#once-mode').value : 'scalp';
    const p = formPatch();
    const btn = $('#once-run');
    if (btn) btn.disabled = true;
    try {
      // 레버리지는 /api/analyze가 받아서 저장한 뒤 그 배율로 분석한다
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, mode, model: p.model, leverage: p.leverage, demo: (typeof DEMO !== 'undefined' && DEMO) || !p.ai }),
      });
      if (res.ok && p.leverage && S.ap && S.ap.risk) { S.ap.risk.leverage = p.leverage; }
      if (res.status === 409) { if (typeof toast === 'function') toast('이미 분석 중입니다', 'err'); return; }
      if (!res.ok) { if (typeof toast === 'function') toast('요청 실패 (' + res.status + ')', 'err'); return; }
      $('#ap-modal').classList.add('hidden');
      if (typeof toast === 'function') toast(`${sym} ${MODE_KO[mode] || mode} 1회 분석 시작 — ${p.ai ? p.model : '연출'}`, 'ok');
    } catch (_) {
      if (typeof toast === 'function') toast('서버에 연결할 수 없습니다', 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function updateCost() {
    updateLevWarn();
    const el = $('#ap-cost');
    if (!el) return;
    const p = formPatch();
    const modelSel = $('#ap-model');
    if (modelSel) modelSel.disabled = !p.ai;
    if (!p.enabled) { el.textContent = '꺼짐'; return; }
    if (!p.ai) { el.textContent = '토큰 0 · 매매 기록 없음(연출만)'; return; }
    const perHour = ((CALLS[p.mode] || 5) * 60) / (p.intervalMin || 30);
    el.textContent = `AI 호출 약 ${perHour % 1 ? perHour.toFixed(1) : perHour}회/시간 · ${p.model}`;
  }

  async function saveAp(extra) {
    try {
      const r = await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign(formPatch(), extra || {})),
      });
      if (!r.ok) {
        if (typeof toast === 'function') toast('자동 운영 저장 실패 (' + r.status + ')', 'err');
        return;
      }
      applyAp(await r.json());
      $('#ap-modal').classList.add('hidden');
      if (typeof toast === 'function') {
        const c = S.ap.config;
        toast(c.enabled ? `자동 운영 켜짐 — ${c.ai ? c.model : '연출'} · ${c.intervalMin}분마다` : '자동 운영 꺼짐', 'ok');
      }
    } catch (_) {
      if (typeof toast === 'function') toast('서버에 연결할 수 없습니다', 'err');
    }
  }

  /* ---------------------------------------------------------------------
     3-b. 녹화 · 휴대폰 안내창 — 주소를 외우지 않아도 되게
     --------------------------------------------------------------------- */
  function drawQr(canvas, text) {
    if (!canvas || typeof qrMatrix !== 'function') return false;
    const m = qrMatrix(text);
    if (!m) return false;
    const n = m.length;
    const quiet = 2;
    const cell = Math.floor(canvas.width / (n + quiet * 2));
    const off = Math.floor((canvas.width - cell * n) / 2);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) ctx.fillRect(off + x * cell, off + y * cell, cell, cell);
    return true;
  }

  async function openRecModal() {
    const modal = $('#rec-modal');
    if (!modal) return;
    const port = location.port || '8000';
    const frameUrl = `${location.protocol}//localhost:${port}/?frame=1&rec=1`;
    const fu = $('#rec-frame-url');
    if (fu) fu.textContent = frameUrl;
    let ips = [];
    try {
      const r = await fetch('/api/hostinfo', { cache: 'no-store' });
      if (r.ok) ips = (await r.json()).lanIps || [];
    } catch (_) { /* 구버전 서버면 현재 호스트로 대체 */ }
    // 이미 휴대폰(다른 기기)에서 열었다면 현재 주소가 곧 접속 주소다
    const host = ips[0] || location.hostname;
    const phoneUrl = `http://${host}:${port}/?rec=1`;
    const pu = $('#rec-phone-url');
    if (pu) pu.textContent = phoneUrl;
    const other = $('#rec-other-ips');
    if (other) {
      other.textContent = ips.length > 1 ? '안 되면 이 주소로: ' + ips.slice(1).map((ip) => `http://${ip}:${port}/?rec=1`).join(' · ') : '';
    }
    const ok = drawQr($('#rec-qr'), phoneUrl);
    if (!ok && $('#rec-qr')) {
      const c = $('#rec-qr').getContext('2d');
      c.fillStyle = '#fff'; c.fillRect(0, 0, 200, 200);
      c.fillStyle = '#000'; c.font = '12px Galmuri11, monospace'; c.fillText('QR 생성 실패 — 주소를 직접 입력', 8, 100);
    }
    modal.classList.remove('hidden');
  }

  function initRecModal() {
    const btn = $('#rec-btn');
    if (btn) btn.addEventListener('click', openRecModal);
    const modal = $('#rec-modal');
    if (!modal) return;
    const close = () => modal.classList.add('hidden');
    const x = $('#rec-close');
    if (x) x.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    const port = location.port || '8000';
    const of = $('#rec-open-frame');
    if (of) of.addEventListener('click', () => window.open(`/?frame=1&rec=1`, '_blank'));
    const ov = $('#rec-open-vertical');
    if (ov) ov.addEventListener('click', () => window.open(`/?vertical=1&rec=1`, '_blank'));
    const on = $('#rec-open-normal');
    if (on) on.addEventListener('click', () => window.open(`/?rec=1`, '_blank'));
    modal.querySelectorAll('.rec-copy').forEach((b) => {
      b.addEventListener('click', async () => {
        const el = document.getElementById(b.dataset.copy);
        if (!el) return;
        try {
          await navigator.clipboard.writeText(el.textContent);
          b.textContent = '복사됨';
          b.classList.add('done');
          setTimeout(() => { b.textContent = '복사'; b.classList.remove('done'); }, 1500);
        } catch (_) {
          const r = document.createRange(); r.selectNodeContents(el);
          const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        }
      });
    });
  }

  /* ---------------------------------------------------------------------
     4. 자막 · 판정 한 줄 (휴대폰) · 자동 사이클 배너
     --------------------------------------------------------------------- */
  let capTyper = 0;
  function caption(id, name, text, kind) {
    // 대표님 보고(진입·청산·분석 보고)는 자막 바에 나온다 — 피드가 자동으로 펼쳐진 상태면 접어서 보이게
    if (kind && F.open && !F.manual) feedClose(false);
    const face = $('#cap-face');
    if (face && id && CHARACTERS[id]) drawSprite(face, id);
    const nm = $('#cap-name');
    if (nm) nm.textContent = name || NAMES[id] || id || '';
    const box = $('#caption');
    if (box) {
      box.classList.toggle('report', kind === 'win' || kind === 'loss' || kind === 'info');
      box.classList.toggle('loss', kind === 'loss');
    }
    const line = $('#cap-line');
    if (!line) return;
    clearInterval(capTyper);
    const full = String(text || '');
    if (!MOBILE || (typeof STILL !== 'undefined' && STILL)) { line.textContent = full; return; }
    let i = 0;
    line.textContent = '';
    capTyper = setInterval(() => {
      i += 2;
      line.textContent = full.slice(0, i);
      if (i >= full.length) clearInterval(capTyper);
    }, 28);
  }

  /* ---------------------------------------------------------------------
     4-b. 분석 피드 (휴대폰) — 콘솔·말풍선이 없는 화면에서 "뒤에서 뭐가 돌아가는지"
     단계·발언·리스크 게이트·판정을 순서대로 한 칸에 보여 준다.
     분석 중 자동으로 펼쳐지고, 끝나면 잠시 뒤 접힌다. 머리글을 누르면 직접 접고 편다.
     --------------------------------------------------------------------- */
  const F = { open: false, manual: false, done: 0, total: 5, rows: 0, closeTimer: 0, typer: 0, curRow: null };

  function feedOpen(manual) {
    const el = $('#m-feed');
    if (!el || !MOBILE) return;
    clearTimeout(F.closeTimer);
    el.classList.add('open');
    document.body.classList.add('feed-open');
    const t = $('#mf-toggle');
    if (t) t.textContent = '▾';
    F.open = true;
    if (manual) F.manual = true;
    feedScroll();
  }

  function feedClose(manual) {
    const el = $('#m-feed');
    if (!el) return;
    clearTimeout(F.closeTimer);
    el.classList.remove('open');
    document.body.classList.remove('feed-open');
    const t = $('#mf-toggle');
    if (t) t.textContent = '▸';
    F.open = false;
    if (manual) F.manual = true;
  }

  function feedReset(title, total) {
    const body = $('#mf-body');
    if (body) body.innerHTML = '';
    F.done = 0;
    F.total = total || 5;
    F.rows = 0;
    F.manual = false;
    F.curRow = null;
    clearInterval(F.typer);
    const el = $('#m-feed');
    if (el) el.classList.remove('done');
    const tt = $('#mf-title');
    if (tt) tt.textContent = title || '분석 피드';
    feedProgress(null);
  }

  function feedProgress(curId) {
    const p = $('#mf-prog');
    const bar = $('#mf-bar b');
    const pct = Math.min(100, Math.round((F.done / F.total) * 100));
    if (bar) bar.style.width = pct + '%';
    if (p) {
      p.textContent = curId
        ? `${Math.min(F.done + 1, F.total)}/${F.total} ${NAMES[curId] || curId}`
        : `${F.done}/${F.total}`;
    }
  }

  function feedScroll() {
    const body = $('#mf-body');
    if (body) body.scrollTop = body.scrollHeight;
  }

  // 한 줄 추가. kind: sys | stage | agent | gate | verdict | end
  function feedRow(kind, who, text, opts) {
    const body = $('#mf-body');
    if (!body) return null;
    const row = document.createElement('div');
    row.className = 'mf-row ' + kind;
    if (who) {
      const w = document.createElement('span');
      w.className = 'mf-who';
      w.textContent = who;
      if (opts && opts.tint) row.style.setProperty('--tint', opts.tint);
      row.appendChild(w);
    }
    const t = document.createElement('span');
    t.className = 'mf-text';
    t.textContent = opts && opts.type ? '' : String(text || '');
    row.appendChild(t);
    if (opts && opts.full) {
      const f = document.createElement('div');
      f.className = 'mf-full';
      f.textContent = opts.full;
      row.appendChild(f);
    }
    body.appendChild(row);
    F.rows++;
    while (body.children.length > 40) body.removeChild(body.firstChild);
    if (opts && opts.type) feedType(row, String(text || ''));
    feedScroll();
    return row;
  }

  // 새 줄은 자막처럼 타이핑된다 — 이전 줄이 아직 치는 중이면 즉시 완성하고 넘어간다
  function feedType(row, full) {
    clearInterval(F.typer);
    if (F.curRow && F.curRow !== row) {
      const prev = F.curRow.querySelector('.mf-text');
      if (prev && prev.dataset.full) prev.textContent = prev.dataset.full;
      F.curRow.classList.remove('cur');
    }
    const t = row.querySelector('.mf-text');
    if (!t) return;
    t.dataset.full = full;
    if (typeof STILL !== 'undefined' && STILL) { t.textContent = full; return; }
    F.curRow = row;
    row.classList.add('cur');
    let i = 0;
    t.textContent = '';
    F.typer = setInterval(() => {
      i += 2;
      t.textContent = full.slice(0, i);
      feedScroll();
      if (i >= full.length) {
        clearInterval(F.typer);
        row.classList.remove('cur');
        if (F.curRow === row) F.curRow = null;
      }
    }, 22);
  }

  function feedAgentStart(id) {
    if (!MOBILE) return;
    feedProgress(id);
    const row = feedRow('agent wait', NAMES[id] || id, `${ROLES[id] || ''} — 분석 중…`, { tint: AGENT_TINT[id] });
    if (row) row.dataset.agent = id;
  }

  function feedAgentDone(ev) {
    if (!MOBILE) return;
    const body = $('#mf-body');
    const id = ev.id;
    let row = body && body.querySelector(`.mf-row.wait[data-agent="${id}"]`);
    const text = String(ev.bubble || firstSentence(ev.report, 160) || '');
    const full = String(ev.report || '');
    if (row) {
      row.classList.remove('wait');
      const f = document.createElement('div');
      f.className = 'mf-full';
      f.textContent = full;
      row.appendChild(f);
      feedType(row, text);
    } else {
      row = feedRow('agent', NAMES[id] || id, text, { tint: AGENT_TINT[id], type: true, full });
    }
    if (row) row.dataset.agent = id;
    F.done++;
    feedProgress(null);
  }

  function feedLog(ev) {
    if (!MOBILE || !F.open) return;
    const line = String(ev.line || '');
    if (line.startsWith('>>>')) return; // 최종 판정 줄은 decision 이벤트가 이미 한 줄로 넣었다
    if (ev.kind === 'stage') {
      feedRow('stage', null, line.replace(/─/g, '').trim());
    } else if (line.startsWith('[리스크 게이트]')) {
      feedRow('gate', '게이트', firstSentence(line.replace('[리스크 게이트]', '').trim(), 150));
    } else if (line.startsWith('[')) {
      // [청산 계산] 같은 요약 줄만. '> ' 세부 줄·뉴스는 콘솔 전용
      const m = line.match(/^\[([^\]]+)\]\s*(.*)$/);
      if (m && m[2]) feedRow('gate', m[1], firstSentence(m[2], 120));
    }
  }

  function feedDecision(ev) {
    if (!MOBILE) return;
    const act = String(ev.action || 'HOLD').toUpperCase();
    const conf = Number(ev.confidence) || 0;
    const sc = ev.scalp && ev.scalp.bias ? String(ev.scalp.bias).toUpperCase() : null;
    const head = sc && sc !== 'PASS' ? `${sc} (스캘핑) · ${act} ${conf}%` : `${act} ${conf}%`;
    feedRow('verdict', 'ACE', `${head} — ${firstSentence(ev.rationale || ev.report, 140)}`, { tint: AGENT_TINT.ace, type: true });
  }

  function feedRunStart(ev) {
    if (!MOBILE) return;
    const sym = ev.display || ev.symbol || '';
    feedReset(`${sym} · ${MODE_KO[ev.mode] || ev.mode}${ev.model ? ' · ' + ev.model : ev.mock ? ' · 연출' : ''}`, CALLS[ev.mode] || 5);
    feedOpen(false);
    feedRow('sys', null, `${ev.auto ? '📡 자동 분석 개시' : '분석 개시'} — 데이터 수집 중`);
  }

  function feedRunEnd() {
    if (!MOBILE) return;
    F.done = F.total;
    feedProgress(null);
    const el = $('#m-feed');
    if (el) el.classList.add('done');
    feedRow('end', null, '분석 종료 — 머리글을 누르면 다시 볼 수 있습니다');
    // 직접 펼친 게 아니면 잠시 뒤 접어서 자막 바(대표 보고)로 돌아간다
    if (!F.manual) {
      clearTimeout(F.closeTimer);
      F.closeTimer = setTimeout(() => { if (!F.manual) feedClose(false); }, 25000);
    }
  }

  function initFeed() {
    const head = $('#mf-head');
    if (head) {
      head.addEventListener('click', () => {
        if (document.body.classList.contains('whip-mode')) return;
        if (F.open) feedClose(true); else feedOpen(true);
      });
    }
    const cap = $('#caption');
    if (cap) {
      cap.addEventListener('click', () => {
        if (document.body.classList.contains('whip-mode') || !F.rows) return;
        feedOpen(true);
      });
    }
    const body = $('#mf-body');
    if (body) {
      body.addEventListener('click', (e) => {
        if (document.body.classList.contains('whip-mode')) return;
        const row = e.target.closest('.mf-row.agent');
        if (row && row.querySelector('.mf-full')) row.classList.toggle('expanded');
      });
    }
  }

  function firstSentence(s, max) {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    const cut = t.split(/(?<=[.!?。])\s/)[0] || t;
    return cut.length > (max || 90) ? cut.slice(0, (max || 90) - 1) + '…' : cut;
  }

  function autoBanner(ev) {
    const f = $('#floor');
    if (!f) return;
    let b = $('#auto-banner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'auto-banner';
      f.appendChild(b);
    }
    const mode = MODE_KO[ev.mode] || ev.mode;
    b.innerHTML = `📡 자동 분석 개시 — ${escH(ev.display || ev.symbol)}<small>${escH(mode)} · ${ev.mock ? '연출(데모)' : 'AI ' + escH(String(ev.model || '').toUpperCase())}</small>`;
    requestAnimationFrame(() => b.classList.add('in'));
    setTimeout(() => b.classList.remove('in'), 2300);
    sound({ freq: 660, dur: 0.08, vol: 0.04 });
    sound({ freq: 990, dur: 0.12, vol: 0.04, delay: 0.1 });
  }

  function setVerdict(ev) {
    const box = $('#m-verdict');
    if (!box) return;
    const a = $('#mv-action');
    const c = $('#mv-conf');
    const l = $('#mv-levels');
    if (!ev) {
      box.classList.add('empty');
      if (a) { a.textContent = '판정 대기'; a.style.color = ''; }
      if (c) c.textContent = '';
      if (l) l.textContent = '';
      return;
    }
    box.classList.remove('empty');
    const act = String(ev.action || 'HOLD').toUpperCase();
    const sc = ev.scalp && /LONG|SHORT/i.test(ev.scalp.bias || '') ? ev.scalp : null;
    const label = sc ? String(sc.bias).toUpperCase() : act;
    const col = label === 'LONG' || act === 'BUY' ? '#3fb950' : label === 'SHORT' || act === 'SELL' ? '#f85149' : '#d29922';
    if (a) {
      a.textContent = label;
      a.style.color = col;
      if (sc && window.LEV) {
        const sm = document.createElement('small');
        sm.textContent = window.LEV + 'x';
        a.appendChild(sm);
      }
    }
    if (c) c.textContent = '확신 ' + (Number(ev.confidence) || 0) + '%';
    const src = sc || ev;
    if (l) {
      // "83,686 돌파 확인 후 진입" 같은 문장에서 가격만 뽑아 칸에 넣는다. 원문은 길게 누르면(title) 보인다
      const e = pickPrice(src.entry);
      const s = pickPrice(src.stop);
      const t = pickPrice(src.target);
      const dist = (p) => (e && p ? ((p.n - e.n) / e.n) * 100 : null);
      const cell = (cls, name, p, raw, d) => {
        const dTxt = d == null ? '' : `<em>${d > 0 ? '+' : ''}${Math.abs(d) >= 10 ? d.toFixed(0) : d.toFixed(2)}%</em>`;
        return `<span class="mv-cell ${cls}" title="${escH(raw || '')}"><i>${name}${dTxt}</i><b>${escH(p ? p.s : raw ? '조건부' : '—')}</b></span>`;
      };
      l.innerHTML =
        cell('entry', '진입', e, src.entry, null) +
        cell('stop', '손절', s, src.stop, dist(s)) +
        cell('target', '목표', t, src.target, dist(t));
    }
  }

  // 문장 속 첫 "가격" — 20일선·15분봉·90배·3%·RSI 70 같은 숫자는 건너뛴다
  function pickPrice(text) {
    const str = String(text == null ? '' : text);
    const re = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
    let m;
    while ((m = re.exec(str))) {
      const after = str.slice(m.index + m[0].length, m.index + m[0].length + 3);
      const before = str.slice(Math.max(0, m.index - 4), m.index);
      // 단위가 붙은 숫자는 가격이 아니다 — 단 "회복"·"차트"·"시 진입"의 회·차·시는 단위가 아님
      if (/^\s*(분|일|시간|배|%|봉|선|x|X|주|개월|년|회(?!복)|차(?!트)|명|틱|ATR|R\b)/.test(after)) continue;
      if (/(RSI|SMA|EMA|MA|MACD|ATR|R:R|R)\s*$/i.test(before)) continue;
      const n = Number(m[0].replace(/,/g, ''));
      if (!Number.isFinite(n) || n <= 0) continue;
      return { s: m[0], n };
    }
    return null;
  }

  /* ---------------------------------------------------------------------
     5. 사무실 소품 — 세계 시계 · 창밖 하늘 · 추가 오피스 라이프
     --------------------------------------------------------------------- */
  function drawClock(cv, tz) {
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const c = W / 2;
    let h = 0, m = 0, s = 0;
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false }).formatToParts(new Date());
      for (const p of parts) {
        if (p.type === 'hour') h = Number(p.value) % 24;
        if (p.type === 'minute') m = Number(p.value);
        if (p.type === 'second') s = Number(p.value);
      }
    } catch (_) {}
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = '#111';
    ctx.fillRect(4, 4, W - 8, W - 8);
    ctx.fillStyle = h >= 6 && h < 18 ? '#fffbe6' : '#c9d4ff';
    ctx.fillRect(7, 7, W - 14, W - 14);
    ctx.fillStyle = '#333';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.fillRect(Math.round(c + Math.sin(a) * (c - 11)) - 1, Math.round(c - Math.cos(a) * (c - 11)) - 1, 2, 2);
    }
    const hand = (ang, len, w, col) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + Math.sin(ang) * len, c - Math.cos(ang) * len);
      ctx.stroke();
    };
    hand(((h % 12) + m / 60) / 12 * Math.PI * 2, c * 0.42, 3, '#1a1a24');
    hand((m + s / 60) / 60 * Math.PI * 2, c * 0.62, 2, '#1a1a24');
    hand((s / 60) * Math.PI * 2, c * 0.66, 1, '#d63a2f');
    ctx.fillStyle = '#d63a2f';
    ctx.fillRect(c - 1, c - 1, 3, 3);
  }

  function tickProps() {
    document.querySelectorAll('.oclock').forEach((el) => {
      const cv = el.querySelector('canvas');
      if (cv) drawClock(cv, el.dataset.tz);
    });
    const win = $('#office-window');
    if (win) {
      let hr = new Date().getHours();
      try { hr = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date())) % 24; } catch (_) {}
      win.className = hr >= 5 && hr < 7 ? 'dawn' : hr >= 7 && hr < 17 ? '' : hr >= 17 && hr < 19 ? 'sunset' : 'night';
    }
    renderChip();
    renderTv();
  }

  const LIFE = [
    () => {
      const ds = AGENT_IDS.map(visibleDesk).filter(Boolean);
      if (!ds.length) return;
      const d = ds[(Math.random() * ds.length) | 0];
      const p = floorPos(d.querySelector('.sprite'));
      const fx = fxLayer();
      if (!p || !fx) return;
      const ico = document.createElement('i');
      ico.className = 'phone-ico';
      ico.textContent = '📞';
      ico.style.left = p.x + 10 + 'px';
      ico.style.top = p.y - 22 + 'px';
      fx.appendChild(ico);
      setTimeout(() => ico.remove(), 1600);
    },
    () => {
      const ds = AGENT_IDS.map(visibleDesk).filter(Boolean);
      if (ds.length < 2) return;
      const d = ds[(Math.random() * ds.length) | 0];
      d.classList.add('jump');
      setTimeout(() => d.classList.remove('jump'), 1100);
    },
  ];

  function lifeTick() {
    if (S.running || document.hidden || document.body.classList.contains('no-life')) return;
    if (typeof STILL !== 'undefined' && STILL) return;
    LIFE[(Math.random() * LIFE.length) | 0]();
  }

  // 대기 중 자막 — 회사 현황을 돌아가며
  let idleCapIdx = 0;
  function idleCaption() {
    if (S.running || S.reporting || Date.now() - S.lastReportAt < 8000) return;
    const a = S.account;
    const st = S.ap;
    const lines = [];
    if (st && st.config && st.config.enabled && st.nextRunAt) {
      lines.push(['PIXEL CAPITAL', `자동 운영 중 — 다음 분석까지 ${mmss(st.nextRunAt - Date.now())}`]);
    }
    const open = S.open.filter((p) => p && !p.gateFailed);
    if (open.length) {
      const p = open[idleCapIdx % open.length];
      lines.push(['포지션 감시', `${p.display || p.symbol} ${sideKo(p.side)} ${p.leverage}x — ${p.roePct == null ? '평가 대기' : 'ROE ' + pct(p.roePct, 1)} · 손절 ${p.stop ?? '—'} · 목표 ${p.target ?? '—'}`]);
    }
    if (a) lines.push(['모의 계좌', `잔고 ${money(a.equity)} USDT (${pct(a.equityReturnPct)}) · ${a.wins}승 ${a.losses}패`]);
    if (!lines.length) return;
    const [nm, tx] = lines[idleCapIdx++ % lines.length];
    caption('pm', nm, tx, null);
  }

  /* ---------------------------------------------------------------------
     6. 이벤트
     --------------------------------------------------------------------- */
  // 접속 직후 SSE가 지난 이벤트를 몰아서 재생한다 — 그때는 상태만 맞추고 보고·배너는 건너뛴다
  const bootTs = performance.now();
  const replaying = () => performance.now() - bootTs < 2500;

  function on(ev) {
    if (!ev || !ev.type) return;
    if (replaying()) {
      if (ev.type === 'run:start') { S.running = true; S.runSym = ev.display || ev.symbol || ''; S.runMode = ev.mode; }
      if (ev.type === 'run:end') S.running = false;
      if (ev.type === 'decision') setVerdict(ev);
      if (ev.type === 'autopilot' && ev.status) applyAp(ev.status);
      return;
    }
    switch (ev.type) {
      case 'run:start':
        S.running = true;
        S.runAuto = !!ev.auto;
        S.runSym = ev.display || ev.symbol || '';
        S.runMode = ev.mode;
        S.openedThisRun = false;
        setVerdict(null);
        caption('ace', 'PIXEL CAPITAL', `${ev.auto ? '📡 자동 분석 개시' : '분석 개시'} — ${ev.display || ev.symbol} · ${MODE_KO[ev.mode] || ev.mode}`, null);
        feedRunStart(ev);
        if (ev.auto && !(typeof STILL !== 'undefined' && STILL)) autoBanner(ev);
        renderChip();
        break;
      case 'agent:start':
        caption(ev.id, `${NAMES[ev.id] || ev.id} · ${ROLES[ev.id] || ''}`, '분석 중…', null);
        feedAgentStart(ev.id);
        break;
      case 'agent:done':
        caption(ev.id, `${NAMES[ev.id] || ev.id} · ${ROLES[ev.id] || ''}`, firstSentence(ev.bubble || ev.report, 110), null);
        feedAgentDone(ev);
        break;
      case 'log':
        feedLog(ev);
        break;
      case 'decision': {
        setVerdict(ev);
        feedDecision(ev);
        const act = String(ev.action || 'HOLD').toUpperCase();
        const conf = Number(ev.confidence) || 0;
        // 스캘핑 판정(LONG/SHORT)이 있으면 그게 실제 매매 방향 — 판정 줄과 같은 말을 해야 녹화에서 안 헷갈린다
        const sc = ev.scalp && ev.scalp.bias ? String(ev.scalp.bias).toUpperCase() : null;
        const label = sc && sc !== 'PASS' ? sc : act;
        caption('ace', 'ACE · 최종 판정', `${label} ${conf}% — ${firstSentence(ev.rationale || ev.report, 90)}`, null);
        // 매매로 이어지지 않은 판정도 대표님께 보고한다 (진입하면 진입 보고가 대신 간다)
        const sym = S.runSym;
        const mode = S.runMode;
        setTimeout(() => {
          if (S.openedThisRun || (typeof STILL !== 'undefined' && STILL)) return;
          const why =
            label === 'HOLD' || label === 'PASS'
              ? '이번엔 관망하겠습니다. 자리가 나오면 바로 들어가겠습니다.'
              : '다만 리스크 기준을 못 넘어 진입은 보류했습니다.';
          queueReport({
            who: reporterFor(mode),
            title: '분석 보고',
            kind: 'info',
            text: `대표님, ${sym} 분석 끝났습니다. ${label} ${conf}% — ${why}`,
          });
        }, 1800);
        break;
      }
      case 'position':
        if (ev.action === 'open' && ev.position) {
          const p = ev.position;
          S.openedThisRun = true;
          queueReport({
            who: reporterFor(p.mode),
            title: '진입 보고',
            kind: 'info',
            text: `대표님, ${p.display || p.symbol} ${sideKo(p.side)} ${p.leverage}배 진입했습니다. 진입 ${p.entry} · 손절 ${p.stop ?? '—'} · 목표 ${p.target ?? '—'}`,
          });
        }
        if (ev.action === 'close' && typeof loadPositions === 'function') loadPositions();
        break;
      case 'ledger':
        if (typeof loadPositions === 'function') loadPositions();
        break;
      case 'autopilot':
        if (ev.status) applyAp(ev.status);
        break;
      case 'run:end':
        S.running = false;
        S.runAuto = false;
        feedRunEnd();
        renderChip();
        break;
      default:
        break;
    }
  }

  function init() {
    // 데스크톱에서 화면이 낮으면 거래소 전광판은 접어서 시작 — 사무실이 잘리지 않게
    if (!MOBILE && window.innerHeight < 1000) {
      const vb = $('#venue-board');
      const t = $('#vb-toggle');
      if (vb && !vb.classList.contains('collapsed')) {
        vb.classList.add('collapsed');
        if (t) t.textContent = '펼치기';
      }
    }
    const ceo = $('#ceo-sprite');
    if (ceo) drawSprite(ceo, 'ceo');
    const face = $('#cap-face');
    if (face) drawSprite(face, 'pm');

    const chip = $('#auto-chip');
    if (chip) chip.addEventListener('click', openApModal);
    const btn = $('#auto-btn');
    if (btn) btn.addEventListener('click', openApModal);
    const close = $('#ap-close');
    if (close) close.addEventListener('click', () => $('#ap-modal').classList.add('hidden'));
    const modal = $('#ap-modal');
    if (modal) {
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
      modal.addEventListener('change', updateCost);
    }
    const save = $('#ap-save');
    if (save) save.addEventListener('click', () => saveAp());
    const run = $('#ap-runnow');
    if (run) run.addEventListener('click', () => saveAp({ enabled: true, runNow: true }));
    const once = $('#once-run');
    if (once) once.addEventListener('click', runOnce);
    // 두 선택 상자는 항상 같은 값 — 하나를 바꾸면 다른 쪽도 따라간다
    ['#lev-select', '#once-lev'].forEach((sel) => {
      const el = $(sel);
      if (el) el.addEventListener('change', () => setLevUI(Number(el.value)));
    });
    const osym = $('#once-symbol');
    if (osym) {
      osym.addEventListener('input', () => { osym.dataset.touched = '1'; });
      osym.addEventListener('keydown', (e) => { if (e.key === 'Enter') runOnce(); });
    }
    // 수익표 — 전광판을 누르거나 레일 버튼
    const pb = $('#pnl-board');
    // 채찍 든 동안의 클릭은 휘두르기다 — 표가 튀어나오지 않게
    if (pb) pb.addEventListener('click', () => { if (!document.body.classList.contains('whip-mode')) openProfitTable(); });
    const ptb = $('#pt-btn');
    if (ptb) ptb.addEventListener('click', openProfitTable);
    // 한 번 누르면 바로 저장 — 휴대폰에서 체크박스 찾고 저장 누를 필요 없게
    const quick = $('#ap-quick');
    if (quick) quick.addEventListener('click', () => saveAp({ enabled: !(S.ap && S.ap.config && S.ap.config.enabled) }));
    initRecModal();
    initFeed();

    loadAutopilot();
    tickProps();
    setInterval(tickProps, 1000);
    setInterval(loadAutopilot, 60 * 1000);
    setInterval(lifeTick, 6000);
    setInterval(idleCaption, 9000);
    setInterval(periodicBriefing, 15 * 60 * 1000);
    setTimeout(periodicBriefing, 70 * 1000);
    addEventListener('resize', () => drawCurve());
    if (typeof loadPositions === 'function') loadPositions();
  }

  return { on, onPositions, init, drawQr, openProfitTable, _state: S };
})();

HQ.init();
