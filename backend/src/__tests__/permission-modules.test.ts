/**
 * 권한 모듈이 **실제로 지켜지는지** — 등록만 하고 검사를 안 붙이면 토글이 죽는다.
 * 예전에 view.all·subsidy.manage 가 그 상태였다(켜고 꺼도 아무 일 없음).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROUTES = path.resolve(__dirname, '../routes');
const src = readdirSync(ROUTES)
  .filter(f => f.endsWith('.ts'))
  .map(f => readFileSync(path.join(ROUTES, f), 'utf8'))
  .join('\n');

/** DB(feature_module)에 넣은 코드 — 화면 토글로 노출되는 것 전부 */
const MODULES = [
  // 'quote.delete' 는 뺐다 — 견적 삭제 기능을 없앴다(2026-08-18).
  // 계약·서명본까지 연쇄로 지워서, 권한으로 열고 닫을 일이 아니라 아예 막았다.
  // DB 의 feature_module 행은 그대로 두었다(기존 DB 를 건드리지 않는다).
  'quote.create', 'quote.confirm', 'quote.edit',
  'doc.send.email', 'doc.send.sign',
  'order.confirm', 'order.view', 'order.control', 'doc.view',
  'stats.own', 'stats.all', 'basedata.manage', 'account.manage',
];

describe('권한 모듈', () => {
  it('모든 모듈이 라우트에서 실제로 검사된다', () => {
    const dead = MODULES.filter(m => !src.includes(`'${m}'`));
    expect(dead, `검사되지 않는 모듈(토글이 죽어 있음): ${dead.join(', ')}`).toEqual([]);
  });

  it('되돌릴 수 없는 동작에는 권한 검사가 붙어 있다', () => {
    // 발송은 취소가 안 되거나 과금된다 — rbac 만으로 두면 안 된다
    expect(src).toContain("requirePermission('doc.send.sign')");
    expect(src).toContain("requirePermission('basedata.manage')");
  });

  /**
   * 삭제는 **권한으로 여닫는 대상이 아니라 아예 없는 기능**이다.
   *
   * 2026-08-18, 실계약이 서명 요청 중일 때 없앴다. 견적 삭제는 연결된 계약과 서명본 PDF,
   * 주문·서류까지 연쇄로 지웠고, 계정 강제삭제는 그 영업의 견적을 통째로 지우면서
   * 계약 상태를 보지도 않았다. 되돌릴 방법이 없다.
   *
   * 이 테스트가 지키는 것: 누군가 「편의를 위해」 되살리면 여기서 걸린다.
   */
  it('삭제 기능은 되살아나지 않는다', () => {
    // 견적 삭제 라우트는 남아 있지만 언제나 거절한다(옛 화면에 이유를 알려주기 위해)
    expect(src, '견적 삭제가 되살아났습니다').toContain("code: 'DELETE_DISABLED'");
    // 실제로 행을 지우는 호출이 라우트에 있으면 안 된다
    expect(src.includes('tx.quote.delete('), '견적을 지우는 코드가 되살아났습니다').toBe(false);
    expect(src.includes('tx.purchaseContract.deleteMany('), '계약을 지우는 코드가 되살아났습니다').toBe(false);
    expect(src.includes('tx.order.delete('), '주문을 지우는 코드가 되살아났습니다').toBe(false);
  });
});
