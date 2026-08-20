import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **진행 요약에는 끝낸 단계만 적는다.**
 *
 * 목록 줄에 「지금 할 수 있는 단계」(`open`)를 적어 두었더니, 아무것도 완료 안 된 주문에
 * 「차량 도착 · 특장 제작 완료」가 떴다. 읽는 사람은 그것을 **끝냈다**고 읽는다 —
 * 0/15 인데 두 단계를 마친 것처럼 보였다(실제 제보).
 *
 * 할 일과 끝낸 일은 **반대 뜻**이라, 한 자리에 같은 모양으로 적으면 안 된다.
 * `open` 은 줄 순서와 지연 표시에만 쓴다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('진행 요약', () => {
  it('서버가 끝낸 단계를 함께 내려준다', () => {
    const route = read('backend/src/routes/orders.ts');
    expect(route).toMatch(/done_labels:/);
    expect(route).toMatch(/last_done:/);
  });

  /** 요약 문구가 그려지는 자리(`line2`)만 잘라 낸다 — 파일 전체를 보면 정렬용 open 에 걸린다. */
  function summaryBlock(src: string): string {
    const at = src.indexOf('style={s.line2}');
    expect(at, 'line2 를 못 찾았다 — 이름이 바뀌었으면 검사식을 고칠 것').toBeGreaterThan(0);
    return src.slice(at, src.indexOf('</div>', at));
  }

  it('관리자 주문 보드는 할 일을 요약 문구로 쓰지 않는다', () => {
    const block = summaryBlock(read('frontend/src/components/OrderStepsBoard.tsx'));
    // 화면에 늘어놓는 것은 완료 쪽뿐이다
    expect(block).toMatch(/last_done/);
    expect(block, `요약 자리에서 open 을 쓰고 있다:\n${block}`).not.toMatch(/\bopen\b/);
  });

  it('영업 목록 설명창도 끝낸 단계를 적는다', () => {
    const sales = read('frontend/src/pages/SalesPage.tsx');
    expect(sales).toMatch(/done_labels\.join\(/);
    expect(sales, 'open 을 문구로 이어 붙이고 있다').not.toMatch(/open[^;\n]{0,20}\.join\(/);
  });

  it('open 은 정렬·강조에만 남는다 — 아주 지우지는 않는다', () => {
    // 「어느 건에 손이 필요한가」는 줄 순서가 답한다. 그 근거까지 없애면 정렬이 무너진다
    const board = read('frontend/src/components/OrderStepsBoard.tsx');
    expect(board).toMatch(/open\.length/);
  });

  it('가장 나중에 끝낸 것을 고를 때 오름차순 맨 뒤를 집는다', () => {
    /*
     * 내림차순 첫 개를 집으면, 완료 시각이 없는 옛 기록에서 비교가 전부 0 이 되어
     * **카탈로그 첫 단계**가 「가장 나중」으로 뽑힌다(넷을 끝냈는데 「차량 도착」이 떴다).
     */
    const route = read('backend/src/routes/orders.ts');
    expect(route).toMatch(/byCodeDoneAt\(steps, a\.code\)[^;]*byCodeDoneAt\(steps, b\.code\)/);
    expect(route).toMatch(/\.pop\(\)/);
  });
});
