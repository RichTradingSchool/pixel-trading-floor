/* ==========================================================================
   PIXEL TRADING FLOOR — stage.js
   살아있는 오피스 연출. 레퍼런스 릴스의 "진짜 일하는 회사" 느낌:
   · 인트로(소등 → 방마다 점등 → 타이틀 카드 → 오프닝 벨)
   · 열일 이펙트(타이핑 파티클 · 모니터 글로우)
   · 서류 전달(분석 완료 시 다음 방으로 종이가 날아감)
   · 판정 스탬프(스포트라이트 + 쾅) · 색종이
   · 오피스 라이프(대기 중 커피 타임 · 잡담 · 기지개)
   app.js 뒤에 로드된다(전역 qs/deskEl/AGENT_IDS/tone/STILL/drawSprite 사용).
   연출은 전부 부가 기능 — 어떤 실패도 분석 흐름을 막지 않는다.
   ========================================================================== */
'use strict';

const Stage = (() => {
  let mode = 'algo';
  let running = false;
  // 페이지 접속 직후에는 SSE가 지난 이벤트를 한꺼번에 재생(replay)한다.
  // 그때 인트로·스탬프·서류가 동시에 터지면 난장판이 되므로 접속 후 2초간은
  // 상태(모드·working 클래스)만 반영하고 화면 연출은 건너뛴다.
  const bootTs = (typeof performance !== 'undefined' ? performance.now() : 0);
  function inReplayBurst() {
    return (typeof performance !== 'undefined' ? performance.now() : 0) - bootTs < 2000;
  }
  let fxLayer = null;
  let coffeeBusy = false;

  // 서류가 날아갈 다음 단계의 방
  function destRoom(id) {
    if (['taro', 'diana', 'nova', 'vibe'].includes(id)) {
      return mode === 'algo' ? 'room-research' : 'room-scalp';
    }
    return 'room-trading';
  }

  function floorEl() { return qs('#floor'); }

  function centerOf(el) {
    const f = floorEl();
    if (!el || !f) return null;
    const a = el.getBoundingClientRect();
    const b = f.getBoundingClientRect();
    // 녹화 프레임(CSS zoom)에서는 화면 좌표가 확대돼 있으므로 플로어 내부 좌표로 되돌린다
    const k = f.offsetWidth ? b.width / f.offsetWidth : 1;
    return { x: (a.left - b.left + a.width / 2) / k, y: (a.top - b.top + a.height / 2) / k };
  }

  function ensureFx() {
    if (fxLayer && fxLayer.isConnected) return fxLayer;
    const f = floorEl();
    if (!f) return null;
    fxLayer = document.createElement('div');
    fxLayer.id = 'fx-layer';
    f.appendChild(fxLayer);
    return fxLayer;
  }

  /* ---- 모임 동선(스쿠트): 책상째 이동해 말풍선·명패가 함께 따라간다 ---- */
  function scoot(id, x, y, cls) {
    const d = deskEl(id);
    if (!d) return;
    d.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
    if (cls) d.classList.add(cls);
  }

  function scootBack(ids) {
    ids.forEach((id) => {
      const d = deskEl(id);
      if (!d) return;
      d.style.transform = '';
      d.classList.remove('arguing');
    });
  }

  // 토론: 서로에게 다가서며 언쟁 / 심사: 본부 쪽으로 모임 / PM: 월스크린 앞으로
  const DEBATE_IDS_ST = ['bull', 'bear'];
  const RISK_IDS_ST = ['risky', 'neutral', 'safe'];

  function choreograph(ev) {
    if (STILL || inReplayBurst()) return;
    const id = ev.id;
    if (ev.type === 'agent:start') {
      // 토론은 개회·반박 라운드마다 양측이 동시에 말한다 — 상대가 말하는 중이면 물러나게 하지 않는다
      const speaking = (k) => { const d = deskEl(k); return !!(d && d.classList.contains('arguing')); };
      if (id === 'bull') { scoot('bull', 26, 8, 'arguing'); if (!speaking('bear')) scoot('bear', -8, 2); }
      else if (id === 'bear') { scoot('bear', -26, 8, 'arguing'); if (!speaking('bull')) scoot('bull', -8, 2); }
      else if (RISK_IDS_ST.includes(id)) {
        // 심사자들이 차례로 본부 방향(오른쪽)으로 다가선다
        const off = { risky: [30, -4], neutral: [22, 6], safe: [30, 12] };
        scoot(id, off[id][0], off[id][1], 'arguing');
      } else if (id === 'pm') {
        scoot('pm', 0, -14, 'arguing'); // 월스크린 앞으로 한 걸음
      } else if (['blitz', 'guard', 'ace'].includes(id)) {
        scootBack(DEBATE_IDS_ST); // 토론 끝 — 제자리로
      }
    } else if (ev.type === 'agent:done') {
      const d = deskEl(id);
      if (d) d.classList.remove('arguing');
      if (id === 'pm' || id === 'ace') scootBack(RISK_IDS_ST.concat(['pm']));
    } else if (ev.type === 'run:end') {
      scootBack(DEBATE_IDS_ST.concat(RISK_IDS_ST, ['pm']));
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  /* ---- 인트로: 소등 → 방마다 점등 → 타이틀 카드 → 오프닝 벨 ---- */
  function intro(ev) {
    if (STILL) return;
    const rooms = ['room-analyst', 'room-research', 'room-scalp', 'room-trading']
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    rooms.forEach((r) => r.classList.add('lights-off'));

    const card = document.createElement('div');
    card.id = 'intro-card';
    const modeName =
      ev.mode === 'scalp' ? `⚡ 스캘핑 ${window.LEV || 20}x` : ev.mode === 'attack' ? '⚔ 공격 모드' : '알고리즘';
    card.innerHTML =
      '<div class="ic-sym">' + esc(ev.display || ev.symbol || '') + '</div>' +
      '<div class="ic-mode">' + modeName + ' · 분석 개시</div>' +
      '<div class="ic-sub">에이전트 출근 중…</div>';
    document.body.appendChild(card);
    requestAnimationFrame(() => card.classList.add('in'));

    rooms.forEach((r, i) => {
      setTimeout(() => {
        r.classList.remove('lights-off');
        r.classList.add('lights-flick');
        setTimeout(() => r.classList.remove('lights-flick'), 500);
        tone({ freq: 520 + i * 90, dur: 0.05, vol: 0.025 });
        // 그 방 캐릭터들 출근 러시(짧은 점프)
        r.querySelectorAll('.desk:not(.idle) .sprite').forEach((s, j) => {
          setTimeout(() => {
            s.classList.add('rush');
            setTimeout(() => s.classList.remove('rush'), 620);
          }, j * 90);
        });
      }, 350 + i * 320);
    });

    // 오프닝 벨(장 개시 종) 2타 + 카드 퇴장
    setTimeout(() => {
      tone({ freq: 1560, dur: 0.28, vol: 0.05, type: 'triangle' });
      setTimeout(() => tone({ freq: 1560, dur: 0.34, vol: 0.04, type: 'triangle' }), 340);
    }, 350 + rooms.length * 320);
    setTimeout(() => {
      card.classList.remove('in');
      setTimeout(() => card.remove(), 450);
    }, 2450);
  }

  /* ---- 열일: 타이핑 파티클 + 모니터 글로우 ---- */
  function workOn(id) {
    const d = deskEl(id);
    if (!d) return;
    d.classList.add('working');
    d._workFx = setInterval(() => {
      if (document.hidden || STILL) return;
      typingBurst(d, 1 + ((Math.random() * 2) | 0));
    }, 460);
  }

  function workOff(id) {
    const d = deskEl(id);
    if (!d) return;
    d.classList.remove('working');
    if (d._workFx) { clearInterval(d._workFx); d._workFx = null; }
  }

  function typingBurst(desk, n) {
    const fx = ensureFx();
    const c = centerOf(desk);
    if (!fx || !c) return;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.className = 'key-spark';
      p.style.left = (c.x - 6 + Math.random() * 24 - 12) + 'px';
      p.style.top = (c.y + 6) + 'px';
      fx.appendChild(p);
      setTimeout(() => p.remove(), 700);
    }
  }

  /* ---- 서류 전달 ---- */
  function flyPaper(id) {
    if (STILL) return;
    const fx = ensureFx();
    const from = centerOf(deskEl(id));
    const to = centerOf(document.getElementById(destRoom(id)));
    if (!fx || !from || !to) return;
    const paper = document.createElement('div');
    paper.className = 'fly-paper';
    paper.style.left = from.x + 'px';
    paper.style.top = (from.y - 26) + 'px';
    fx.appendChild(paper);
    requestAnimationFrame(() => {
      paper.style.transform =
        'translate(' + (to.x - from.x) + 'px, ' + (to.y - from.y - 20) + 'px) rotate(540deg)';
      paper.style.opacity = '0';
    });
    tone({ freq: 880, dur: 0.04, vol: 0.02 });
    setTimeout(() => paper.remove(), 950);
  }

  /* ---- 판정: 스포트라이트 + 스탬프 + 색종이 ---- */
  function stamp(ev) {
    if (STILL) return;
    const act = String(ev.action || 'HOLD').toUpperCase();
    const col = DECISION_COLORS[act] || DECISION_COLORS.HOLD;

    ['room-analyst', 'room-research', 'room-scalp'].forEach((id) => {
      const r = document.getElementById(id);
      if (r) { r.classList.add('dimmed'); setTimeout(() => r.classList.remove('dimmed'), 2600); }
    });
    const hq = document.getElementById('room-trading');
    if (hq) { hq.classList.add('spotlit'); setTimeout(() => hq.classList.remove('spotlit'), 2600); }

    const st = document.createElement('div');
    st.id = 'decision-stamp';
    st.textContent = act;
    st.style.color = col;
    st.style.borderColor = col;
    document.body.appendChild(st);
    requestAnimationFrame(() => st.classList.add('slam'));
    setTimeout(() => { st.classList.add('out'); setTimeout(() => st.remove(), 500); }, 1900);

    if (act === 'BUY' || act === 'SELL') {
      confetti(col, act === 'BUY' ? '#a7f3c0' : '#ffd0cc');
    }
  }

  function confetti(c1, c2) {
    const fx = ensureFx();
    const f = floorEl();
    if (!fx || !f) return;
    const w = f.clientWidth;
    for (let i = 0; i < 26; i++) {
      const p = document.createElement('i');
      p.className = 'confetti';
      p.style.left = (Math.random() * w) + 'px';
      p.style.background = Math.random() > 0.5 ? c1 : c2;
      p.style.animationDelay = (Math.random() * 0.5).toFixed(2) + 's';
      p.style.animationDuration = (1.1 + Math.random() * 0.9).toFixed(2) + 's';
      fx.appendChild(p);
      setTimeout(() => p.remove(), 2400);
    }
  }

  /* ---- 오피스 라이프 ---- */
  const CHAT_LINES = [
    ['커피 한 잔 어때요?', '이것만 보고요…'],
    ['펀딩비 확인했어요?', '방금 봤어요, 아직 중립.'],
    ['어제 리포트 봤어요?', '손익비가 아쉽던데요.'],
    ['괴리 벌어지는데?', '지켜보죠. 트리거 전까진 관망.'],
    ['오늘 변동성 크네요', '이럴 때일수록 원칙대로.'],
  ];

  function visibleDesks() {
    return AGENT_IDS.map(deskEl).filter((d) => {
      if (!d || d.classList.contains('idle') || d.classList.contains('working')) return false;
      return getComputedStyle(d).display !== 'none';
    });
  }

  function chatMoment() {
    const desks = visibleDesks();
    if (desks.length < 2) return;
    const i = (Math.random() * desks.length) | 0;
    let j = (Math.random() * desks.length) | 0;
    if (j === i) j = (j + 1) % desks.length;
    const pair = CHAT_LINES[(Math.random() * CHAT_LINES.length) | 0];
    smallTalk(desks[i], pair[0]);
    setTimeout(() => smallTalk(desks[j], pair[1]), 1400);
  }

  function smallTalk(desk, text) {
    const fx = ensureFx();
    const c = centerOf(desk);
    if (!fx || !c) return;
    const t = document.createElement('div');
    t.className = 'small-talk';
    t.textContent = text;
    t.style.left = c.x + 'px';
    t.style.top = (c.y - 56) + 'px';
    fx.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 2300);
  }

  // 커피 타임 — 자리를 비우고 커피머신까지 걸어갔다 온다
  function coffeeTrip() {
    if (coffeeBusy) return;
    const desks = visibleDesks();
    if (!desks.length) return;
    const desk = desks[(Math.random() * desks.length) | 0];
    const sprite = desk.querySelector('.sprite');
    const fx = ensureFx();
    const from = centerOf(desk);
    const anl = document.getElementById('room-analyst');
    if (!sprite || !fx || !from || !anl) return;
    const base = centerOf(anl);
    if (!base) return;
    // 커피머신: 애널리스트 방 좌상단 구석
    const machine = {
      x: base.x - anl.clientWidth / 2 + 46,
      y: base.y - anl.clientHeight / 2 + 58,
    };

    const id = AGENT_IDS.find((k) => deskEl(k) === desk);
    if (!id) return;
    coffeeBusy = true;

    const walker = document.createElement('canvas');
    walker.width = 48;
    walker.height = 48;
    walker.className = 'walker';
    drawSprite(walker, id);
    walker.style.left = (from.x - 24) + 'px';
    walker.style.top = (from.y - 30) + 'px';
    fx.appendChild(walker);
    sprite.classList.add('away');

    requestAnimationFrame(() => {
      walker.classList.add('walking');
      walker.style.transform =
        'translate(' + (machine.x - from.x) + 'px, ' + (machine.y - from.y) + 'px)';
    });

    // 도착 → 김 모락모락 → 복귀
    setTimeout(() => {
      walker.classList.remove('walking');
      for (let s = 0; s < 3; s++) {
        setTimeout(() => {
          const st = document.createElement('i');
          st.className = 'steam';
          st.style.left = (machine.x + 4) + 'px';
          st.style.top = (machine.y - 26) + 'px';
          fx.appendChild(st);
          setTimeout(() => st.remove(), 900);
        }, s * 300);
      }
    }, 1650);
    setTimeout(() => {
      walker.classList.add('walking');
      walker.style.transform = 'translate(0px, 0px)';
    }, 3100);
    setTimeout(() => {
      walker.remove();
      sprite.classList.remove('away');
      coffeeBusy = false;
    }, 4900);
  }

  function stretchMoment() {
    const desks = visibleDesks();
    if (!desks.length) return;
    const s = desks[(Math.random() * desks.length) | 0].querySelector('.sprite');
    if (!s) return;
    s.classList.add('stretch');
    setTimeout(() => s.classList.remove('stretch'), 1200);
  }

  function idleTick() {
    if (running || document.hidden || STILL) return;
    if (document.body.classList.contains('no-life')) return; // 자동 운영 설정에서 끔
    const r = Math.random();
    if (r < 0.45) chatMoment();
    else if (r < 0.75) coffeeTrip();
    else stretchMoment();
  }


  /* ---- 채찍 모드 (OpenWhip 오마주) ----------------------------------------
     채찍을 들고 아무 데나 클릭하면 밧줄이 앞으로 후려쳐지며(래시) 찰싹.
     직원을 클릭하면 추가로: 슬래시 이펙트 + 아파하는 흔들림 + 사과 멘트.
     일하던 중이면 3초간 타이핑이 눈에 띄게 빨라진다.
     순수 연출 — 실제 분석 속도와는 무관하다. ------------------------------- */
  let whipMode = false;

  const WHIP_CRIES = [
    '아야!! 죄송합니다!!',
    '얼른 자료 준비하겠습니다!!',
    '지금 바로 차트 다시 보겠습니다!',
    '죄송합니다! 속도 올리겠습니다!',
    '헉… 더 열심히 하겠습니다!!',
    '잘못했습니다, 바로 수정하겠습니다!',
    '커피는 이따 마시겠습니다!!',
    '분석 두 배로 돌리겠습니다!!',
  ];

  /* 물리 채찍 오버레이 (원본 OpenWhip 방식) --------------------------------
     커서 이미지가 아니라, 베를레 물리로 시뮬레이션한 밧줄 채찍이 마우스를
     따라다닌다. 손잡이(갈색)가 마우스 위치, 끈이 관성으로 출렁이며 휘두르면
     끝이 채찍처럼 감긴다. 팁 속도가 임계치를 넘으면 자동으로 크랙 사운드. */
  const rope = { canvas: null, raf: 0, pts: [], mouse: { x: 0, y: 0 }, lastCrack: 0, flash: 0 };
  const SEG_N = 14;      // 마디 수
  // 마디 길이(px) — 휴대폰 화면에선 밧줄을 짧게(154→112px) 해서 손가락 근처에서 휘둘리게
  const SEG_LEN = document.documentElement.classList.contains('m') ? 8 : 11;
  const CRACK_SPEED = 34; // 프레임당 px — 팁이 이보다 빠르면 크랙
  const HIT_SPEED = 14;   // 밧줄 마디가 이보다 빠르게 책상을 지나가면 명중(프레임당 px)
  const HANDLE_SWIPE = 10; // 손잡이가 프레임당 이보다 빨리 움직일 때만 = 쓸기
  const HIT_COOLDOWN = 650; // 같은 직원 연타 간격(ms) — 탭 클릭과 팁 명중이 겹쳐도 한 번만

  // 쓸어서 때리기: 손가락(손잡이)이 빠르게 움직이는 동안, 손잡이 바로 아래 구간(~50px)이
  // 지나간 책상만 맞는다. 팁·늘어진 밧줄은 래시 뒤 사방으로 튀어서 판정에서 뺀다
  // (그걸 넣으면 옆·아랫줄 직원까지 같이 맞는다). 탭은 누른 그 직원만 — 클릭 핸들러 담당
  function ropeHits(handleSpeed) {
    if (handleSpeed < HANDLE_SWIPE) return;
    const f = floorEl();
    if (!f) return;
    const pts = rope.pts;
    let fr = null, k = 1;
    for (const i of [2, 4, 6]) {
      const p = pts[i];
      if (!p || Math.hypot(p.x - p.px, p.y - p.py) < HIT_SPEED) continue;
      const el = document.elementFromPoint(p.x, p.y);
      const desk = el && el.closest && el.closest('.desk');
      if (!desk || !f.contains(desk)) continue;
      if (!fr) { fr = f.getBoundingClientRect(); k = f.offsetWidth ? fr.width / f.offsetWidth : 1; }
      whipHit(desk, (p.x - fr.left) / k, (p.y - fr.top) / k);
    }
  }

  function ropeStart() {
    if (rope.canvas) return;
    const cv = document.createElement('canvas');
    cv.id = 'whip-rope';
    document.body.appendChild(cv);
    rope.canvas = cv;
    const fit = () => {
      // 백그라운드 탭 등에서 innerWidth가 0으로 잡히는 경우가 있어 폴백을 둔다
      const w = Math.max(innerWidth, document.documentElement.clientWidth, 320);
      const h = Math.max(innerHeight, document.documentElement.clientHeight, 240);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    };
    fit();
    rope.fit = fit;
    addEventListener('resize', fit);
    rope.mouse = { x: innerWidth / 2, y: innerHeight / 2 };
    // 마디 초기화(마우스 아래로 늘어뜨림)
    rope.pts = [];
    for (let i = 0; i < SEG_N; i++) {
      rope.pts.push({ x: rope.mouse.x, y: rope.mouse.y + i * SEG_LEN, px: rope.mouse.x, py: rope.mouse.y + i * SEG_LEN });
    }
    // pointer 이벤트 = 마우스·터치·펜 공용. 휴대폰에서는 손가락을 끄는 대로 손잡이가 따라온다
    document.addEventListener('pointermove', ropeMouse);
    ropeLoop();
  }

  function ropeStop() {
    if (!rope.canvas) return;
    cancelAnimationFrame(rope.raf);
    document.removeEventListener('pointermove', ropeMouse);
    rope.canvas.remove();
    rope.canvas = null;
  }

  function ropeMouse(e) {
    rope.mouse.x = e.clientX;
    rope.mouse.y = e.clientY;
  }

  function ropeLoop() {
    if (!rope.canvas) return;
    ropeFrame();
    rope.raf = requestAnimationFrame(ropeLoop);
  }

  // 한 프레임: 물리 → 크랙·명중 판정 → 그리기 (검증 때는 이것만 직접 돌린다)
  function ropeFrame() {
    const cv = rope.canvas;
    if (!cv) return;
    if (rope.fit) rope.fit();
    const ctx = cv.getContext('2d');
    const pts = rope.pts;

    // 베를레 적분: 관성 + 중력 + 감쇠
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const vx = (p.x - p.px) * 0.985;
      const vy = (p.y - p.py) * 0.985;
      p.px = p.x; p.py = p.y;
      p.x += vx;
      p.y += vy + 0.9; // 중력
    }
    // 손잡이는 마우스에 고정 (옮기기 전 거리 = 이번 프레임 손 속도)
    const handleSpeed = Math.hypot(rope.mouse.x - pts[0].x, rope.mouse.y - pts[0].y);
    pts[0].x = rope.mouse.x; pts[0].y = rope.mouse.y;
    // 거리 제약(밧줄) — 반복할수록 빳빳해진다
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        let dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const diff = (dist - SEG_LEN) / dist;
        if (i === 0) { b.x -= dx * diff; b.y -= dy * diff; }
        else {
          a.x += dx * diff * 0.5; a.y += dy * diff * 0.5;
          b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5;
        }
      }
    }

    // 팁 속도 → 자동 크랙(휘두르기만 해도 찰싹)
    const tip = pts[pts.length - 1];
    const tipSpeed = Math.hypot(tip.x - tip.px, tip.y - tip.py);
    const now = performance.now();
    if (tipSpeed > CRACK_SPEED && now - rope.lastCrack > 260) {
      rope.lastCrack = now;
      rope.flash = 5;
      sfxCrack();
    }
    // 빠르게 쓸고 지나간 직원은 맞는다 — 휴대폰에서 손가락으로 쓸어서 때리기
    ropeHits(handleSpeed);

    // 그리기: 흰 헤일로 → 어두운 끈(손잡이 굵게→팁 얇게) → 갈색 손잡이
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const pass of [
      { color: 'rgba(255,255,255,.75)', wHandle: 7, wTip: 2.4 },
      { color: '#191919', wHandle: 4.4, wTip: 1.2 },
    ]) {
      for (let i = 0; i < pts.length - 1; i++) {
        const t = i / (pts.length - 1);
        ctx.strokeStyle = pass.color;
        ctx.lineWidth = pass.wHandle + (pass.wTip - pass.wHandle) * t;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[i].x, pts[i].y);
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
        ctx.stroke();
      }
    }
    // 손잡이 (픽셀 감성으로 각지게)
    const h = pts[0], h2 = pts[1];
    const ang = Math.atan2(h2.y - h.y, h2.x - h.x);
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(ang);
    ctx.fillStyle = '#6e4a2a';
    ctx.fillRect(-4, -4, 20, 8);
    ctx.fillStyle = '#4e3420';
    ctx.fillRect(-4, -4, 5, 8);
    ctx.restore();

    // 크랙 순간: 팁에서 노란 스파크가 터진다
    if (rope.flash > 0) {
      rope.flash--;
      const a0 = Math.random() * Math.PI;
      ctx.strokeStyle = 'rgba(255,238,120,.9)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a = a0 + (i / 6) * Math.PI * 2;
        const r2 = 14 + rope.flash * 3;
        ctx.beginPath();
        ctx.moveTo(tip.x + Math.cos(a) * 5, tip.y + Math.sin(a) * 5);
        ctx.lineTo(tip.x + Math.cos(a) * r2, tip.y + Math.sin(a) * r2);
        ctx.stroke();
      }
    }
  }

  /* 클릭 = 휘두르기: 늘어진 반대 방향으로 밧줄 전체에 임펄스를 줘
     채찍이 손잡이 너머로 앞으로 후려쳐진다(팁으로 갈수록 세게). */
  function ropeLash() {
    const pts = rope.pts;
    if (!rope.canvas || pts.length < 2) return;
    const tipP = pts[pts.length - 1];
    let dx = pts[0].x - tipP.x, dy = pts[0].y - tipP.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    for (let i = 1; i < pts.length; i++) {
      const s = (i / (pts.length - 1)) * 46;
      pts[i].px = pts[i].x - dx * s;
      pts[i].py = pts[i].y - dy * s;
    }
    rope.lastCrack = performance.now();
    rope.flash = 6;
    sfxCrack(true);
  }

  function whipToggle(force) {
    whipMode = typeof force === 'boolean' ? force : !whipMode;
    document.body.classList.toggle('whip-mode', whipMode);
    if (whipMode && !STILL) ropeStart(); else ropeStop();
    const b = qs('#whip-btn');
    if (b) {
      b.classList.toggle('on', whipMode);
      b.setAttribute('aria-pressed', whipMode ? 'true' : 'false');
      b.textContent = whipMode ? '〰 채찍 내려놓기' : '〰 채찍';
    }
    const chip = qs('#whip-chip');
    if (chip) {
      chip.classList.toggle('on', whipMode);
      chip.setAttribute('aria-pressed', whipMode ? 'true' : 'false');
      chip.textContent = whipMode ? '〰 ✕' : '〰';
    }
  }

  /* 찰싹 사운드: 오실레이터 삑- 이 아니라 진짜 채찍 크랙처럼
     ① 화이트노이즈 버스트(밴드패스 5.2kHz→900Hz 스윕) = 공기 찢는 스냅
     ② 저음 퍽(130→70Hz) = 몸통 임팩트
     ③ 8비트 감성 고음 핑 한 점 */
  let crackNoiseBuf = null;
  function sfxCrack(strong) {
    if (!soundOn || !audioReady) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    try {
      if (!crackNoiseBuf) {
        const len = Math.floor(ctx.sampleRate * 0.2);
        crackNoiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = crackNoiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      const t0 = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = crackNoiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.8;
      bp.frequency.setValueAtTime(5200, t0);
      bp.frequency.exponentialRampToValueAtTime(900, t0 + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(strong ? 0.5 : 0.32, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
      src.connect(bp); bp.connect(g); g.connect(ctx.destination);
      src.start(t0); src.stop(t0 + 0.16);
      tone({ freq: 130, to: 70, dur: 0.07, vol: strong ? 0.07 : 0.05, type: 'triangle' });
      tone({ freq: 3400, dur: 0.02, vol: 0.03, type: 'square' });
    } catch (_) { /* 소리는 실패해도 화면을 막지 않는다 */ }
  }

  function whipHit(desk, clickX, clickY) {
    const fx = ensureFx();
    const c = centerOf(desk);
    if (!fx || !c) return;
    const id = AGENT_IDS.find((k) => deskEl(k) === desk);
    const nowMs = performance.now();
    if (desk._whipAt && nowMs - desk._whipAt < HIT_COOLDOWN) return;
    desk._whipAt = nowMs;

    // mousedown 래시가 방금 크랙을 울렸다면 중복 재생하지 않는다
    if (performance.now() - rope.lastCrack > 200) sfxCrack(true);

    // 슬래시 이펙트 (클릭 지점)
    const slash = document.createElement('div');
    slash.className = 'whip-slash';
    slash.style.left = clickX + 'px';
    slash.style.top = clickY + 'px';
    fx.appendChild(slash);
    setTimeout(() => slash.remove(), 420);

    // 임팩트 별
    for (let i = 0; i < 5; i++) {
      const st = document.createElement('i');
      st.className = 'whip-star';
      st.style.left = (clickX + (Math.random() * 30 - 15)) + 'px';
      st.style.top = (clickY + (Math.random() * 20 - 14)) + 'px';
      fx.appendChild(st);
      setTimeout(() => st.remove(), 550);
    }

    // 아파하는 연기 + 사과
    const sprite = desk.querySelector('.sprite');
    if (sprite) {
      sprite.classList.remove('hurt');
      void sprite.offsetWidth; // 애니메이션 재시작
      sprite.classList.add('hurt');
      setTimeout(() => sprite.classList.remove('hurt'), 900);
    }
    smallTalk(desk, WHIP_CRIES[(Math.random() * WHIP_CRIES.length) | 0]);

    // 일하던 중이면 3초 터보 (개그: 채찍질하면 더 빨리 일함)
    if (desk.classList.contains('working')) {
      desk.classList.add('turbo');
      typingBurst(desk, 6);
      setTimeout(() => desk.classList.remove('turbo'), 3000);
    }

    // 콘솔에도 흔적
    try {
      if (typeof pushLog === 'function' && id) {
        pushLog('sys', '> 채찍 사용됨 — ' + (NAMES[id] || id) + ' 사기 진작(?) 완료');
      }
    } catch (_) { /* 무시 */ }
  }

  function initWhip() {
    const b = qs('#whip-btn');
    if (b) b.addEventListener('click', () => whipToggle());
    const chip = qs('#whip-chip');
    if (chip) chip.addEventListener('click', () => whipToggle());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && whipMode) whipToggle(false);
      // W = 채찍 들기/내려놓기 (녹화 모드처럼 버튼이 숨어 있어도). 입력창에서는 무시
      const t = e.target instanceof Element ? e.target : null;
      if ((e.key === 'w' || e.key === 'W' || e.key === 'ㅈ') && !e.ctrlKey && !e.metaKey && !e.altKey
          && !(t && t.closest('input, textarea, select, [contenteditable]'))) {
        whipToggle();
      }
    });
    // 아무 데나 누르면 휘두른다 (UI 컨트롤 위는 제외 — 버튼은 눌려야 하니까).
    // 터치는 pointermove 없이 바로 pointerdown이 오므로 손잡이를 먼저 그 자리로 옮긴다
    document.addEventListener('pointerdown', (e) => {
      if (!whipMode || STILL) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t && t.closest('button, a, input, select, textarea, label, .bubble')) return;
      // 손가락이 새로 닿은 자리로 밧줄째 옮긴다 — 손잡이가 순간이동하면 '쓸기'로 잘못 판정되고
      // 끌려오는 밧줄이 중간 직원을 때린다. 마우스는 이미 그 자리라 이동량 0
      const dx = e.clientX - rope.pts[0].x, dy = e.clientY - rope.pts[0].y;
      if (dx || dy) {
        for (const p of rope.pts) { p.x += dx; p.y += dy; p.px += dx; p.py += dy; }
      }
      rope.mouse.x = e.clientX;
      rope.mouse.y = e.clientY;
      ropeLash();
    }, true);
    const f = floorEl();
    if (!f) return;
    // 캡처 단계에서 가로채 말풍선 모달 클릭과 충돌하지 않게 한다
    f.addEventListener('click', (e) => {
      if (!whipMode) return;
      const desk = e.target.closest('.desk');
      if (!desk) return;
      e.preventDefault();
      e.stopPropagation();
      const fr = f.getBoundingClientRect();
      const k = f.offsetWidth ? fr.width / f.offsetWidth : 1; // 녹화 프레임 zoom 보정
      whipHit(desk, (e.clientX - fr.left) / k, (e.clientY - fr.top) / k);
    }, true);
  }

  /* ---- 이벤트 배선 ---- */
  function on(ev) {
    choreograph(ev);
    switch (ev.type) {
      case 'run:start':
        running = true;
        mode = ev.mode || 'algo';
        if (!inReplayBurst()) intro(ev);
        break;
      case 'agent:start':
        workOn(ev.id);
        break;
      case 'agent:done':
        workOff(ev.id);
        if (!inReplayBurst()) flyPaper(ev.id);
        break;
      case 'decision':
        if (!inReplayBurst()) stamp(ev);
        break;
      case 'run:end':
        running = false;
        AGENT_IDS.forEach(workOff);
        break;
      default:
        break;
    }
  }

  function init() {
    ensureFx();
    initWhip();
    if (!STILL) {
      setInterval(idleTick, 8500);
      // 첫 로드 3초 뒤 가벼운 오피스 라이프 한 번 (정지 화면 방지)
      setTimeout(idleTick, 3000);
    }
  }

  // _debug: 자동 검증용 훅 (숨긴 탭에서는 rAF가 멈춰 화면으로 확인이 불가능하다)
  return { on, init, _debug: { rope, ropeLash, ropeFrame, sfxCrack } };
})();
