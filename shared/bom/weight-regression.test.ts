import { describe, it, expect } from 'vitest';
import { calcLoad } from '../load-calc/core.js';
import { DEFAULT_WEIGHT_CONSTANTS as C, maxPayloadKg } from './weight-constants.js';

/**
 * 정답지 회귀테스트 (설계문서 §5·§6).
 *
 * 구분:
 *  - 회귀테스트(이 파일): 실물 서류의 무게(탑 550·냉동기 50·데크 300)를 넣어 E9721 재현.
 *  - 자동생성(운영): 탑무게는 §3 계산값(≈407.1)을 쓰므로 값이 실물과 다른 게 정상.
 *    → 최대적재량 자동값(450)이 서류값(300)과 다른 것도 정상.
 *
 * 이 값들은 관청 제출 정답지(ozprint 1083-2026-E9721) 기준 ground truth.
 * 코드가 이걸 재현하도록 유지하고, 코드에 맞춰 이 값을 바꾸지 말 것.
 */

const tire = { allowable_load_kg: C.tire_allow_kg, wheels: C.tire_wheels };

describe('회귀: E9721 (오픈베드→냉동 표준탑 여닫이 4도어, 실물무게)', () => {
  const TOP_REAL = 550; // 실물 서류상 탑 제작무게 (계산값 407.1보다 무겁게 제작)
  const curbAfter = C.curb_base_kg - C.deck_w_kg + TOP_REAL + C.reefer_w_kg; // 2205
  const payload = maxPayloadKg(curbAfter, C); // 300

  const r = calcLoad({
    wheelbase_mm: C.wheelbase_mm,
    curb_axle_front_kg: C.curb_base_front_kg,
    curb_axle_rear_kg: C.curb_base_rear_kg,
    gvw_limit_kg: C.gvw_limit_kg,
    tire_front: tire, tire_rear: tire,
    remove_items: [{ weight_kg: C.deck_w_kg, dist_to_rear_axle_mm: C.deck_d_mm }],
    install_items: [
      { weight_kg: TOP_REAL, dist_to_rear_axle_mm: C.top_d_mm },
      { weight_kg: C.reefer_w_kg, dist_to_rear_axle_mm: C.reefer_d_mm },
    ],
    cargo: { weight_kg: payload, dist_to_rear_axle_mm: C.cargo_d_mm },
    crew_items: [{ weight_kg: C.crew_w_kg, dist_to_rear_axle_mm: C.crew_d_mm }],
  });

  it('차량중량_후 2205, 최대적재량 300', () => {
    expect(curbAfter).toBe(2205);
    expect(payload).toBe(300);
  });
  it('공차 전/후축 1105 / 1100', () => {
    expect(r.curb.front_kg).toBe(1105);
    expect(r.curb.rear_kg).toBe(1100);
  });
  it('적차 전/후축 1190 / 1445', () => {
    expect(r.loaded.front_kg).toBe(1190);
    expect(r.loaded.rear_kg).toBe(1445);
  });
  it('차량총중량 2635', () => expect(r.gvw_kg).toBe(2635));
  it('조향륜 하중분포율 45.2 %', () => expect(r.steering_axle_ratio_pct).toBe(45.2));
  it('적차 타이어 부하율 70.0 / 85.0 %', () => {
    expect(r.tire_load_rate.loaded_front_pct).toBe(70.0);
    expect(r.tire_load_rate.loaded_rear_pct).toBe(85.0);
  });
});

describe('회귀: 오픈베드 (구조변경 전, §6 정정값)', () => {
  const payload = maxPayloadKg(C.curb_base_kg, C); // 600

  const r = calcLoad({
    wheelbase_mm: C.wheelbase_mm,
    curb_axle_front_kg: C.curb_base_front_kg,
    curb_axle_rear_kg: C.curb_base_rear_kg,
    gvw_limit_kg: C.gvw_limit_kg,
    tire_front: tire, tire_rear: tire,
    cargo: { weight_kg: payload, dist_to_rear_axle_mm: C.cargo_d_mm },
    crew_items: [{ weight_kg: C.crew_w_kg, dist_to_rear_axle_mm: C.crew_d_mm }],
  });

  it('최대적재량 600', () => expect(payload).toBe(600));
  it('공차 전/후축 1105 / 800', () => {
    expect(r.curb.front_kg).toBe(1105);
    expect(r.curb.rear_kg).toBe(800);
  });
  it('적차 전/후축 1195 / 1440', () => {
    expect(r.loaded.front_kg).toBe(1195);
    expect(r.loaded.rear_kg).toBe(1440);
  });
  it('차량총중량 2635', () => expect(r.gvw_kg).toBe(2635));
});

describe('최대적재량 수식 (설계문서 §4)', () => {
  it('오픈베드 차량중량_후 1905 → 600', () => expect(maxPayloadKg(1905, C)).toBe(600));
  it('E9721 실물 차량중량_후 2205 → 300', () => expect(maxPayloadKg(2205, C)).toBe(300));

  it('E9721 자동생성(탑 계산값 407.1) → 450 (서류값 300과 다른 게 정상)', () => {
    const curbAuto = C.curb_base_kg - C.deck_w_kg + 407.1 + C.reefer_w_kg; // 2062.1
    expect(maxPayloadKg(curbAuto, C)).toBe(450);
  });

  it('gvw_limit 상수 변경 시 결과가 따라 변함', () => {
    const looser = { ...C, gvw_limit_kg: C.gvw_limit_kg + 50 };
    expect(maxPayloadKg(1905, looser)).toBe(650);
  });
});
