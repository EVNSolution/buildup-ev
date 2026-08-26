import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **일반구매자에게 「부가세 환급 시 가격 0 원」이라고 적지 않는다.**
 *
 * 일반구매자(비사업자)는 부가세를 환급받을 수 없다. 계산은 0 으로 맞다.
 * 그런데 견적서에 「0 원」이라고 찍으면 **「가격이 0원」으로 읽힌다**(실제 제보).
 * 금액이 아니라 «해당 없음»이라고 적어야 뜻이 통한다.
 *
 * 특장 열에서 0원 줄을 뺀 것과 같은 부류다 — **0 은 「없다」가 아니라 「공짜」로 읽힌다.**
 */
const PDF = readFileSync(path.resolve(__dirname, '../services/quote-pdf.ts'), 'utf8');

describe('부가세 환급 표기', () => {
  it('🔴 환급 대상이 아니면 금액이 아니라 「해당 없음」', () => {
    expect(PDF).toMatch(/vatRefundPrice: noVatRefund \? '해당 없음' : won\(r\.vat_refund_price\)/);
  });

  it('판정은 계산이 쓰는 값 그대로 — 화면에서 다시 따지지 않는다', () => {
    // 조건을 여기서 새로 쓰면 계산과 표기가 갈린다
    expect(PDF).toMatch(/const noVatRefund = params\.no_vat_refund === true/);
  });
});
