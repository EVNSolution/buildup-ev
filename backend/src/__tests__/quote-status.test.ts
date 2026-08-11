/**
 * 단계 도달 시각 — 성과의 '속도' 지표가 전부 여기에 걸려 있다.
 * 틀려도 화면에는 그럴듯한 숫자가 뜨므로 눈으로는 못 잡는다.
 */
import { describe, it, expect } from 'vitest';
import { stageTimesOf } from '../services/quote-status.js';

const d = (s: string) => new Date(s);
const log = (to: string, at: string) => ({ new_value: to, changed_at: d(at) });

describe('단계 도달 시각', () => {
  const quote = { created_at: d('2026-08-01T00:00:00Z') };

  it('이력에서 각 단계의 시각을 뽑는다', () => {
    const t = stageTimesOf(quote, [
      log('confirmed', '2026-08-03T00:00:00Z'),
      log('contracted', '2026-08-06T00:00:00Z'),
    ], {});
    expect(t.draft).toEqual(d('2026-08-01T00:00:00Z'));
    expect(t.confirmed).toEqual(d('2026-08-03T00:00:00Z'));
    expect(t.contracted).toEqual(d('2026-08-06T00:00:00Z'));
    expect(t.assigned).toBeNull();
  });

  it('같은 단계를 여러 번 오갔으면 **처음 도달한 때**를 쓴다', () => {
    // 되돌린 뒤 다시 온 것은 재작업이지 '더 늦게 도달'이 아니다
    const t = stageTimesOf(quote, [
      log('confirmed', '2026-08-03T00:00:00Z'),
      log('draft', '2026-08-04T00:00:00Z'),
      log('confirmed', '2026-08-09T00:00:00Z'),
    ], {});
    expect(t.confirmed).toEqual(d('2026-08-03T00:00:00Z'));
  });

  it('이력이 없던 옛 견적은 곁에 남은 시각으로 메운다', () => {
    const t = stageTimesOf(quote, [], {
      contracted: d('2026-08-05T00:00:00Z'),   // 서명 완료 시각
      assigned: d('2026-08-07T00:00:00Z'),     // 주문 배정 시각
    });
    expect(t.contracted).toEqual(d('2026-08-05T00:00:00Z'));
    expect(t.assigned).toEqual(d('2026-08-07T00:00:00Z'));
    expect(t.confirmed).toBeNull();            // 메울 근거가 없으면 null — 지어내지 않는다
  });

  it('이력이 있으면 이력이 우선이다(메우기는 없을 때만)', () => {
    const t = stageTimesOf(quote, [log('contracted', '2026-08-04T00:00:00Z')], {
      contracted: d('2026-08-09T00:00:00Z'),
    });
    expect(t.contracted).toEqual(d('2026-08-04T00:00:00Z'));
  });
});
