/**
 * 저장된 견적의 실구매가를 지금 기준으로 다시 계산한다.
 *
 * 계산 규칙이 바뀌면(예: 부가세 환급 기준 변경) 이미 저장된 final_price 는 옛 값으로
 * 남는다. 목록은 저장값을, 견적서 PDF 는 그때그때 계산한 값을 보여주므로 둘이 어긋난다.
 *
 * ⚠️ 서류가 고정된 견적(전자서명 발송)은 건드리지 않는다 — 고객이 받은 문서와
 *    금액이 달라지면 안 된다.
 *
 * 실행: npx tsx src/scripts/recalc-quotes.ts [--apply]
 *       기본은 미리보기(무엇이 얼마나 바뀌는지만 출력). --apply 를 줘야 저장한다.
 */
// ⚠️ 맨 먼저 — config 가 릴리스 루트 .env 를 읽어 process.env 에 넣는다.
//    이걸 거치지 않으면 DATABASE_URL 이 없어 prisma 가 null 이 된다.
import '../config.js';
import { prisma } from '../lib/prisma.js';
import { buildQuoteParams } from '../services/quote-calc.js';
import { calcQuote } from '@buildup-ev/shared/pricing';

const apply = process.argv.includes('--apply');
const won = (n: number | null) => (n == null ? '—' : '₩' + n.toLocaleString('ko-KR'));

if (!prisma) { console.error('DB 연결 필요'); process.exit(1); }

const quotes = await prisma.quote.findMany({
  where: { docs_frozen_at: null },
  orderBy: { id: 'asc' },
  include: { customer: true },
});

let changed = 0;
for (const q of quotes) {
  const inp = (q.inputs ?? {}) as Record<string, unknown>;
  try {
    const params = await buildQuoteParams(
      q.model_code, (q.selections ?? {}) as Record<string, string>,
      {
        biz_type: inp['biz_type'] as string | undefined,
        is_sosang: inp['is_sosang'] as boolean | undefined,
        region: inp['region'] as string | undefined,
        has_transport_license: inp['has_transport_license'] as boolean | undefined,
        diesel_status: inp['diesel_status'] as string | undefined,
        diesel_conversion: inp['diesel_conversion'] as boolean | undefined,
        has_biz_plate: inp['has_biz_plate'] as boolean | undefined,
        tax_exempt_type: inp['tax_exempt_type'] as string | undefined,
      },
      {
        down_payment_rate: inp['down_payment_rate'] as number | undefined,
        installment_months: inp['installment_months'] as number | undefined,
        promotion_zeroed: inp['promotion_zeroed'] as string[] | undefined,
    promotion_discount: inp['promotion_discount'] as number | undefined,
    // 특장만 견적 — 저장 시점의 선택을 그대로 따라야 금액이 재현된다
    body_only: inp['body_only'] === true,
        local_subsidy_off: inp['local_subsidy_off'] as boolean | undefined,
        // 직접 입력한 차량 가격 — 빠지면 재계산이 트림 단가로 되돌린다
        car_price_override: inp['car_price_override'] != null
          ? (inp['car_price_override'] as number) : null,
      },
      q.created_at.getFullYear(),
    );
    const next = calcQuote(params).real_price;
    if (next === q.final_price) continue;
    changed += 1;
    console.log(`  ${q.quote_no ?? '#' + q.id}  ${q.customer?.name ?? '-'}  ${won(q.final_price)} -> ${won(next)}`);
    if (apply) await prisma.quote.update({ where: { id: q.id }, data: { final_price: next } });
  } catch (e) {
    console.error(`  ${q.quote_no ?? '#' + q.id} 계산 실패:`, e instanceof Error ? e.message : e);
  }
}

const frozen = await prisma.quote.count({ where: { docs_frozen_at: { not: null } } });
console.log(`\n대상 ${quotes.length}건 · 변경 ${changed}건${apply ? ' (저장함)' : ' (미리보기 — 저장하려면 --apply)'}`);
if (frozen) console.log(`서류 고정 ${frozen}건은 건드리지 않음`);
process.exit(0);
