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
  'quote.create', 'quote.confirm', 'quote.edit', 'quote.delete',
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
    // 삭제·발송은 취소가 안 되거나 과금된다 — rbac 만으로 두면 안 된다
    expect(src).toContain("requirePermission('quote.delete')");
    expect(src).toContain("requirePermission('doc.send.sign')");
    expect(src).toContain("requirePermission('basedata.manage')");
  });
});
