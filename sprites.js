/* public/app.js에서 빌드 때 뽑은 픽셀 직원 데이터 — 여기서 고치지 말 것 */
(function () {
const SPRITE_ROWS = [
  "................", // 0
  ".....HHHHHH.....", // 1  머리 위
  "...HHHHHHHHHH...", // 2
  "..HHHHHHHHHHHH..", // 3
  "..HHssssssssHH..", // 4  이마
  "..HssEEssEEssH..", // 5  눈 2px ×2
  "..HssssssssssH..", // 6
  "...ssssMMssss...", // 7  입 2px
  "....ssssssss....", // 8  턱
  "...BBBBBBBBBB...", // 9  어깨
  "..BBBBBBBBBBBB..", // 10 몸통(블롭)
  "..BBBBDDDDBBBB..", // 11 옷 디테일
  "..BBBBBBBBBBBB..", // 12
  "..BBBBBBBBBBBB..", // 13
  "...BBBBBBBBBB...", // 14
  "....BBBBBBBB...."  // 15 둥근 바닥
];

// 캐릭터별 팔레트 + 액세서리(특정 행 오버라이드)
const CHARACTERS = {
  taro: { // 파란 모자 + 헤드셋
    palette: { H:'#3b6fd4', s:'#f0c8a0', E:'#241a2e', M:'#b85c56', B:'#2b4a8a', D:'#1e3566', X:'#22222e' },
    overrides: {
      5: ".XHssEEssEEssHX.", // 헤드셋 이어컵
      6: ".XHssssssssssHX."
    }
  },
  diana: { // 갈색 단발
    palette: { H:'#8a5a34', s:'#f2cda4', E:'#241a2e', M:'#b85c56', B:'#a94f6b', D:'#7d3a52' },
    overrides: { 7: "..HssssMMssssH.." } // 단발이 볼까지
  },
  nova: { // 노란 머리
    palette: { H:'#e8c84a', s:'#f0c8a0', E:'#241a2e', M:'#b85c56', B:'#3f9d78', D:'#2c7357' },
    overrides: {}
  },
  vibe: { // 보라 후드
    palette: { H:'#7a4bc4', s:'#f0c8a0', E:'#241a2e', M:'#b85c56', B:'#5f3a9e', D:'#452b73' },
    overrides: { 7: "..HssssMMssssH.." } // 후드가 얼굴을 감쌈
  },
  bull: { // 주황 몸 + 뿔 2개
    palette: { H:'#e08a3c', s:'#f6b06a', E:'#241a2e', M:'#7a3b1e', B:'#d97b2e', D:'#b25f1c', X:'#f2e9d0' },
    overrides: {
      0: "...X........X...", // 뿔 끝
      1: "..XXHHHHHHHHXX.."  // 뿔 밑동
    }
  },
  bear: { // 빨간 몸 + 둥근 곰귀
    palette: { H:'#c0392b', s:'#e88a7a', E:'#241a2e', M:'#7a2318', B:'#b03328', D:'#8a2418' },
    overrides: {
      1: "..HH........HH.." // 곰귀 2개
    }
  },
  ace: { // 금발 + 선글라스
    palette: { H:'#e8c86a', s:'#f0c8a0', E:'#241a2e', M:'#b85c56', B:'#2a2a34', D:'#c9a84a', X:'#141018' },
    overrides: {
      5: "..HssXXXXXXssH..", // 선글라스
      12: "..BBBBBDDBBBBB.." // 금색 넥타이
    }
  },
  blitz: { // 시안/일렉트릭 블루 + 노란 바이저·번개
    palette: { H:'#22d3ee', s:'#f0c8a0', E:'#241a2e', M:'#0e4a5a', B:'#1f6feb', D:'#22d3ee', X:'#ffd60a' },
    overrides: {
      5:  "..HssXXXXXXssH..", // 노란 바이저
      10: "..BBBBBXXBBBBB..", // 번개 (지그재그)
      11: "..BBBBXXBBBBBB..",
      12: "..BBBXXXXBBBBB..",
      13: "..BBBBBXXBBBBB.."
    }
  },
  guard: { // 스틸 그레이 + 헬멧·방패
    palette: { H:'#9aa4b2', s:'#e8c4a0', E:'#241a2e', M:'#7a5c4a', B:'#4b5563', D:'#374151', X:'#cbd5e1' },
    overrides: {
      4:  "..HHHHHHHHHHHH..", // 헬멧이 이마까지
      10: "..BBBBXXXXBBBB..", // 방패 엠블럼
      11: "..BBBBXXXXBBBB..",
      12: "..BBBBXXXXBBBB..",
      13: "..BBBBBXXBBBBB.."  // 방패 하단 테이퍼
    }
  },
  risky: { // 주황·공격적 — 뾰족한 스파이크 머리 + 상승 화살표
    palette: { H:'#ff7a3c', s:'#f6b06a', E:'#241a2e', M:'#7a3b1e', B:'#e2582a', D:'#b23c18', X:'#ffd60a' },
    overrides: {
      0: "....X..X..X.....", // 스파이크 끝
      1: "...XHHHHHHHHX...",
      11:"..BBBBBXXBBBBB..", // 위로 향한 화살표
      12:"..BBBBXXXXBBBB..",
      13:"..BBBXXXXXXBBB.."
    }
  },
  neutral: { // 회청 — 평평한 저울 느낌
    palette: { H:'#7f93b0', s:'#eec9a4', E:'#241a2e', M:'#6a5040', B:'#5a6b82', D:'#42505f', X:'#c8d4e2' },
    overrides: {
      11:"..BBXXXXXXXXBB..", // 수평 저울대
      12:"..BBBBBXXBBBBB.."
    }
  },
  safe: { // 짙은 청록 + 방패
    palette: { H:'#2f9e8f', s:'#e8c4a0', E:'#241a2e', M:'#5a4436', B:'#1f6d63', D:'#14504a', X:'#a7e8dd' },
    overrides: {
      4: "..HHHHHHHHHHHH..", // 헬멧
      10:"..BBXXXXXXXXBB..", // 큰 방패
      11:"..BBXXXXXXXXBB..",
      12:"..BBBXXXXXXBBB..",
      13:"..BBBBXXXXBBBB.."
    }
  },
  pm: { // 검정 정장 + 금 넥타이 (ACE보다 격식)
    palette: { H:'#3a3a46', s:'#efc9a2', E:'#241a2e', M:'#8a5148', B:'#15151f', D:'#d4af37', X:'#f2f2f8' },
    overrides: {
      9: "...BBBXXXXBBB...", // 흰 셔츠 카라
      10:"..BBBXDDXBBBBB..", // 금 넥타이 매듭
      11:"..BBBBXDDXBBBB..",
      12:"..BBBBBDDBBBBB..",
      13:"..BBBBBDDBBBBB.."
    }
  }
};


window.PTF_SPRITES = { rows: SPRITE_ROWS, chars: CHARACTERS };
})();
