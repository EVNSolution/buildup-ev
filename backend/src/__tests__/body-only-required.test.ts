import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **화면에서 감춘 칸을 필수로 두지 않았는가.**
 *
 * 특장만 견적에는 보조금이 없어서 보조금 조건 칸을 통째로 감춘다. 그런데 필수 목록에는
 * 그대로 남겨 두면, 채울 수 없는 값을 요구하는 셈이 되어 **버튼이 영영 안 열린다.**
 * 사용자에게는 「다 채웠는데 저장이 안 된다」로 보인다 — 실제로 두 번 났다:
 *   · 공개 창구: 법인에게 지역을 요구해 상담 신청이 통째로 막혔다
 *   · 영업 화면: 특장만 견적에서 보조금 조건 넷을 요구해 견적 저장이 막혔다
 *
 * 계산도 화면도 멀쩡해 보여서 눈으로는 잘 안 걸린다. 그래서 **감추는 조건과 요구하는
 * 조건이 같은 깃발(`bodyOnly`)을 보는지**를 소스에서 못박는다.
 *
 * (프론트에 테스트 러너가 없어 여기서 소스를 읽는다 — visibility.test.ts 와 같은 방식)
 */
const FRONT = path.resolve(__dirname, '../../../frontend/src');

/** 보조금 조건 — 특장만 견적에는 이 칸들이 없다. 필수 목록에 남아 있으면 안 된다. */
const SUBSIDY_LABELS = ['경유차 폐차여부', '소상공인', '화물자동차 운송사업허가증'];

/** 필수 판정이 사는 파일들 — 감추는 화면과 짝이다. */
const GATES = [
  'components/QuoteSaveModal.tsx',   // 영업: 견적 저장 · 고객정보 수정 · 계약서 확인
  'components/InquiryModal.tsx',     // 공개 창구: 상담 신청
];

/**
 * 보조금 라벨이 들어 있는 줄이 **`bodyOnly` 가지 안에** 있어야 한다.
 *
 * 정확한 구문 분석 대신, 라벨이 나오는 지점 앞쪽에 `bodyOnly ? [] :` 형태의 가지가
 * 열려 있는지 본다. 완벽한 검사는 아니지만 **깃발을 아예 안 보는 경우**는 확실히 잡는다.
 */
function guardedByBodyOnly(src: string, label: string): boolean {
  const at = src.indexOf(`'${label}'`);
  if (at < 0) return true;   // 그 라벨을 안 쓰면 검사할 것도 없다
  // 그 줄 위쪽 40줄 안에서 특장만 분기가 열렸는지
  const before = src.slice(0, at).split('\n').slice(-40).join('\n');
  return /bodyOnly\s*\?\s*\[\]\s*:/.test(before);
}

describe('특장만 견적 — 감춘 칸을 필수로 두지 않는다', () => {
  for (const rel of GATES) {
    const src = readFileSync(path.join(FRONT, rel), 'utf8');

    it(`${rel} — 보조금 조건은 특장만 분기 안에 있다`, () => {
      for (const label of SUBSIDY_LABELS) {
        expect(guardedByBodyOnly(src, label), `${rel} 의 「${label}」`).toBe(true);
      }
    });

    it(`${rel} — 필수 판정이 bodyOnly 를 읽는다`, () => {
      expect(src).toMatch(/bodyOnly/);
    });
  }

  it('감추는 곳과 요구하는 곳이 같은 파일에 있다 — 갈라지면 또 어긋난다', () => {
    // QuoteCustomerForm(감춤)과 missingBase(요구)가 한 파일에 있어야 짝이 눈에 보인다
    const src = readFileSync(path.join(FRONT, 'components/QuoteSaveModal.tsx'), 'utf8');
    expect(src).toMatch(/function QuoteCustomerForm/);
    expect(src).toMatch(/function missingBase/);
  });
});
