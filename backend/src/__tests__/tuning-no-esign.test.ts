import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **튜닝은 전자서명을 쓰지 않는다** — 종이로 받아 스캔해 올린다.
 *
 *   튜닝신청서 업로드 → 서명본 업로드 → 승인서 수령
 *
 * 전자서명 코드는 **지우지 않았다**(나중에 켤 수 있게). 대신 입구를 막았다.
 * 여기서 지키는 것은 두 가지다:
 *   ① 발송이 실수로도 나가지 않을 것 — **건당 과금되고 되돌릴 수 없다**
 *   ② 서명본 확인 게이트가 되살아나지 않을 것 — 파일을 올려도 완료가 영영 막힌다
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('튜닝 전자서명은 꺼져 있다', () => {
  it('발송 입구가 막혀 있다', () => {
    const route = read('backend/src/routes/tuning.ts');
    expect(route).toMatch(/FEATURE_OFF/);
    // 막아 둔 자리에서 실제 발송 함수를 부르면 안 된다
    const send = route.slice(route.indexOf("tuningRouter.post('/:id/tuning/send'"));
    expect(send.slice(0, 400), '막아 둔 라우트가 아직 발송을 부른다')
      .not.toMatch(/sendTuningApplication\(/);
  });

  it('완료 게이트에 서명본 확인이 없다', () => {
    // 남겨 두면 서명본 파일을 올려도 「서명본 업로드」가 완료되지 않는다
    const steps = read('backend/src/routes/steps.ts');
    expect(steps).not.toMatch(/isTuningSignedAndFetched/);
  });

  it('화면에 전자서명 요청 버튼이 없다', () => {
    const panel = read('frontend/src/components/OrderStepsPanel.tsx');
    expect(panel).not.toMatch(/전자서명 요청/);
    expect(panel).not.toMatch(/sendTuning\(/);
  });

  it('나중에 되살릴 수 있게 코드는 남아 있다', () => {
    // 「지우지 말고 꺼 둔다」가 이 변경의 전제다 — 서비스가 사라지면 되살릴 수 없다
    expect(() => read('backend/src/services/tuning-esign.ts')).not.toThrow();
    expect(read('backend/src/routes/tuning.ts')).toMatch(/되살린다|되살릴/);
  });
});
