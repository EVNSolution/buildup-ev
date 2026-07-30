/**
 * 탑(적재함) 완성무게 파라메트릭 산정 — 외측 치수 L·W·H(mm) + 냉동/내장 + 도어구성.
 * ⚠️ 냉동기(reefer)는 이 무게에 포함하지 않는다 — 별도 설치항목(weight_constant reefer_w)으로만 계산.
 *   (설계문서 §3: top_w = 순수 탑만. 냉동기 50kg/후축까지 -300 은 BOM 설치항목.)
 *
 * 출처: 260701 STEGO K1 Spec 중량계산시트(냉동/내장)를 부품별로 L·W·H 함수로 분해.
 *  - 벽/천장/바닥 패널 = 면적 × 면적밀도(kg/m²)
 *  - 가드 = 모서리 길이 × 선밀도(kg/m)
 *  - 후문·사이드도어 = 개구부 면적 기반, 부대비 = 상수
 *  - 프레임 = 파이프 부재 3개 [단중×수량×(치수−여백)/1000] + 하드웨어 (셀 수식 그대로)
 *
 * 상수는 전부 주입(weight_constant → DB). 미주입 시 DEFAULT_WEIGHT_CONSTANTS.top 사용.
 * 검증: shared/bom/top-weight.test.ts (냉동/여닫이/4도어 2590×1910×1590 → 407.1kg 등)
 */
import {
  DEFAULT_WEIGHT_CONSTANTS,
  type TopWeightConstants,
  type TopBodyConst,
} from './weight-constants.js';

export type BodyKind = 'reefer' | 'dry'; // 냉동 / 내장
export type DoorKind = 'swing' | 'slide'; // 여닫이 / 슬라이딩

/** 프레임 중량(kg) — 파이프 부재 3개(단중×수량×(치수−여백)/1000) + 하드웨어. 치수 mm. */
function frameKg(L_mm: number, W_mm: number, f: TopWeightConstants['frame']): number {
  return f.steelUnit * f.steelQty * (L_mm - f.steelOff) / 1000 // Main Frame (Steel)
       + f.al1Unit * f.al1Qty * (W_mm - f.al1Off) / 1000       // Sub Bracket_1 (AL)
       + f.al2Unit * f.al2Qty * (L_mm - f.al2Off) / 1000       // Sub Bracket_2 (AL)
       + f.hardware;
}

/**
 * 탑 완성무게(kg). L/W/H = 적재함 외측 치수(mm). 냉동기 제외(순수 탑).
 * doorAdd=true → 4도어(운전석측 추가), false → 기본(조수석 1도어).
 * C = 탑무게 상수(주입). 생략 시 seed 기반 기본값.
 */
export function calcTopWeightKg(
  L_mm: number, W_mm: number, H_mm: number,
  opts: { body: BodyKind; doorType: DoorKind; doorAdd: boolean },
  C: TopWeightConstants = DEFAULT_WEIGHT_CONSTANTS.top,
): number {
  const L = L_mm / 1000, W = W_mm / 1000, H = H_mm / 1000;
  const c: TopBodyConst = C[opts.body];
  const DL = C.bottomInsetL_m, DW = C.bottomInsetW_m;

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
  // 프레임 (부재 수식 + 하드웨어)
  const frame = frameKg(L_mm, W_mm, C.frame);
  // 후문 (항상)
  let rear = c.rearParts;
  for (const [dens, m] of c.rear) rear += (W - m) * (H - m) * dens;
  // 사이드도어 (기본 1, 4도어 2)
  const nSide = opts.doorAdd ? 2 : 1;
  const sideOne = C.sideDoorWidth_m * H * c.sideDoorCoef + c.sideDoorParts;
  const sides = nSide * sideOne;
  // 가산 (부대비 + 슬라이딩) — 냉동기 항 없음
  let add = c.etc;
  if (opts.doorType === 'slide') add += c.slidePerDoor * nSide;

  return panels + guards + frame + rear + sides + add;
}
