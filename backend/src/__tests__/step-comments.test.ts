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

describe('대화 탭 — 시간순 한 줄', () => {
  it('🔴 전체 조회는 시간순이다 — 이력은 시간을 따라 읽는다', () => {
    const svc = read('backend/src/services/step-comments.ts');
    const fn = svc.slice(svc.indexOf('export async function listAllComments'));
    expect(fn.slice(0, 400)).toMatch(/orderBy:\s*\{\s*id:\s*'asc'\s*\}/);
  });

  it('🔴 전체 조회는 읽음 처리를 하지 않는다 — 빨간 점은 그 단계를 열어야 꺼진다', () => {
    const routes = read('backend/src/routes/steps.ts');
    const i = routes.indexOf("stepsRouter.get('/:id/step-comments'");
    const handler = routes.slice(i, routes.indexOf('}));', i));
    expect(handler).not.toMatch(/markRead\(/);
  });

  it('쓸 때 고를 단계 목록을 함께 준다 — 화면이 코드를 짐작하지 않게', () => {
    const routes = read('backend/src/routes/steps.ts');
    const i = routes.indexOf("stepsRouter.get('/:id/step-comments'");
    expect(routes.slice(i, routes.indexOf('}));', i))).toMatch(/steps:\s*defs\.map/);
  });

  it('🔴 대화 탭에서 쓴 글도 같은 테이블·같은 step_code 로 들어간다', () => {
    const tab = read('frontend/src/components/OrderChatTab.tsx');
    const drawer = read('frontend/src/components/StepChat.tsx');
    // 둘 다 같은 postComment(orderId, stepCode, body) 를 쓴다 — 저장 경로가 하나여야
    // 대화 탭에서 남긴 글이 그 단계의 창에도 뜬다
    expect(tab).toMatch(/postComment\(orderId, step, body, image\)/);
    expect(drawer).toMatch(/postComment\(orderId, stepCode, body, image\)/);
  });
});

describe('채팅은 한 화면에 다 들어온다', () => {
  it('🔴 바깥까지 스크롤시키는 scrollIntoView 를 쓰지 않는다', () => {
    /*
     * scrollIntoView 는 **조상 스크롤 컨테이너까지** 움직인다. 실제로 그 탓에
     * 주문 제목과 「← 배정 주문」 버튼이 화면 밖으로 밀려났다. 목록 자신만 내린다.
     */
    for (const f of ['frontend/src/components/OrderChatTab.tsx',
                     'frontend/src/components/StepChat.tsx']) {
      const src = codeOnly(read(f));
      expect(src, `${f}`).not.toMatch(/scrollIntoView/);
      expect(src, `${f}`).toMatch(/scrollTop = .*scrollHeight/);
    }
  });

  it('🔴 대화 탭은 남은 화면 높이에 맞춘다 — vh 가 아니라 innerHeight 로', () => {
    const tab = read('frontend/src/components/OrderChatTab.tsx');
    // 모바일 주소창이 접혔다 펴지면 실제 높이가 달라진다 — vh 는 그걸 안 따라간다
    expect(tab).toMatch(/window\.innerHeight/);
    expect(tab).toMatch(/addEventListener\('resize'/);
  });

  it('🔴 서랍이 열려 있는 동안 뒤 화면이 스크롤되지 않는다', () => {
    const drawer = read('frontend/src/components/StepChat.tsx');
    expect(drawer).toMatch(/document\.body\.style\.overflow = 'hidden'/);
    // 닫을 때 반드시 되돌린다 — 안 되돌리면 앱 전체가 굳는다
    expect(drawer).toMatch(/document\.body\.style\.overflow = prev/);
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
