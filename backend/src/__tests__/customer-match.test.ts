import { describe, it, expect } from 'vitest';
import { customerMatches, hasMasterKey } from '../services/customer-master.js';

/**
 * **「같은 고객인가」의 정의.**
 *
 * 이 규칙이 좁으면 견적을 낼 때마다 고객 행이 새로 생기고(실제로 그랬다 — 운영 고객의
 * 절반이 생년월일 없이 쌓였다), 넓으면 남남이 한 행에 섞인다. 그래서 여기에 못박는다.
 */
describe('고객 매칭 규칙', () => {
  it('생년월일이 없으면 성명+휴대폰으로 찾는다 — 이게 이번에 넓힌 부분이다', () => {
    expect(customerMatches('홍길동', '', '010-1234-5678'))
      .toEqual([{ name: '홍길동', phone: '010-1234-5678', hidden_at: null, reg_no: null }]);
  });

  /**
   * 처음엔 생년월일 없이 저장하고, 나중에 같은 고객에게 견적을 다시 내면서 채우는 흐름.
   * 생년월일로만 찾으면 못 찾아 **새 행이 생긴다** — 그래서 휴대폰으로 한 번 더 본다.
   */
  it('생년월일이 있어도 휴대폰으로 한 번 더 찾는다 — 순서는 생년월일이 먼저', () => {
    const m = customerMatches('홍길동', '800101', '010-1234-5678');
    expect(m).toHaveLength(2);
    expect(m[0]).toEqual({ name: '홍길동', reg_no: '800101', hidden_at: null });
    // 2차에서는 생년월일이 **비었거나 같은** 행만 — 다른 생년월일은 다른 사람이다
    expect(m[1]).toEqual({ name: '홍길동', phone: '010-1234-5678', hidden_at: null, OR: [{ reg_no: null }, { reg_no: '800101' }] });
  });

  it('이름만으로는 찾지 않는다 — 동명이인이 한 행에 섞인다', () => {
    expect(customerMatches('홍길동', '', '')).toEqual([]);
    expect(customerMatches('홍길동', null, null)).toEqual([]);
  });

  it('이름이 없으면 찾지 않는다 — 번호만 같은 남남이 섞인다(가족이 한 번호를 쓴다)', () => {
    expect(customerMatches('', '800101', '010-1234-5678')).toEqual([]);
    expect(customerMatches('   ', null, '010-1234-5678')).toEqual([]);
  });

  it('앞뒤 공백은 무시한다 — 「홍길동 」과 「홍길동」은 같은 사람이다', () => {
    expect(customerMatches('  홍길동  ', '  800101  ', null)[0])
      .toEqual({ name: '홍길동', reg_no: '800101', hidden_at: null });
  });

  /**
   * ⚠️ 숨긴 고객에는 붙지 않는다. 숨김은 「안 쓰기로 한 행」이라,
   * 거기 붙으면 새 견적의 고객이 화면에서 사라진다.
   */
  it('언제나 숨기지 않은 고객만 후보로 본다', () => {
    for (const m of customerMatches('홍길동', '800101', '010-1234-5678')) {
      expect(m.hidden_at, '숨긴 고객이 후보에 들어갔다').toBeNull();
    }
  });

  /**
   * 읽기 경로는 넓히지 않았다 — 휴대폰까지 받아 주면 이름·번호를 넣어 보며
   * 남의 주소·연락처를 떠보는 통로가 된다.
   */
  it('자동 기입 조회는 여전히 성명+생년월일 둘 다 요구한다', () => {
    expect(hasMasterKey('홍길동', '800101')).toBe(true);
    expect(hasMasterKey('홍길동', '')).toBe(false);
    expect(hasMasterKey('', '800101')).toBe(false);
  });
});
