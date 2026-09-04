import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { nudgeKindFor, nudgeText, NUDGE_HOUR } from '../services/due-nudge.js';
import { dueInfo } from '@buildup-ev/shared/process/due';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const NOW = new Date(2026, 8, 4);

/**
 * **납기 알림** — 특장사가 단계를 안 밟아, 실제로 출고가 끝난 차가 시스템에는
 * 「납기 경과」로 남아 있었다(실제 사례). 목록은 우리만 보고 특장사에게는 아무도
 * 알려 주지 않았다 — 지금까지 알림은 채팅·배정 때만 갔다.
 */
describe('언제 보내는가', () => {
  const kindOf = (due: string) => {
    const i = dueInfo(due, NOW);
    return nudgeKindFor(i.days, i.state);
  };

  it('🔴 3일 전 하루만 — 매일 보내면 재촉이 무뎌진다', () => {
    expect(kindOf('2026-09-07')).toBe('soon');    // 3일 전
    expect(kindOf('2026-09-06')).toBeNull();      // 2일 전 — 안 보낸다
    expect(kindOf('2026-09-05')).toBeNull();      // 1일 전 — 안 보낸다
  });

  it('🔴 당일은 따로 보낸다', () => {
    expect(kindOf('2026-09-04')).toBe('today');
  });

  it('🔴 지난 동안에는 **날마다** — 지난 건은 재촉이 목적이다', () => {
    expect(kindOf('2026-09-03')).toBe('overdue');
    expect(kindOf('2026-08-20')).toBe('overdue');
  });

  it('🔴 여유가 있거나 납기가 없으면 안 보낸다', () => {
    expect(kindOf('2026-10-01')).toBeNull();
    const none = dueInfo(null, NOW);
    expect(nudgeKindFor(none.days, none.state)).toBeNull();
  });
});

describe('문구 — 무게가 다르다', () => {
  it('🔴 지난 건은 며칠 지났는지와 **무엇을 해 달라는지**를 말한다', () => {
    const t = nudgeText('overdue', -3, 19);
    expect(t.title).toContain('납기 3일 경과');
    // 「늦었다」만 말하면 무엇을 하라는지 모른다
    expect(t.body).toContain('단계');
  });

  it('🔴 당일·3일 전도 주문 번호를 달고 간다 — 어느 건인지 알아야 움직인다', () => {
    expect(nudgeText('today', 0, 19).title).toContain('#19');
    expect(nudgeText('soon', 3, 19).title).toContain('납기 3일 전');
  });
});

describe('두 번 가지 않는다', () => {
  it('🔴 발송 기록을 **DB 에서** 유일하게 둔다 — 코드로는 두 슬롯의 경합을 못 막는다', () => {
    /*
     * 백엔드는 blue/green 두 슬롯으로 잠깐 함께 도는 순간이 있다.
     * (주문, 종류, 보낸 날) 을 유일하게 두면 두 번째를 DB 가 거절한다.
     */
    const mig = read('backend/prisma/migrations/20260907000000_add_order_due_notice/migration.sql');
    expect(mig).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "order_due_notice_once"/);
    expect(mig).toMatch(/\("order_id", "kind", "sent_on"\)/);
    expect(mig).not.toMatch(/DELETE\s+FROM|TRUNCATE|DROP\s+TABLE/i);
  });

  it('🔴 **먼저 적고 나서 보낸다** — 반대로 하면 기록 실패 시 또 간다', () => {
    const svc = read('backend/src/services/due-nudge.ts');
    const create = svc.indexOf('orderDueNotice.create');
    const send = svc.indexOf('notify(to, {');
    expect(create).toBeGreaterThan(0);
    expect(create).toBeLessThan(send);
  });

  it('🔴 새벽에는 보내지 않는다', () => {
    expect(NUDGE_HOUR).toBeGreaterThanOrEqual(8);
    expect(read('backend/src/services/due-nudge.ts')).toMatch(/now\.getHours\(\) < NUDGE_HOUR/);
  });
});

describe('누구에게', () => {
  it('🔴 배정된 특장사 조직 중 「앱 알림」을 켠 사람에게만', () => {
    const svc = read('backend/src/services/due-nudge.ts');
    expect(svc).toMatch(/org_code: o\.maker_org_id!/);
    expect(svc).toMatch(/pushAllowed\(/);
  });

  it('🔴 끝났거나 치운 주문에는 안 보낸다', () => {
    const svc = read('backend/src/services/due-nudge.ts');
    expect(svc).toMatch(/canceled_at: null/);
    expect(svc).toMatch(/LIVE_STATUS/);
  });

  it('🔴 눌러서 그 주문으로 간다 — 알림만 오고 어디로 갈지 모르면 소용없다', () => {
    expect(read('backend/src/services/due-nudge.ts')).toMatch(/url: `\/\?order=\$\{o\.id\}`/);
  });
});

/**
 * **대화 사진을 그대로 증빙으로.** 업로드의 번거로움이 단계를 안 밟는 큰 이유다.
 */
describe('대화 사진 → 증빙', () => {
  const routes = () => read('backend/src/routes/steps.ts');

  it('🔴 사진 증빙만 — 서류는 원본이 필요하다', () => {
    /*
     * 서류 증빙(인수증·튜닝신청서·승인서…)은 글자를 읽어야 해서 원본을 지켜 보관한다.
     * 대화 사진은 올릴 때 이미 줄여 놓으므로, 서류 자리에 넣으면 읽을 수 없는 서류가 남는다.
     */
    expect(routes()).toMatch(/if \(keepsOriginal\(kind\)\)/);
    expect(routes()).toMatch(/NEEDS_ORIGINAL/);
  });

  it('🔴 파일을 **복사**한다 — 대화에서 사진이 사라지면 안 된다', () => {
    expect(routes()).toMatch(/copyFile\(from, abs\)/);
  });

  it('🔴 이 주문의 대화 사진만 — 남의 파일·이미 증빙인 것은 안 된다', () => {
    expect(routes()).toMatch(/where: \{ id: fileId, order_id: id, kind: 'chat' \}/);
  });

  it('🔴 대화 사진은 증빙 목록에도, 완료 판정에도 안 섞인다', () => {
    /*
     * 같은 곳(order_file)에 저장되지만 증빙은 아니다. 섞이면 올리지 않은 증빙을
     * 올린 것으로 읽고, 사진 한 장으로 단계가 완료 가능해진다.
     */
    const panel = read('frontend/src/components/OrderStepsPanel.tsx');
    expect(panel).toMatch(/filter\(f => f\.kind !== 'chat'\)\.map\(f => f\.kind as EvidenceKind\)/);
    expect(panel).toMatch(/st\.files\.filter\(f => f\.kind !== 'chat'\)\.map/);
  });

  it('🔴 타입이 사실을 감추지 않는다 — 파일 종류에는 chat 도 온다', () => {
    expect(read('frontend/src/api/steps.ts')).toMatch(/kind: EvidenceKind \| 'chat'/);
  });
});
