/**
 * 탑(적재함) 완성무게 파라메트릭 산정 — 외측 치수 L·W·H(mm) + 냉동/내장 + 도어구성.
 *
 * 출처: 260701 STEGO K1 Spec 중량계산시트(냉동/내장)를 부품별로 L·W·H 함수로 분해.
 *  - 벽/천장/바닥 패널 = 면적 × 면적밀도(kg/m²)
 *  - 가드 = 모서리 길이 × 선밀도(kg/m)
 *  - 후문·사이드도어 = 개구부 면적 기반, 냉동기·부대비 = 상수
 *  - 프레임 = 길이·폭 선형(파이프 부재: L방향 11.70 + W방향 13.98 kg/m, 시트 총합 65 배율 보정)
 * 검증: 냉동/내장 × 저상/표준 × 여닫이/슬라이딩 × 기본/4도어 16조합 재현, 오차 ≤ 0.05kg.
 * (top-weight.test.ts)
 *
 * ⚠️ 미닫이(양문/쿠팡)는 별도 산정(내장 전용, 시트상 +180 특수) — 이 수식 미포함.
 */

export type BodyKind = 'reefer' | 'dry'; // 냉동 / 내장
export type DoorKind = 'swing' | 'slide'; // 여닫이 / 슬라이딩

const DL = 0.06, DW = 0.12;      // 바닥 내측 여백(외측 대비, m)
const FRAME_L = 13.479;          // 프레임 길이(L) 계수 kg/m
const FRAME_W = 16.106;          // 프레임 폭(W) 계수 kg/m  (명목 2.54×1.91 → 65kg)

interface Coef {
  panelWall: number;              // front/side/top 면적밀도 kg/m²
  bottom: [number, boolean][];    // [밀도, 내측여부] 바닥 다층
  guard: { lowSide: number; lowFront: number; side: number; topSide: number; topFront: number };
  rear: [number, number][];       // [밀도, 여백] 후문 프레임/외피/내피
  rearParts: number;
  sideDoorCoef: number;           // 사이드도어 면적밀도 합(폭 0.85 고정)
  sideDoorParts: number;
  reefer: number;                 // 냉동기
  etc: number;
  slidePerDoor: number;
}

const COEF: Record<BodyKind, Coef> = {
  reefer: {
    panelWall: 5.22,
    bottom: [[5.2, true], [1.146, true], [8.0, true], [3.0, false]], // AL, XPS, 합판, GRP
    guard: { lowSide: 0.884, lowFront: 0.884, side: 0.904, topSide: 0.799, topFront: 0.799 },
    rear: [[8.0, 0.0], [9.7, 0.06], [4.3, 0.12]],
    rearParts: 15.0,
    sideDoorCoef: 23.0,  // 9.0 + 9.7 + 4.3
    sideDoorParts: 6.0,
    reefer: 60.0, etc: 10.0, slidePerDoor: 10.0,
  },
  dry: {
    panelWall: 5.02,
    bottom: [[5.2, true], [8.0, true], [3.0, false]], // AL, 합판, GRP (XPS 없음)
    guard: { lowSide: 0.884, lowFront: 0.884, side: 0.904, topSide: 0.799, topFront: 0.799 },
    rear: [[8.0, 0.0], [9.7, 0.06]], // 내피 없음
    rearParts: 15.0,
    sideDoorCoef: 18.7,  // 9.0 + 9.7
    sideDoorParts: 6.0,
    reefer: 0.0, etc: 10.0, slidePerDoor: 10.0,
  },
};

/**
 * 탑 완성무게(kg). L/W/H = 적재함 외측 치수(mm).
 * doorAdd=true → 4도어(운전석측 추가), false → 기본(조수석 1도어).
 */
export function calcTopWeightKg(
  L_mm: number, W_mm: number, H_mm: number,
  opts: { body: BodyKind; doorType: DoorKind; doorAdd: boolean },
): number {
  const L = L_mm / 1000, W = W_mm / 1000, H = H_mm / 1000;
  const c = COEF[opts.body];

  // 벽/천장 패널 (외측 면)
  let panels = W * H * c.panelWall + 2 * (L * H * c.panelWall) + L * W * c.panelWall;
  // 바닥 다층
  for (const [dens, inner] of c.bottom) {
    const a = inner ? (L - DL) * (W - DW) : L * W;
    panels += a * dens;
  }
  // 가드 (모서리)
  const g = c.guard;
  const guards = 2 * L * g.lowSide + W * g.lowFront + 2 * H * g.side + 2 * L * g.topSide + W * g.topFront;
  // 프레임 (길이·폭 선형 — 파이프 부재)
  const frame = FRAME_L * L + FRAME_W * W;
  // 후문 (항상)
  let rear = c.rearParts;
  for (const [dens, m] of c.rear) rear += (W - m) * (H - m) * dens;
  // 사이드도어 (기본 1, 4도어 2)
  const nSide = opts.doorAdd ? 2 : 1;
  const sideOne = 0.85 * H * c.sideDoorCoef + c.sideDoorParts;
  const sides = nSide * sideOne;
  // 가산
  let add = c.etc + c.reefer;
  if (opts.doorType === 'slide') add += c.slidePerDoor * nSide;

  return panels + guards + frame + rear + sides + add;
}
