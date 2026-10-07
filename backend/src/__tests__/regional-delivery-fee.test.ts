import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **subsidy_local 의 `extra` 열은 지방보조금이 아니라 「지역별 추가 탁송료」다.**
 *
 * 최종 차량 인수 때 지역에 따라 더 드는 탁송료로, 차량 탁송료(tax_config.delivery_fee)와 별개다.
 * 그런데 비로그인 공개 컨피규레이터가 이 값을 지방보조금에 더해 보여 줬다
 * (예: 강원 강릉시 공개 화면 5,180,000 / 영업 견적 4,600,000).
 * 영업 견적·견적서는 amount 만 쓴다. 공개 화면도 같아야 한다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('지역별 추가 탁송료(subsidy_local.extra)', () => {
  it('공개 화면의 지방보조금에 더하지 않는다', () => {
    const src = read('frontend/src/api/public.ts');
    const fn = src.slice(src.indexOf('export async function fetchPublicLocalSubsidy'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toMatch(/return d \? d\.amount : 0/);
    expect(body).not.toMatch(/d\.(extra|regional_delivery_fee)/);
  });

  it('DB 열 이름은 extra 그대로 두고 코드에서만 이름을 바꾼다', () => {
    const schema = read('backend/prisma/schema.prisma');
    expect(schema).toMatch(/regional_delivery_fee\s+Int\?\s+@map\("extra"\)/);
  });
});
