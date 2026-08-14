import { describe, it, expect } from 'vitest';
import {
  STEPS, STEP_BY_CODE, canComplete, isStalled, stalledDays, keepsOriginal,
  stepsOfTrack, newlyOpened, isOpen, type StepState,
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

  it('시작 단계는 차량 도착과 발주서 발행 둘뿐이다 — 두 갈래가 독립으로 시작한다', () => {
    expect(STEPS.filter(s => s.requires.length === 0).map(s => s.code).sort())
      .toEqual(['car_arrived', 'po_issued']);
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
    expect(newlyOpened('po_issued', new Set())).toEqual(['po_accepted']);
  });

  it('**이미 열려 있던** 단계는 포함하지 않는다', () => {
    // po_issued 가 끝나 po_accepted 가 이미 열린 상태에서 car_arrived 를 끝낸다
    const before = new Set(['po_issued', 'po_accepted', 'build_done']);
    const opened = newlyOpened('car_arrived', before);
    // mounted 는 car_arrived + build_done 이 모두 필요 → 이번에 비로소 열린다
    expect(opened).toContain('mounted');
    // 이미 열려 있던 것들이 섞이면 그 시계가 리셋된다
    expect(opened).not.toContain('po_accepted');
  });

  it('아무것도 새로 열리지 않을 수 있다', () => {
    // build_done 만 끝내면 mounted 는 car_arrived 가 없어 아직 안 열린다
    expect(newlyOpened('build_done', new Set(['po_issued', 'po_accepted']))).toEqual([]);
  });

  it('두 갈래가 만나는 지점은 양쪽이 다 끝나야 열린다', () => {
    expect(newlyOpened('car_arrived', new Set())).not.toContain('mounted');
    expect(newlyOpened('build_done', new Set(['car_arrived']))).toContain('mounted');
  });
});

describe('정체 판정', () => {
  const NOW = new Date(2026, 7, 20);

  it('기준 일수를 넘기면 재촉한다', () => {
    // car_arrived 는 7일 기준
    expect(isStalled('car_arrived', { code: 'car_arrived', status: 'pending' }, new Date(2026, 7, 13), NOW)).toBe(true);
    expect(isStalled('car_arrived', { code: 'car_arrived', status: 'pending' }, new Date(2026, 7, 15), NOW)).toBe(false);
  });

  it('끝난 단계는 재촉하지 않는다', () => {
    expect(isStalled('car_arrived', { code: 'car_arrived', status: 'done' }, new Date(2026, 6, 1), NOW)).toBe(false);
  });

  it('들어온 적 없으면 셀 수 없다', () => {
    expect(stalledDays(null, NOW)).toBeNull();
    expect(isStalled('car_arrived', { code: 'car_arrived', status: 'pending' }, null, NOW)).toBe(false);
  });
});

describe('트랙', () => {
  it('네 갈래에 모든 단계가 빠짐없이 들어간다', () => {
    const n = (['vehicle', 'body', 'tuning', 'merged'] as const)
      .map(t => stepsOfTrack(t).length).reduce((a, b) => a + b, 0);
    expect(n).toBe(STEPS.length);
  });
});
