/* 리퀴드 글래스 — 유리 뒤 화면이 가장자리에서 굴절·번지고, 테두리 빛이 마우스를 따라 도는 애플식 유리.
   github.com/rdev/liquid-glass-react (MIT, Copyright 2025 Max Rovensky)의 방식(SVG feDisplacementMap 굴절 + 색수차 + backdrop-filter +
   마우스를 따라 도는 테두리 하이라이트)을 React 없이 옮긴 것이다. 굴절 맵 이미지(MAP)도 그 저장소 것.
   · 크롬·엣지(Chromium)는 굴절까지, 사파리·파이어폭스는 SVG 굴절이 안 보이므로 블러+하이라이트 유리(frosted)로 대신한다.
   · 지원 안 되는 브라우저는 아무것도 하지 않는다 — 원래 카드 모양 그대로. */
(function () {
  'use strict';

  var MAP = 'data:image/jpeg;base64,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cUAUAkEkziomgGgkoxZGgxZFQFQlYnQHRdPfj/10KCSCKESCNiVkViPSLpD0h6I0Q0I0A2IoBWBIJIBKBIJoJIJ2R2J0JWBUJ0JUB0XTv479dFZDYiglYigkhEgjZFQjRFQjRFQjQigFYigHYigmgEgmglYlYnQlQlYlQHQlQnQ9P/kf1yVkNiNCNkNiVENiNiViNEViNkVCVgKCViViViSCViSCVgdCViVCViVCdgVCVCdD1D+U/XBWQ2I0I2Q2JUQ2I0JWQ0I2JUQ2JUI2JUI2J0JWJWJWA2R0BWJ0I2JUJ2BUJUJ0P//EABkQAQEBAQEBAAAAAAAAAAAAAAECABEDEP/aAAgBAQABAgB1atWrVq1atWrVq1atWrVq1atWrVq1atWrVq+OrVq1atWrVq1atWrVq1atWrVq1atWrVq1atXxVppppppdWrVq1atWrVq1NNNNNNNNNNNPVWmmmmms6tWrVq1atWpppppppppppppp6q0000uc51atWrVq1ammmmmmmmmmmmmt1Vpppc5znVq1atWrVqaaaaaaaaaaaaaeqtNLnOc51atWrVq1ammmmmmmmmmmmmnqrS5znOc6tWrVq16222mmmmmmlVppp6tKuc5znOrVq1a9TbbbbTTTTTSq000qtLnOc5zq1atWrW0222200000qqqtKqrnOc5zq1atTbbbbbbbbTTTSqqqqqq5znOc6tTTTbbbbbbbbTTTSqqqqrlVznOctNNNtttttttttNNNNKqqqrqznKqrTTTTbbbbbbbbbTTTSqqqqrqznOc5aaaabbbbbbbbbaaaaVVVVVdWc5znVq1NNttttttttttNNKqqqqudWc5znVq16tbbbbbbbbbbTTSqqqq5XVnOc6tWrVrb1tttttttttNNKqqqqrWrK5VWmmm2230bbbbbbaaaXOc5zlVa1KuVVppptttt9G22222mmlzlVznK6tWVVWmmmm2222222222mlznOc5znLWppVVWmmm22222229bTWrOc5znOcq1qaaVpWmm222222229erVqznOc5znKtatStK0rTbTTbbbberXr1as5znOc5aVpppppWlabaabbbb1ta9WrVnOc5znU0rTTTTTTTTTbTTbbbTWvVq1as5znOdTTStNNNNNNNNNtNNtttN6tWvVq1ZznOrU00rTTTTTTTTTTTTTbTWvVq1atWrOc6tTTTStNNNNNNNNNNtNNtNa9WrVq1Z1Z1NNNNNK1q1NNNNNNNNNNNtNatWrVq1atWrU00000rWrVq1atWrVq1alaaa1atWrVq1NNNammmmla1atWrVq1aterVq16tWrVnVqa1NK1qaaaVX/xAAWEAADAAAAAAAAAAAAAAAAAAAhgJD/2gAIAQEAAz8AaExf/8QAGhEBAQEBAQEBAAAAAAAAAAAAAQISEQADEP/aAAgBAgEBAgDx48ePHjx48ePHjx48ePHjx48ePHjx48ePHj86IiIiIiInjx48ePHjx48IiIiIj0oooooooooRERER73ve60UUUUUUVrWiiiiiihERERER73ve97ooooorRWiiiiihKERERER73ve973RRRRWtFFFFFFCIiIiIiPe973ve60UUVrRRRRRRQiIlCIiI973ve973pRRWiiiiiiiiiiiiiiihEe973ve973RRWtFFFFFFFFFFFFFFFFFFa13ve973WitaKKKKKKKKKKKKKKKKKK1rWtd1rutFa1oooooooooooosssooorWta1rWta1rRRRRRRRRRRZZZZZZZZZWta1rWta1rRRRRRRRRZZZZZZZZZZZZe9a1rWta1rWitaKLLLLLLLLLLLLLLLLL3rWta1rWtFbLLLLLLLLLLLLLLLLLLLL3vWta1rWita1ssssssss+hZZZZZZZZe961rWta0Vre97LLLLLLLLLLLPoWWWWWXrWta1oorWta3ssss+hZZZZ9Cyyyyyyyyiita1orWta1ve9llllllllllllllllFFa0VorWta1ve9llllllllllllllllllFFFaK1rWta1rWiyyyyyyyyyyyyiiiiiiitFFa1rWta1oosoosssssoooosoooorRRRWta1rWta0UUUUUWUUUUUUUUUUUVoooorWta1rWtaKKKKKKmiiiiiiiiiiiiiiitd73ve61oSiiipoqaKKKKKKKKKK0UUUVrve973vREREZoSihEooooorRRRRWtd73ve9EREREREoSiiiiitFllllla73ve9ERERERESiiiiiitH0PoWWWWVrXe96IiIiMoiJRRRRRRWjwlFFllllFFd6IiIiIlCUUUUUUUUUePHjx48ePCIiIiIiIiUUUUUUUUUUUePHjx48ePHjx48ePHjx48IiUUUUUUJRRRX//xAAWEQADAAAAAAAAAAAAAAAAAAABYJD/2gAIAQIBAz8AtEV7/8QAFxEBAQEBAAAAAAAAAAAAAAAAAAECEP/aAAgBAwEBAgCtNNNNNNNNNNNNNNNNNNNNNNNNNNNNNcrTTTTTTTTTTTTTTTTTTTTTTTTTTTTTXKrTTTTTTTU000000000000000000001FVpppppqampqaaaaaaaaaaaaaaaaaaaa5Vaaaaampqampqammmmmmmmmmmlaaaaaaiq0001NTU1NTU1NTTTTTTTTTTSqqtNNNcqtNNSyzU1LNTU1NTTTTTTTTTSqqq001ytNLLLLNTU1NTU1NTbbbTTTTTSqqq001ytNLLLLLNTU1NTU3NttttNNNNNKqq001KrSyyyyyzU1NTU3Nzc02220000qqqqrSqqyyyyyzU1NTU3Nzc3NttttNNNKqqqqqqssssss1NTU3Nzc3NzbbbbTTTSqqqqqqrLLLLLNTU1Nzc3Nzc22220000qqqqqqqqssss1NTU3Nzc3NzbbbbbTTSqqqqqqqqqqzU1NTc3Nzc3Nzbc22000qqqqqqqqqqqtTU3Nzc3Nzc3NtzbTTSqqqqrKqqqqqtNNzc23Nzc3Nzc3NTU1KqqqrKqqqqqtNNNNttzc3Nzc3NzU1NLLLLLKqqqqqqqq0022223Nzc3NzU1NSyyyyyyqqqqqqqrTTbbbbc3Nzc3NTU1LLLLLLKsqqqqqqrTTTTbbbc3Nzc1NTUsssssssqqqqqqrTTTTTbbbTc3NTU1NTUsssssqqqqqqqq0000222023NTU1NTUsssssqqqqqqqq000000003NTU1NTU1LLLLLNKrTSqqqqtNNNNNNtNNTU1NSzUssss00qq0qqqqrTTTTTTTTTU1NTUs1LLLNNNKrTTTSqqq00000000001NTU1LNTU0000qtNNNKqqqtNNNNNNNNTU1NTUs1NNNNNKss1NNNK00qtK0000001NNTU0s000000qq000001NKrStNNNNK1NNNNStNNNNNKqtNNNNNNNK0000000rU0000rTTTTTSq00000rTTTTTTTTTTTTTTTTStNNNNKr/xAAUEQEAAAAAAAAAAAAAAAAAAACg/9oACAEDAQM/AAAf/9k=';
  var ua = navigator.userAgent || '';
  var supported = !!(window.CSS && CSS.supports && (CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)')));
  if (!supported) return;
  // iOS의 크롬·파이어폭스는 사파리 엔진이라 굴절이 안 된다
  // 굴절(SVG feDisplacementMap)은 끈다 — 2026-10-02 실측(RTX 2080 Ti, 1920px): 켜면 스크롤 초당 16프레임, 끄면 56프레임.
  // 흐림 유리 + 마우스를 따라 도는 테두리 빛만 남긴다. 다시 켜려면 REFRACT = true (크롬·엣지만 해당)
  var REFRACT = false;
  var refract = REFRACT && /Chrome\//.test(ua) && !/CriOS|FxiOS|OPiOS/.test(ua);

  // 크기별 설정 — 큰 카드는 굴절을 약하게(글자 뒤가 너무 출렁이지 않게), 작은 버튼은 라이브러리 버튼 예시 값
  var PRESET = {
    card: { scale: 34, blur: 0.28, sat: 150, ab: 2 },
    pill: { scale: 64, blur: 0.18, sat: 135, ab: 2 },
  };
  var TARGETS = [['.rail-card', 'card'], ['.dock .pill', 'pill'], ['.btn.ghost', 'pill'], ['.chip', 'pill']];

  var hosts = [];
  var seq = 0;

  function filterSvg(id, p) {
    var a = p.ab;
    return '<svg class="lq-svg" aria-hidden="true" focusable="false"><defs>'
      + '<filter id="' + id + '" x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB">'
      + '<feImage x="0" y="0" width="100%" height="100%" result="MAP" href="' + MAP + '" preserveAspectRatio="xMidYMid slice"/>'
      + '<feColorMatrix in="MAP" type="matrix" values="0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0 0 0 1 0" result="EDGE_I"/>'
      + '<feComponentTransfer in="EDGE_I" result="EDGE_MASK"><feFuncA type="discrete" tableValues="0 ' + (a * 0.05) + ' 1"/></feComponentTransfer>'
      + '<feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER"/>'
      + '<feDisplacementMap in="SourceGraphic" in2="MAP" scale="' + (-p.scale) + '" xChannelSelector="R" yChannelSelector="B" result="R_D"/>'
      + '<feColorMatrix in="R_D" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="R_C"/>'
      + '<feDisplacementMap in="SourceGraphic" in2="MAP" scale="' + (-p.scale - p.scale * a * 0.05) + '" xChannelSelector="R" yChannelSelector="B" result="G_D"/>'
      + '<feColorMatrix in="G_D" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="G_C"/>'
      + '<feDisplacementMap in="SourceGraphic" in2="MAP" scale="' + (-p.scale - p.scale * a * 0.1) + '" xChannelSelector="R" yChannelSelector="B" result="B_D"/>'
      + '<feColorMatrix in="B_D" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="B_C"/>'
      + '<feBlend in="G_C" in2="B_C" mode="screen" result="GB"/>'
      + '<feBlend in="R_C" in2="GB" mode="screen" result="RGB"/>'
      + '<feGaussianBlur in="RGB" stdDeviation="' + Math.max(0.1, 0.5 - a * 0.1) + '" result="AB_BLUR"/>'
      + '<feComposite in="AB_BLUR" in2="EDGE_MASK" operator="in" result="EDGE_AB"/>'
      + '<feComponentTransfer in="EDGE_MASK" result="INV"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>'
      + '<feComposite in="CENTER" in2="INV" operator="in" result="CENTER_CLEAN"/>'
      + '<feComposite in="EDGE_AB" in2="CENTER_CLEAN" operator="over"/>'
      + '</filter></defs></svg>';
  }

  function attach(el, kind) {
    if (el.classList.contains('lq')) return;
    var p = PRESET[kind] || PRESET.card;
    el.classList.add('lq');
    if (!refract) el.classList.add('lq-flat');
    var blurPx = 4 + p.blur * 32;
    var warp = document.createElement('span');
    warp.className = 'lq-warp';
    warp.setAttribute('aria-hidden', 'true');
    var bf = 'blur(' + blurPx + 'px) saturate(' + p.sat + '%)';
    warp.style.webkitBackdropFilter = bf;
    warp.style.backdropFilter = bf;
    var svgBox = null;
    if (refract) {
      var id = 'lq-f' + (++seq);
      var tmp = document.createElement('div');
      tmp.innerHTML = filterSvg(id, p);
      svgBox = tmp.firstChild;
      warp.style.filter = 'url(#' + id + ')';
    }
    var e1 = document.createElement('span');
    e1.className = 'lq-edge lq-edge-a';
    var e2 = document.createElement('span');
    e2.className = 'lq-edge lq-edge-b';
    [e2, e1, warp].forEach(function (n) { el.insertBefore(n, el.firstChild); });
    if (svgBox) el.insertBefore(svgBox, el.firstChild);
    var size = function () {
      if (!svgBox) return;
      var r = el.getBoundingClientRect();
      svgBox.setAttribute('width', Math.max(1, Math.round(r.width)));
      svgBox.setAttribute('height', Math.max(1, Math.round(r.height)));
    };
    size();
    if (typeof ResizeObserver === 'function') new ResizeObserver(size).observe(el);
    hosts.push(el);
  }

  // 테두리 하이라이트가 마우스를 따라 돈다(라이브러리와 같은 식) — 화면에 보이는 유리만 갱신
  var pos = null;
  var raf = 0;
  function paint() {
    raf = 0;
    if (!pos) return;
    for (var i = 0; i < hosts.length; i++) {
      var el = hosts[i];
      var r = el.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
      var mx = ((pos.x - (r.left + r.width / 2)) / r.width) * 100;
      var my = ((pos.y - (r.top + r.height / 2)) / r.height) * 100;
      mx = Math.max(-60, Math.min(60, mx));
      my = Math.max(-60, Math.min(60, my));
      var s = el.style;
      s.setProperty('--lq-ang', (135 + mx * 1.2).toFixed(1) + 'deg');
      s.setProperty('--lq-a1', (0.12 + Math.abs(mx) * 0.008).toFixed(3));
      s.setProperty('--lq-a2', (0.4 + Math.abs(mx) * 0.012).toFixed(3));
      s.setProperty('--lq-b1', (0.32 + Math.abs(mx) * 0.008).toFixed(3));
      s.setProperty('--lq-b2', (0.6 + Math.abs(mx) * 0.012).toFixed(3));
      s.setProperty('--lq-s1', Math.max(10, 33 + my * 0.3).toFixed(1) + '%');
      s.setProperty('--lq-s2', Math.min(90, 66 + my * 0.4).toFixed(1) + '%');
    }
  }

  function boot() {
    TARGETS.forEach(function (t) {
      document.querySelectorAll(t[0]).forEach(function (el) { attach(el, t[1]); });
    });
    window.addEventListener('pointermove', function (e) {
      pos = { x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(paint);
    }, { passive: true });
    document.documentElement.classList.add('lq-on');
    window.LiquidGlass = { attach: attach, refract: refract, count: function () { return hosts.length; } };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
