import { describe, it, expect } from 'vitest';
import {
  STEPS, STEP_BY_CODE, canComplete, overdueDays, isOverdue, keepsOriginal,
  stepsOfTrack, newlyOpened, isOpen, canUndo, stepsFor, acceptsEvidence, type StepState,
} from './steps';

/** 전부 done 인 상태 — 여기서 하나씩 빼며 게이트를 확인한다. */
const allDone = (): StepState[] => STEPS.map(s => ({ code: s.code, status: 'done' as const }));
const without = (code: string) =>
  allDone().map(s => (s.code === code ? { ...s, status: 'pending' as const } : s));

describe('카탈로그 자체가 앞뒤가 맞나', () => {
  it('단계 코드는 중복되지 않는다', () => {
    expect(new Set(STEPS.map(s => s.code)).size).toBe(STEPS.length);
  });

  it('선행 단계는 모두 실재하는 코드다', () => {
    for (const s of STEPS) {
      for (const r of s.requires) {
        expect(STEP_BY_CODE[r], `${s.code} → ${r}`).toBeDefined();
      }
    }
  });

  it('선행 관계에 순환이 없다', () => {
    const seen = new Map<string, number>();   // 0=방문중 1=끝
    const walk = (code: string, path: string[]): void => {
      if (seen.get(code) === 1) return;
      expect(seen.get(code), `순환: ${[...path, code].join(' → ')}`).not.toBe(0);
      seen.set(code, 0);
      for (const r of STEP_BY_CODE[code]!.requires) walk(r, [...path, code]);
      seen.set(code, 1);
    };
    for (const s of STEPS) walk(s.code, []);
  });

  it('시작 단계는 차량 도착과 특장 제작 완료 둘뿐이다 — 두 갈래가 독립으로 시작한다', () => {
    expect(STEPS.filter(s => s.requires.length === 0).map(s => s.code).sort())
      .toEqual(['build_done', 'car_arrived']);
  });

  it('발주·수락은 단계가 아니다 — 이미 끝난 일을 두 번 관리하지 않는다', () => {
    expect(STEP_BY_CODE['po_issued']).toBeUndefined();
    expect(STEP_BY_CODE['po_accepted']).toBeUndefined();
  });

  it('특장 트랙은 제작 완료 하나뿐이다', () => {
    expect(stepsOfTrack('body').map(s => s.code)).toEqual(['build_done']);
  });

  it('튜닝은 **등록증 수령**부터 시작한다 — 번호판을 다는 것을 기다리지 않는다', () => {
    expect(STEP_BY_CODE['tuning_drafted']!.requires).toEqual(['plate_received']);
  });

  it('자동차등록증은 수령 단계의 증빙이다 — 그래야 튜닝 4항목이 그 시점에 확보된다', () => {
    expect(STEP_BY_CODE['plate_received']!.evidence).toContain('vehicle_reg');
  });

  it('전자서명 요청은 사람이 완료를 누르는 단계가 아니다', () => {
    expect(STEP_BY_CODE['tuning_sign_sent']!.auto).toBe(true);
  });

  it('서명 완료는 서명본을 받아 본 뒤에만 누를 수 있다', () => {
    expect(STEP_BY_CODE['tuning_signed']!.ackLabel).toBeTruthy();
  });
});

describe('두 갈래가 만나는 지점', () => {
  it('특장 장착은 차량 도착 + 제작 완료를 함께 요구한다', () => {
    expect(STEP_BY_CODE['mounted']!.requires.sort()).toEqual(['build_done', 'car_arrived']);
  });

  it('안전검사는 장착 + 튜닝승인을 함께 요구한다', () => {
    expect(STEP_BY_CODE['inspection_booked']!.requires.sort()).toEqual(['mounted', 'tuning_approved']);
  });

  it('튜닝은 특장 진행을 요구하지 않는다 — 병행할 수 있어야 한다', () => {
    for (const code of ['tuning_drafted', 'tuning_sign_sent', 'tuning_signed', 'tuning_approved']) {
      const reqTracks = STEP_BY_CODE[code]!.requires.map(r => STEP_BY_CODE[r]!.track);
      expect(reqTracks, code).not.toContain('body');
    }
  });

  it('제작 완료는 차량 진행을 요구하지 않는다 — 차가 없어도 만들 수 있다', () => {
    const reqTracks = STEP_BY_CODE['build_done']!.requires.map(r => STEP_BY_CODE[r]!.track);
    expect(reqTracks).not.toContain('vehicle');
  });
});

describe('완료 게이트', () => {
  it('선행이 안 끝나면 막고 무엇이 남았는지 말한다', () => {
    const r = canComplete('mounted', without('build_done'), []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('제작 완료');
  });

  it('증빙이 없으면 막고 무엇이 필요한지 말한다', () => {
    const r = canComplete('car_arrived', allDone(), ['inspection_photo']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('인수증');
  });

  it('선행과 증빙이 다 있으면 통과한다', () => {
    expect(canComplete('car_arrived', allDone(), ['inspection_photo', 'receipt'])).toEqual({ ok: true });
  });

  it('증빙이 필요 없는 단계는 파일 없이 통과한다', () => {
    expect(canComplete('insurance_checked', allDone(), [])).toEqual({ ok: true });
  });

  it('모르는 코드는 막는다', () => {
    expect(canComplete('없는단계', allDone(), []).ok).toBe(false);
  });
});

describe('증빙 보관 방식 — 사진은 줄이고 서류는 원본', () => {
  it('글자를 읽어야 하는 것은 원본을 지킨다', () => {
    for (const k of ['receipt', 'vehicle_reg', 'tuning_approval', 'plate_return'] as const) {
      expect(keepsOriginal(k), k).toBe(true);
    }
  });
  it('사진은 줄인다', () => {
    expect(keepsOriginal('inspection_photo')).toBe(false);
    expect(keepsOriginal('plate_photo')).toBe(false);
  });
});

describe('새로 열리는 단계 — 정체 시계를 함부로 리셋하지 않기 위한 계산', () => {
  it('선행이 다 끝난 단계만 열린다', () => {
    expect(newlyOpened('car_arrived', new Set())).toEqual(['temp_plate_returned', 'insurance_checked']);
  });

  it('**이미 열려 있던** 단계는 포함하지 않는다', () => {
    // po_issued 가 끝나 po_accepted 가 이미 열린 상태에서 car_arrived 를 끝낸다
    // 특장 제작이 이미 끝난 상태에서 차량이 도착한다
    const before = new Set(['build_done']);
    const opened = newlyOpened('car_arrived', before);
    // mounted 는 car_arrived + build_done 이 모두 필요 → 이번에 비로소 열린다
    expect(opened).toContain('mounted');
    // 차량 트랙에서 이번에 열린 것들만 함께 온다
    expect(opened).toContain('temp_plate_returned');
  });

  it('아무것도 새로 열리지 않을 수 있다', () => {
    // build_done 만 끝내면 mounted 는 car_arrived 가 없어 아직 안 열린다
    expect(newlyOpened('build_done', new Set())).toEqual([]);
  });

  it('두 갈래가 만나는 지점은 양쪽이 다 끝나야 열린다', () => {
    expect(newlyOpened('car_arrived', new Set())).not.toContain('mounted');
    expect(newlyOpened('build_done', new Set(['car_arrived']))).toContain('mounted');
  });
});

describe('되돌리기 — 앞뒤가 맞아야 한다', () => {
  const st = (done: string[]): StepState[] =>
    STEPS.map(s => ({ code: s.code, status: done.includes(s.code) ? 'done' as const : 'pending' as const }));

  it('완료된 단계만 되돌릴 수 있다', () => {
    const r = canUndo('car_arrived', st([]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('완료된 단계');
  });

  it('뒤 단계가 끝났으면 막고 무엇을 먼저 풀어야 하는지 말한다', () => {
    // 차량 도착 → 특장 장착이 이미 완료된 상태에서 차량 도착을 되돌리려 하면
    const r = canUndo('car_arrived', st(['car_arrived', 'build_done', 'mounted']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('특장 장착');
  });

  it('뒤 단계가 아직이면 되돌릴 수 있다', () => {
    expect(canUndo('car_arrived', st(['car_arrived']))).toEqual({ ok: true });
  });

  it('뒤에서부터 풀면 순서대로 되돌아간다', () => {
    let s = st(['car_arrived', 'build_done', 'mounted']);
    expect(canUndo('mounted', s)).toEqual({ ok: true });
    s = s.map(x => (x.code === 'mounted' ? { ...x, status: 'pending' as const } : x));
    expect(canUndo('car_arrived', s)).toEqual({ ok: true });
  });

  it('모르는 코드는 막는다', () => {
    expect(canUndo('없는단계', st([])).ok).toBe(false);
  });
});

describe('지연 판정 — 약속한 날을 넘긴 것만', () => {
  const NOW = new Date(2026, 7, 20);   // 8/20
  const NONE = new Set<string>();

  it('마감 당일까지는 지연이 아니다 — 그날 안에 하면 지킨 것이다', () => {
    expect(overdueDays('2026-08-20', NOW)).toBeNull();
    expect(overdueDays('2026-08-21', NOW)).toBeNull();
  });

  it('넘긴 일수를 센다', () => {
    expect(overdueDays('2026-08-17', NOW)).toBe(3);
  });

  it('마감이 없으면 지연이 아니다 — 근거 없이 빨갛게 칠하지 않는다', () => {
    expect(overdueDays(null, NOW)).toBeNull();
    expect(isOverdue('car_arrived', { code: 'car_arrived', status: 'pending' }, null, NOW, NONE)).toBe(false);
  });

  it('마감을 넘겼어도 **아직 열리지 않은 단계**는 지연이 아니다', () => {
    // 안전검사 완료는 신청이 끝나야 열린다
    expect(isOverdue('inspection_done', { code: 'inspection_done', status: 'pending' }, '2026-08-01', NOW, NONE)).toBe(false);
  });

  it('열려 있고 마감을 넘겼으면 지연이다', () => {
    const done = new Set(['car_arrived', 'build_done', 'tuning_approved', 'mounted', 'inspection_booked']);
    expect(isOverdue('inspection_done', { code: 'inspection_done', status: 'pending' }, '2026-08-01', NOW, done)).toBe(true);
  });

  it('끝난 단계는 지연이 아니다', () => {
    expect(isOverdue('build_done', { code: 'build_done', status: 'done' }, '2026-01-01', NOW, NONE)).toBe(false);
  });

  it('마감이 있는 단계는 둘뿐이다 — 실제로 약속한 날이 있는 것만', () => {
    expect(STEPS.filter(s => s.dueFrom).map(s => s.code)).toEqual(['build_done', 'inspection_done']);
  });

  it('납기일은 주문에서, 검사 마감은 신청 단계에서 온다', () => {
    expect(STEP_BY_CODE['build_done']!.dueFrom).toEqual({ from: 'order', field: 'delivery_due' });
    expect(STEP_BY_CODE['inspection_done']!.dueFrom).toEqual({ from: 'step', code: 'inspection_booked' });
  });
});

describe('트랙', () => {
  it('네 갈래에 모든 단계가 빠짐없이 들어간다', () => {
    const n = (['vehicle', 'body', 'tuning', 'merged'] as const)
      .map(t => stepsOfTrack(t).length).reduce((a, b) => a + b, 0);
    expect(n).toBe(STEPS.length);
  });
});

describe('특장만 주문 — 차량 트랙은 「차량 도착」 하나만', () => {
  const defs = stepsFor(true);
  const codes = defs.map(s => s.code);

  it('차량 트랙에 남는 단계는 차량 도착뿐이다', () => {
    expect(defs.filter(s => s.track === 'vehicle').map(s => s.code)).toEqual(['car_arrived']);
  });

  it('빠진 단계를 선행으로 삼는 단계가 남아 있지 않다', () => {
    // 남겨 두면 아무도 열 수 없는 단계가 생긴다 — 주문이 그 자리에서 영원히 멈춘다
    for (const s of defs) {
      for (const r of s.requires) {
        expect(codes, `${s.code} → ${r}`).toContain(r);
      }
    }
  });

  it('차량 도착의 증빙은 인수증이 아니라 자동차등록증이다', () => {
    // 우리가 넘겨준 차가 아니라 고객이 몰고 온 차다 — 받을 인수증이 없다
    const car = defs.find(s => s.code === 'car_arrived')!;
    expect(car.evidence).toEqual(['vehicle_reg']);
    expect(STEP_BY_CODE['car_arrived']!.evidence).toContain('receipt');  // 일반 주문은 그대로
  });

  it('튜닝신청서는 차량 도착만으로 시작된다', () => {
    expect(defs.find(s => s.code === 'tuning_drafted')!.requires).toEqual(['car_arrived']);
  });

  it('일반 주문 카탈로그는 손대지 않는다', () => {
    expect(stepsFor(false)).toBe(STEPS);
  });

  it('등록증만 올리면 차량 도착을 넘길 수 있다', () => {
    const states: StepState[] = defs.map(s => ({ code: s.code, status: 'pending' as const }));
    expect(canComplete('car_arrived', states, ['vehicle_reg'], defs).ok).toBe(true);
    expect(canComplete('car_arrived', states, [], defs).ok).toBe(false);
  });

  it('특장만이어도 장착은 차 도착과 제작 완료를 함께 기다린다', () => {
    const states: StepState[] = defs.map(s => ({
      code: s.code, status: s.code === 'car_arrived' ? 'done' as const : 'pending' as const,
    }));
    expect(canComplete('mounted', states, [], defs).ok).toBe(false);
  });
});

describe('덧증빙 — 검수 사진은 어느 단계에나 붙는다', () => {
  it('필수 증빙이 아닌 단계에도 검수 사진은 받는다', () => {
    expect(acceptsEvidence(STEP_BY_CODE['build_done']!, 'inspection_photo')).toBe(true);
    expect(acceptsEvidence(STEP_BY_CODE['mounted']!, 'inspection_photo')).toBe(true);
  });

  it('아무 서류나 아무 단계에 붙지는 않는다', () => {
    expect(acceptsEvidence(STEP_BY_CODE['build_done']!, 'receipt')).toBe(false);
    expect(acceptsEvidence(STEP_BY_CODE['mounted']!, 'tuning_approval')).toBe(false);
  });

  it('덧증빙은 완료를 막지 않는다 — 없어도 넘어간다', () => {
    const states: StepState[] = STEPS.map(s => ({
      code: s.code, status: s.code === 'car_arrived' || s.code === 'build_done' ? 'done' as const : 'pending' as const,
    }));
    expect(canComplete('mounted', states, [], STEPS).ok).toBe(true);
  });
});
