/* PIXEL TRADING FLOOR 데모 버전 — 화면 보조 (hq.js·chart.js 다음에 로드)
   · 상단 레일: 데모 버전 표시 · 100배 고정 · AI 실제 버전 받기 · 모의 계좌 초기화 (횟수 제한 없음)
   · 가상 포지션 패널 아래 "매매 내역"(청산된 거래 목록)
     (소개 페이지 속 화면 ?embed=1 이면 '소개' 링크는 뺀다 — 페이지 안에 페이지가 뜨지 않게)
   · 첫 방문 안내(한 번만): 모드 고르기(알고리즘=중장기 · 스캘핑=단타) → ▶ ANALYZE 분석하기
   · 무료 분석을 다 쓰면 ANALYZE 대신 안내 창(모의 계좌 성적 + 자료실)
   · 수익표(챌린지 실계좌 기록)는 실제 버전 기능이라 전광판 클릭을 안내로 바꾼다
   · 저장이 막힌 브라우저 안내 */
(function () {
  'use strict';
  const cfg = window.LITE_CONFIG || {};
  const LITE = window.LITE;
  if (!LITE) return;
  const $ = (s) => document.querySelector(s);
  const say = (msg, kind) => { if (typeof toast === 'function') toast(msg, kind || ''); };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const embed = new URLSearchParams(window.location.search).get('embed') === '1';
  const quota = LITE.quota;
  const START = (window.LitePaper && window.LitePaper.DEFAULTS.start) || 10000;
  const LEV = (window.LiteBrain && window.LiteBrain.RULES.defaultLev) || 100;
  // 격리 청산까지 가격 거리(%) = 100/배율 − 유지증거금률 — 배율을 말하는 문구마다 같이 적는다(프로젝트 규칙)
  const LIQ = (100 / LEV - ((window.LiteBrain && window.LiteBrain.RULES.mmPct) || 0.5)).toFixed(1);
  if (LITE.kiosk) document.documentElement.classList.add('kiosk');
  if (embed) document.documentElement.classList.add('embed');

  // 입력칸 예시 — 코인·미국 주식·한국 주식·금. 처음엔 BTC를 넣어 두고 첫 분석 전까지 ANALYZE를 깜빡인다
  const si = $('#symbol-input');
  if (si && !LITE.kiosk) {
    si.placeholder = 'BTC, 테슬라, 삼성전자, 금…';
    if (!si.value) si.value = 'BTC';
    document.documentElement.classList.add('lite-first');
    LITE.bus.subscribe((ev) => { if (ev.type === 'run:start') document.documentElement.classList.remove('lite-first'); });
  }

  const rail = $('#v2-rail');
  if (rail && !$('#lite-ribbon')) {
    const box = document.createElement('div');
    box.id = 'lite-ribbon';
    // 휴대폰은 레일이 옆으로 밀리므로 남은 횟수·자료실 링크를 앞에 둔다
    box.innerHTML = '<b>데모 버전</b><span class="why">*실시간 뉴스 분석·AI 기능 없음 (자체 트레이딩 로직)</span>'
      + (quota ? '<em id="lite-left"></em>' : '')
      + (cfg.filesUrl ? `<a class="full" href="${esc(cfg.filesUrl)}" target="_blank" rel="noopener">AI 실제 버전 받기</a>` : '')
      + `<span class="fix" title="체험이 빨리 끝나도록 ${LEV}배 고정·수수료 없이 계산합니다"><span class="fx-l">${LEV}배 고정 · 약 ${LIQ}% 역행 시 청산</span><span class="fx-s">${LEV}배 · 청산 ${LIQ}%</span></span>`
      + (embed ? '' : `<a href="${esc(cfg.landingUrl || '../')}">소개</a>`)
      + '<button type="button" id="lite-hist-btn">📋 매매 내역</button>'
      + '<button type="button" id="lite-reset">계좌 초기화</button>';
    const gap = rail.querySelector('.rail-gap');
    rail.insertBefore(box, gap ? gap.nextSibling : null);
    $('#lite-hist-btn').addEventListener('click', showHistory);
    $('#lite-reset').addEventListener('click', () => {
      if (!window.confirm(`모의 계좌를 ${money(START)} USDT로 초기화할까요? 보유 포지션과 매매 내역이 모두 지워집니다.`)) return;
      LITE.paper.reset();
      if (typeof loadPositions === 'function') loadPositions();
      if (LITE.chart) LITE.chart.render();
      say(`모의 계좌를 ${money(START)} USDT로 초기화했습니다`, 'ok');
    });
  }

  // ---- 매매 내역 — 청산된 거래(수익·손실 모두)와 보유 중 포지션을 한 창에. 수치는 이 브라우저의 모의 계좌 원장 그대로 ----
  function histBox() {
    let el = $('#lite-hist');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'lite-hist';
    el.className = 'hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'lh-title');
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) el.classList.add('hidden'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') el.classList.add('hidden'); });
    return el;
  }

  function showHistory() {
    const H = window.LiteHistory;
    const snap = LITE.paper.snapshot();
    const list = H.rows(snap.trades, 50);
    const s = H.summary(snap.trades);
    const signed = (v, d = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`;
    const open = snap.open.map((p) => `<li class="lh-open"><span>보유 중</span><b>${esc(p.display || p.symbol)}</b>`
      + `<span>${p.side === 'SHORT' ? '숏' : '롱'} ${p.leverage}x</span><em class="${p.unrealizedAmt > 0 ? 'up' : p.unrealizedAmt < 0 ? 'down' : ''}">${signed(p.unrealizedAmt || 0)} USDT</em></li>`).join('');
    const rows = list.map((t) => `<li><span>${esc(t.time)}</span><b>${esc(t.who)}</b><span>${esc(t.side)} ${esc(t.lev)}x · ${esc(t.result)}</span>`
      + `<em class="${t.tone}">${signed(t.roe, 1)}% · ${signed(t.pnl)} USDT</em></li>`).join('');
    const el = histBox();
    el.innerHTML = '<div class="lh-box">'
      + '<button class="ll-x" type="button" data-close aria-label="닫기">✕</button>'
      + '<h2 id="lh-title">매매 내역</h2>'
      + `<p class="lh-sum">청산 ${s.n}건 · ${s.wins}승 ${s.losses}패 · 손익 <b class="${s.pnl > 0 ? 'up' : s.pnl < 0 ? 'down' : ''}">${signed(s.pnl)} USDT</b>`
      + ` · 보유 ${snap.open.length}개 <small>수익·손실 모두 · 이 브라우저의 모의 계좌 · ${LEV}배 고정(약 ${LIQ}% 역행 시 청산) · 수수료 없음</small></p>`
      + `<ul class="lh-list">${open}${rows || '<li class="lh-empty">아직 청산된 거래가 없습니다 — 종목을 넣고 ▶ ANALYZE를 눌러 보세요</li>'}</ul>`
      + '<button class="ll-close" type="button" data-close>닫기</button>'
      + '</div>';
    el.classList.remove('hidden');
  }

  // ---- 무료 분석 횟수 (설정이 0이면 quota가 없어 쓰이지 않는다 — 횟수 제한 없음) ----
  function showLeft() {
    const el = $('#lite-left');
    if (!el || !quota) return;
    const left = quota.left();
    el.textContent = left ? `무료 분석 ${left}/${quota.limit}` : '무료 분석 끝';
    el.classList.toggle('out', !left);
    document.documentElement.classList.toggle('lite-out', !left);
    const btn = $('#analyze-btn');
    if (btn) btn.title = left ? `무료 분석 ${left}회 남음` : '무료 분석을 모두 썼습니다 — AI 실제 버전은 텔레그램 자료실에서';
  }

  function limitBox() {
    let el = $('#lite-limit');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'lite-limit';
    el.className = 'hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'll-title');
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) el.classList.add('hidden'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') el.classList.add('hidden'); });
    return el;
  }

  function showLimit() {
    const el = limitBox();
    const snap = LITE.paper.snapshot();
    const a = snap.account;
    const open = snap.open.length;
    const ret = a.equityReturnPct;
    const tone = ret > 0 ? 'up' : ret < 0 ? 'down' : '';
    el.innerHTML = '<div class="ll-box">'
      + '<button class="ll-x" type="button" data-close aria-label="닫기">✕</button>'
      + `<div class="ll-badge">FREE RUNS 0/${quota ? quota.limit : 3}</div>`
      + `<h2 id="ll-title">무료 분석 ${quota ? quota.limit : 3}회를 모두 쓰셨어요</h2>`
      + `<div class="ll-score"><span>모의 계좌</span><b>${money(a.start)} → ${money(a.equity)} USDT</b>`
      + `<em class="${tone}">${ret > 0 ? '+' : ''}${ret.toFixed(2)}%</em>`
      + `<small>${a.wins}승 ${a.losses}패 · 수수료 없이 계산${open ? ` · 보유 ${open}개 — 계속 실시간 정산됩니다` : ''}</small></div>`
      + '<p>실제 버전에서는 AI 직원 13명이 뉴스까지 읽고 각자 분석·토론해서 판정합니다.<br>Claude 또는 ChatGPT(Codex) 구독과 PC만 있으면 텔레그램 자료실에서 받아 추가 비용 없이 바로 쓸 수 있어요.</p>'
      + (cfg.filesUrl ? `<a class="ll-go" href="${esc(cfg.filesUrl)}" target="_blank" rel="noopener">텔레그램 자료실에서 받기 ▶</a>` : '')
      + '<button class="ll-close" type="button" data-close>계속 구경하기</button>'
      + '</div>';
    el.classList.remove('hidden');
    const go = el.querySelector('.ll-go');
    if (go) go.focus({ preventScroll: true });
  }

  if (quota) {
    showLeft();
    // 다 쓴 뒤의 분석 요청(ANALYZE·엔터·워치리스트 칩 어디서든)은 shim이 조용히 받고 lite:limit 신호를 보낸다
    // 횟수는 모의 포지션이 열릴 때 준다(shim이 먼저 구독해 이 시점엔 이미 깎여 있다)
    let lastRun = false;
    LITE.bus.subscribe((ev) => {
      if (ev.type === 'lite:limit') {
        showLeft();
        showLimit();
      } else if (ev.type === 'position' && ev.action === 'open') {
        showLeft();
        lastRun = quota.left() === 0;
      } else if (ev.type === 'run:end' && lastRun) {
        lastRun = false;
        setTimeout(() => say('무료 분석을 모두 썼어요 — 열린 모의 포지션은 계속 실시간으로 정산됩니다', 'ok'), 2500);
      }
    });
    // 소개 페이지 속 화면과 단독 화면이 횟수를 나눠 쓴다
    const runsKey = (window.LiteShim && window.LiteShim.RUNS_KEY) || 'pixel-lite-runs-v1';
    window.addEventListener('storage', (e) => { if (e.key === runsKey) showLeft(); });
  }

  // ---- 첫 방문 안내 (브라우저마다 한 번) — ① 모드 고르기 ② ▶ ANALYZE 분석하기 ----
  const TOUR_KEY = 'pixel-lite-tour-v1';
  let tourSeen = false;
  try { tourSeen = window.localStorage.getItem(TOUR_KEY) === '1'; } catch (_) { tourSeen = false; }
  const TOUR = [
    {
      target: '#mode-toggle', step: 'STEP 1 · 모드 고르기', next: '다음 ▶',
      html: '<p><b>알고리즘</b> — <em>중장기</em> 판단에 적합한 모드. 애널리스트 4명 → 매수·매도 토론 → 리스크 위원회 → PM 결재까지 거칩니다.</p>'
        + '<p><b>⚡스캘핑</b> — <em>단타</em>에 적합한 모드. 차트·심리를 보고 BLITZ·GUARD가 빠르게 판정합니다.</p>'
        + `<p class="lt-note">모드 설명은 실제 버전 기준이에요. 데모 버전은 체험이 빨리 끝나도록 두 모드 모두 ${LEV}배 초단타로 체결되며, ${LEV}배는 가격이 약 ${LIQ}%만 반대로 가도 증거금 전액이 청산됩니다.</p>`,
    },
    {
      target: '#analyze-btn', step: 'STEP 2 · 분석하기', next: '알겠어요',
      html: '<p class="lt-big">▶ ANALYZE를 눌러 <b>분석하기!</b></p>'
        + '<p>종목은 BTC·ETH 같은 코인은 물론 <b>테슬라·엔비디아·삼성전자·SK하이닉스·금</b>도 됩니다.</p>',
    },
  ];
  let tourEl = null;
  let tourAt = -1;
  let tourDone = tourSeen;
  function tourPlace() {
    if (!tourEl || tourAt < 0) return;
    const t = $(TOUR[tourAt].target);
    if (!t) return;
    const r = t.getBoundingClientRect();
    const w = tourEl.offsetWidth;
    const h = tourEl.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 14 + h <= window.innerHeight || r.top - 14 - h < 0;
    tourEl.dataset.at = below ? 'below' : 'above';
    tourEl.style.left = `${Math.round(left)}px`;
    tourEl.style.top = `${Math.round(below ? r.bottom + 14 : r.top - 14 - h)}px`;
    const arrow = tourEl.querySelector('.lt-arrow');
    if (arrow) arrow.style.left = `${Math.round(Math.max(12, Math.min(w - 24, r.left + r.width / 2 - left - 6)))}px`;
  }
  function tourEnd() {
    if (!tourEl || tourDone) return;
    tourDone = true;
    tourEl.classList.add('hidden');
    document.querySelectorAll('.lite-tour-on').forEach((el) => el.classList.remove('lite-tour-on'));
    tourAt = -1;
    try { window.localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* 저장 막힘 — 이번 방문에서만 닫힌다 */ }
  }
  function tourShow(i) {
    if (i >= TOUR.length) { tourEnd(); return; }
    tourAt = i;
    const s = TOUR[i];
    document.querySelectorAll('.lite-tour-on').forEach((el) => el.classList.remove('lite-tour-on'));
    const t = $(s.target);
    if (t) t.classList.add('lite-tour-on');
    tourEl.innerHTML = '<i class="lt-arrow" aria-hidden="true"></i>'
      + `<span class="lt-step">${s.step}</span>${s.html}`
      + `<div class="lt-row"><button type="button" class="lt-skip">건너뛰기</button><button type="button" class="lt-next">${s.next}</button></div>`;
    tourEl.classList.remove('hidden');
    tourPlace();
  }
  if (!LITE.kiosk && !tourSeen && $('#mode-toggle') && $('#analyze-btn')) {
    tourEl = document.createElement('div');
    tourEl.id = 'lite-tour';
    tourEl.className = 'hidden';
    tourEl.setAttribute('role', 'dialog');
    tourEl.setAttribute('aria-label', '처음 오셨나요? 사용법 안내');
    document.body.appendChild(tourEl);
    tourEl.addEventListener('click', (e) => {
      if (e.target.closest('.lt-next')) tourShow(tourAt + 1);
      else if (e.target.closest('.lt-skip')) tourEnd();
    });
    // 모드를 직접 고르면 다음 단계로 · 분석이 시작되면 끝
    document.querySelectorAll('#mode-toggle .mode-btn').forEach((b) => b.addEventListener('click', () => { if (tourAt === 0) tourShow(1); }));
    LITE.bus.subscribe((ev) => { if (ev.type === 'run:start') tourEnd(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tourAt >= 0) tourEnd(); });
    window.addEventListener('resize', tourPlace);
    window.addEventListener('scroll', tourPlace, { passive: true });
    setTimeout(() => { if (!tourDone && tourAt < 0 && !LITE.engine.isRunning()) tourShow(0); }, 900);
  }

  // 실제 버전 화면 문구 중 데모 버전에 맞지 않는 것 — AI 시뮬레이션·탭비트·자동 운영
  const disc = $('#disclaimer');
  if (disc) disc.textContent = `데모 버전 — 실시간 뉴스 분석·AI 기능 없음(AI 엔진 대신 자체 트레이딩 로직) · ${LEV}배 고정(약 ${LIQ}% 역행 시 증거금 전액 청산) · 수수료 없음 · 투자 조언이 아님`;
  document.querySelectorAll('.dp-scalp-head').forEach((el) => { el.textContent = el.textContent.replace('탭비트 ', ''); });
  const tv = $('#tv-line1');
  if (tv) {
    const fixTv = () => { if (/자동 운영/.test(tv.textContent)) tv.textContent = '데모 버전 · 분석 대기'; };
    new MutationObserver(fixTv).observe(tv, { childList: true, characterData: true, subtree: true });
    fixTv();
  }
  // 하단 모의 계좌 설명 — hq.js가 잔고를 그릴 때마다 실제 버전 문구(수수료 반영)로 다시 쓴다
  const basis = $('#pb-basis');
  if (basis) {
    const BASIS = `모의 계좌 · 실제 시세로 계산 · ${LEV}배 고정(약 ${LIQ}% 역행 시 청산) · 수수료 없음 · 투자 조언 아님`;
    const fixBasis = () => { if (basis.textContent !== BASIS) basis.textContent = BASIS; };
    new MutationObserver(fixBasis).observe(basis, { childList: true, characterData: true, subtree: true });
    fixBasis();
  }

  // 캡처 단계에서 먼저 받아 hq.js의 수익표 열기를 막는다 (채찍 휘두르기 중인 클릭은 통과)
  document.addEventListener('click', (e) => {
    if (!e.target.closest || !e.target.closest('#pnl-board')) return;
    if (document.body.classList.contains('whip-mode')) return;
    e.stopPropagation();
    say('데모 버전은 이 브라우저의 모의 계좌만 보여 줍니다 — 챌린지 수익표는 AI 실제 버전 기능입니다');
  }, true);

  if (!LITE.kiosk && !LITE.paper.persistent()) {
    setTimeout(() => say('이 브라우저는 저장이 막혀 있어 새로고침하면 모의 계좌와 무료 분석 횟수가 초기화됩니다', 'err'), 1500);
  }
})();
