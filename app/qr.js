/* ==========================================================================
   PIXEL TRADING FLOOR — qr.js
   최소 QR 코드 인코더 (바이트 모드 · 오류정정 M · 버전 1~10 · 외부 의존성 0).
   휴대폰 접속 주소를 QR로 보여주는 데만 쓴다. window.qrMatrix(text) → 0/1 2차원 배열.
   ========================================================================== */
'use strict';

window.qrMatrix = (function () {
  // 버전별 (블록당 EC 코드워드 수, [[블록 수, 블록당 데이터 코드워드], ...]) — 오류정정 레벨 M
  const EC_M = {
    1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]],
    6: [16, [[4, 27]]], 7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]],
    10: [26, [[4, 43], [1, 44]]],
  };
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };

  // GF(256), 원시다항식 0x11d
  const EXP = new Array(512);
  const LOG = new Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  function rsGenerator(n) {
    let g = [1]; // 최고차 → 최저차
    for (let i = 0; i < n; i++) {
      const ng = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); }
      g = ng;
    }
    return g;
  }

  function rsEncode(data, n) {
    const g = rsGenerator(n);
    const res = new Array(n).fill(0);
    for (const d of data) {
      const f = d ^ res[0];
      res.shift();
      res.push(0);
      if (f) for (let j = 0; j < n; j++) res[j] ^= mul(g[j + 1], f);
    }
    return res;
  }

  function utf8(text) {
    return Array.from(new TextEncoder().encode(String(text)));
  }

  function pickVersion(len) {
    for (let v = 1; v <= 10; v++) {
      const [ecN, groups] = EC_M[v];
      const dataCw = groups.reduce((s, [c, d]) => s + c * d, 0);
      const cap = Math.floor((dataCw * 8 - 4 - (v < 10 ? 8 : 16)) / 8);
      if (len <= cap) return v;
    }
    return null;
  }

  function encodeCodewords(bytes, version) {
    const [ecN, groups] = EC_M[version];
    const totalData = groups.reduce((s, [c, d]) => s + c * d, 0);
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(0b0100, 4); // 바이트 모드
    push(bytes.length, version < 10 ? 8 : 16);
    for (const b of bytes) push(b, 8);
    const cap = totalData * 8;
    push(0, Math.min(4, cap - bits.length)); // 종결자
    while (bits.length % 8) bits.push(0);
    const pads = [0xec, 0x11];
    for (let i = 0; bits.length < cap; i++) push(pads[i & 1], 8);
    const cws = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let k = 0; k < 8; k++) v = (v << 1) | bits[i + k];
      cws.push(v);
    }
    const blocks = [];
    let p = 0;
    for (const [count, dcw] of groups) for (let i = 0; i < count; i++) { blocks.push(cws.slice(p, p + dcw)); p += dcw; }
    const ecs = blocks.map((b) => rsEncode(b, ecN));
    const out = [];
    const maxD = Math.max(...blocks.map((b) => b.length));
    for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
    for (let i = 0; i < ecN; i++) for (const e of ecs) out.push(e[i]);
    return out;
  }

  const getBit = (x, i) => (x >>> i) & 1;

  function build(version, codewords) {
    const N = version * 4 + 17;
    const m = Array.from({ length: N }, () => new Array(N).fill(0));
    const fn = Array.from({ length: N }, () => new Array(N).fill(false));
    // (col, row) 순서 — 규격 문서와 같은 좌표계
    const set = (x, y, dark) => { m[y][x] = dark ? 1 : 0; fn[y][x] = true; };

    const finder = (x0, y0) => {
      for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= N || y >= N) continue;
        const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        const dark = inside && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        set(x, y, dark);
      }
    };
    finder(0, 0); finder(N - 7, 0); finder(0, N - 7);

    for (let i = 8; i < N - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }

    const al = ALIGN[version];
    const last = al[al.length - 1];
    for (const cy of al) for (const cx of al) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === last) || (cx === last && cy === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }

    // 포맷·버전 정보 자리 예약 (값은 마스크 결정 후 기록)
    for (let i = 0; i <= 8; i++) { if (i !== 6) { fn[i][8] = true; fn[8][i] = true; } }
    for (let i = 0; i < 8; i++) { fn[8][N - 1 - i] = true; fn[N - 1 - i][8] = true; }
    if (version >= 7) {
      for (let i = 0; i < 18; i++) {
        const a = N - 11 + (i % 3), b = Math.floor(i / 3);
        fn[b][a] = true; fn[a][b] = true;
      }
    }

    // 데이터 배치 (지그재그)
    const bits = [];
    for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
    let idx = 0;
    let up = true;
    for (let col = N - 1; col > 0; col -= 2) {
      if (col === 6) col = 5;
      for (let k = 0; k < N; k++) {
        const y = up ? N - 1 - k : k;
        for (const x of [col, col - 1]) {
          if (fn[y][x]) continue;
          m[y][x] = idx < bits.length ? bits[idx++] : 0;
        }
      }
      up = !up;
    }

    const MASK = [
      (x, y) => (x + y) % 2 === 0,
      (x, y) => y % 2 === 0,
      (x, y) => x % 3 === 0,
      (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
      (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
      (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];

    function writeFormat(mask) {
      const data = (0b00 << 3) | mask; // 오류정정 M = 00
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const f = ((data << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) set(8, i, getBit(f, i));
      set(8, 7, getBit(f, 6));
      set(8, 8, getBit(f, 7));
      set(7, 8, getBit(f, 8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, getBit(f, i));
      for (let i = 0; i < 8; i++) set(N - 1 - i, 8, getBit(f, i));
      for (let i = 8; i < 15; i++) set(8, N - 15 + i, getBit(f, i));
      set(8, N - 8, true); // 항상 어두운 모듈
    }
    function writeVersion() {
      if (version < 7) return;
      let rem = version;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const v = (version << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const a = N - 11 + (i % 3), b = Math.floor(i / 3);
        set(a, b, getBit(v, i));
        set(b, a, getBit(v, i));
      }
    }

    function applyMask(mask) {
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!fn[y][x] && MASK[mask](x, y)) m[y][x] ^= 1;
    }

    function penalty() {
      let score = 0;
      const runs = (get) => {
        for (let a = 0; a < N; a++) {
          let run = 1;
          for (let b = 1; b < N; b++) {
            if (get(a, b) === get(a, b - 1)) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
            else run = 1;
          }
        }
      };
      runs((a, b) => m[a][b]);
      runs((a, b) => m[b][a]);
      for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
      const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
      const finderLike = (get) => {
        for (let a = 0; a < N; a++) for (let b = 0; b + 11 <= N; b++) {
          let ok1 = true, ok2 = true;
          for (let k = 0; k < 11; k++) { const v = get(a, b + k); if (v !== P1[k]) ok1 = false; if (v !== P2[k]) ok2 = false; }
          if (ok1 || ok2) score += 40;
        }
      };
      finderLike((a, b) => m[a][b]);
      finderLike((a, b) => m[b][a]);
      let dark = 0;
      for (const row of m) for (const v of row) dark += v;
      const pct = (dark * 100) / (N * N);
      score += Math.floor(Math.abs(pct - 50) / 5) * 10;
      return score;
    }

    writeVersion();
    let best = 0, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      applyMask(mask);
      writeFormat(mask);
      const s = penalty();
      if (s < bestScore) { bestScore = s; best = mask; }
      applyMask(mask); // 원복
    }
    applyMask(best);
    writeFormat(best);
    return m;
  }

  return function qrMatrix(text) {
    const bytes = utf8(text);
    const version = pickVersion(bytes.length);
    if (!version) return null; // 너무 길다(버전 10 초과)
    return build(version, encodeCodewords(bytes, version));
  };
})();
