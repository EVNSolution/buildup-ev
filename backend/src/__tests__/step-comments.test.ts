import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 단계별 대화 — **이력이 목적이다.**
 *
 * 「그때 무슨 이야기가 오갔나」가 나중에 납기 지연·사양 변경의 근거가 된다.
 * 고치거나 지우는 길이 생기면 그 근거가 무너진다. 여기서 그 길을 막는다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('이력은 지워지지 않는다', () => {
  it('🔴 댓글을 고치거나 지우는 API 가 없다', () => {
    const routes = codeOnly(read('backend/src/routes/steps.ts'));
    const svc = codeOnly(read('backend/src/services/step-comments.ts'));
    // 라우트에 PATCH/PUT/DELETE 로 열린 댓글 경로가 없어야 한다
    for (const m of routes.matchAll(/stepsRouter\.(patch|put|delete)\(\s*'([^']+)'/g)) {
      expect(m[2], `${m[1]} ${m[2]} — 댓글은 고치거나 지울 수 없어야 한다`).not.toMatch(/comment/);
    }
    // 서비스에도 삭제·수정이 없어야 한다
    expect(svc).not.toMatch(/orderStepComment\.(delete|deleteMany|update|updateMany)\(/);
  });

  it('🔴 쓰기는 관리자·특장사만 — 영업은 서버가 막는다', () => {
    const routes = read('backend/src/routes/steps.ts');
    const post = routes.slice(routes.indexOf("stepsRouter.post('/:id/steps/:code/comments'"));
    const line = post.slice(0, 120);
    expect(line).toMatch(/rbac\('ADMIN',\s*'MAKER'\)/);
    expect(line, '영업이 쓰기 권한에 들어가면 안 된다').not.toMatch(/'SALES'/);
  });
});

describe('푸시는 없어도 앱이 돌아간다', () => {
  it('🔴 VAPID 키가 없으면 조용히 꺼진다 — 던지지 않는다', () => {
    const push = read('backend/src/services/push.ts');
    expect(push).toMatch(/pushEnabled\s*=\s*\(\)/);
    // 키 없음은 warn 으로 알리되 예외를 던지지 않는다
    expect(codeOnly(push)).not.toMatch(/throw new Error\('VAPID/);
    expect(push).toMatch(/console\.warn\('\[push\]/);
  });

  it('🔴 비밀키는 밖으로 나가지 않는다', () => {
    const route = codeOnly(read('backend/src/routes/push.ts'));
    expect(route).toMatch(/publicKey\(\)/);
    expect(route, 'VAPID_PRIVATE_KEY 가 응답에 실리면 안 된다').not.toMatch(/PRIVATE/);
  });

  it('🔴 보내기는 기다리지 않는다 — 댓글 작성이 푸시 서버 속도에 묶이면 안 된다', () => {
    const push = codeOnly(read('backend/src/services/push.ts'));
    expect(push).toMatch(/export function notify\(/);   // async 가 아니다
    expect(push).toMatch(/void \(async \(\) =>/);
  });

  it('만료된 구독(404·410)은 지운다 — 남겨 두면 매번 실패한다', () => {
    const push = read('backend/src/services/push.ts');
    expect(push).toMatch(/404 \|\| code === 410/);
  });
});

describe('마이그레이션', () => {
  const sql = read('backend/prisma/migrations/20260902000000_add_step_comments/migration.sql');

  it('🔴 기존 테이블을 건드리지 않는다 — 새 테이블만 만든다', () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/ALTER TABLE/i);
    // `ON DELETE CASCADE` 는 FK 정의라 데이터를 지우는 문장이 아니다 — 실제 삭제문만 본다
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+"/i);
  });

  it('다시 돌려도 안전하다', () => {
    const creates = sql.match(/CREATE (TABLE|UNIQUE INDEX|INDEX)/gi) ?? [];
    const guarded = sql.match(/CREATE (TABLE|UNIQUE INDEX|INDEX)[^(]*IF NOT EXISTS/gi) ?? [];
    expect(guarded.length).toBe(creates.length);
  });
});
