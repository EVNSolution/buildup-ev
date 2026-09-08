/**
 * 영업 백엔드 신규 API 통합 테스트 (DB 필요 — DATABASE_URL 없으면 skip)
 *
 * GET  /models/:code/pricing-bundle
 * GET  /subsidy/local?region=…
 * POST /quotes  (재계산+저장)
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { authCookie, authFixtureReady, ensureFixtureUsers } from './helpers.js';

const shouldSkip = !process.env['DATABASE_URL'];
/* seed 계정이 없는 DB 에서는 인증이 막혀 전부 403 이 된다 — 제품이 아니라 준비의 문제다 */
const AUTH_OK = await authFixtureReady('sales1@evnsolution.com');
const SALES_COOKIE = authCookie('sales1@evnsolution.com', 'SALES', 'ORG_HQ');

const REEFER_SELECTIONS = {
  TRIM: 'TRIM_PLUS',
  BODYTYPE: 'BODY_REEFER',
  TOP: 'TOP_LOW',
  DOORTYPE: 'DOOR_SLIDE',
  DOORADD: 'ADD_NONE',
  TEMP: 'TEMP_O',
  PARTITION: 'PART_NET',
};
const CUSTOMER = { biz_type: 'individual', is_sosang: true, region: '경기 남양주시' };

describe.skipIf(shouldSkip || !AUTH_OK)('GET /api/v1/models/:code/pricing-bundle', () => {
  const app = createApp();

  it('PV5_OPENBED — groups·rules·option_prices·door·tax·subsidy_national 포함', async () => {
    const res = await request(app)
      .get('/api/v1/models/PV5_OPENBED/pricing-bundle')
      .set('Cookie', SALES_COOKIE)
      .expect(200);

    const { data } = res.body;
    expect(Array.isArray(data.groups)).toBe(true);
    expect(data.groups.length).toBeGreaterThanOrEqual(8);
    expect(Array.isArray(data.rules)).toBe(true);
    expect(data.rules.length).toBeGreaterThanOrEqual(2);
    expect(typeof data.option_prices['TRIM_PLUS']).toBe('number');
    expect(data.option_prices['TRIM_PLUS']).toBe(45_136_364);
    expect(typeof data.tax.acq_tax_rate).toBe('number');
    expect(data.subsidy_national.amount).toBe(11_500_000);
    expect(Number(data.subsidy_national.sosang_rate)).toBeCloseTo(0.3);
  });

  it('존재하지 않는 차종 → 404', async () => {
    await request(app)
      .get('/api/v1/models/UNKNOWN/pricing-bundle')
      .set('Cookie', SALES_COOKIE)
      .expect(404);
  });

  it('인증 없음 → 403', async () => {
    await request(app).get('/api/v1/models/PV5_OPENBED/pricing-bundle').expect(403);
  });
});

describe.skipIf(shouldSkip || !AUTH_OK)('GET /api/v1/subsidy/local', () => {
  const app = createApp();

  it('경기 남양주시 2026 → amount=3450000', async () => {
    const res = await request(app)
      .get('/api/v1/subsidy/local?region=경기 남양주시&year=2026')
      .set('Cookie', SALES_COOKIE)
      .expect(200);

    expect(res.body.data.amount).toBe(3_450_000);
    expect(res.body.data.region).toBe('경기 남양주시');
  });

  it('없는 지역 → data: null', async () => {
    const res = await request(app)
      .get('/api/v1/subsidy/local?region=없는지역시')
      .set('Cookie', SALES_COOKIE)
      .expect(200);

    expect(res.body.data).toBeNull();
  });

  it('region 없음 → 400', async () => {
    await request(app)
      .get('/api/v1/subsidy/local')
      .set('Cookie', SALES_COOKIE)
      .expect(400);
  });
});

describe.skipIf(shouldSkip || !AUTH_OK)('POST /api/v1/quotes', () => {
  const app = createApp();

  /*
   * ⚠️ 여기 있던 `real_price = 46,471,818` 못박기를 **바꿔 썼다.**
   *
   *    그 숫자는 이 라우트가 처음 생기던 때(67b3f33)의 **단가표와 옵션코드 체계**에서 나온
   *    값이다. 그 뒤 단가는 견적서 Ver1.21 에 맞춰 재구성됐고(옵션코드 이름까지 바뀌었다),
   *    등록비 항목도 달라졌다(증지대 2,500→2,000 · 번호판 25,000→28,000 ·
   *    등록대행 50,000→30,000 · 탁송료 179,000→188,000). 단가는 **바뀌라고 DB 에 둔 값**이라
   *    (CLAUDE.md: 자주 바뀌는 값은 하드코딩 금지) 관리자가 한 번 고칠 때마다 이 검사가 빨개진다.
   *    그렇게 빨간불이 일상이 되면 **진짜 회귀가 섞여도 아무도 모른다.**
   *
   *    엔진이 엑셀과 맞는지는 `shared/pricing` 이 **얼어붙은 픽스처**로 지킨다
   *    (범석환 ₩32,013,860 · 총견적서 케이스 — 입력까지 고정이라 단가가 바뀌어도 흔들리지 않는다).
   *    여기서 지킬 것은 그게 아니라 **이 길이 그 엔진과 같은 답을 내는가**다:
   *    옵션이 제대로 조회됐는지, 도어 규칙이 맞는지, 빠진 비용이 없는지.
   */
  it('냉동 옵션 → 201 + 값들이 서로 들어맞는다', { timeout: 15_000 }, async () => {
    const res = await request(app)
      .post('/api/v1/quotes')
      .set('Cookie', SALES_COOKIE)
      .send({ model_code: 'PV5_OPENBED', year: 2026, selections: REEFER_SELECTIONS, customer: CUSTOMER })
      .expect(201);

    expect(res.body.data.quote_id).toBeGreaterThan(0);
    const p = res.body.data.pricing;
    expect(p.status).toBe('ok');

    // ── 공급가 = 트림 + 탑 + 도어차액 + 온도기록계 + 격벽 (DB 단가 그대로)
    const { prisma } = await import('../lib/prisma.js');
    const rows = await prisma!.optionPrice.findMany({ where: { model_code: 'PV5_OPENBED' } });
    const price = (c: string) => {
      const r = rows.find(x => x.value_code === c);
      expect(r, `단가가 없다: ${c}`).toBeTruthy();
      return Number(r!.supply_price);
    };
    /*
     * 도어가 = (선택종류 단품 − 기본종류[여닫이] 단품) — CLAUDE.md 에 적힌 규칙이다.
     * 코드를 베끼는 게 아니라 **규칙을 적는다**(그래야 코드가 틀렸을 때 잡힌다).
     */
    const doorDelta = price('DOPT_REEFER_LOW_SLIDE');
    const expectedSupply =
      price('TRIM_PLUS') + price('TOP_REEFER_LOW') + doorDelta + price('TEMP_O') + price('PART_LOW_NET');
    expect(p.supply_price, '공급가가 단가 합과 다르다').toBe(expectedSupply);

    // ── 그 위의 셈이 서로 들어맞는가
    expect(p.vat).toBe(Math.round(p.supply_price * 0.1));
    expect(p.vehicle_price).toBe(p.supply_price + p.vat);
    expect(p.subsidy_total).toBe(
      p.subsidy_national + p.subsidy_local + p.subsidy_sosang + p.subsidy_takbae + p.subsidy_diesel);
    expect(p.applied_price).toBe(p.vehicle_price - p.subsidy_total);
    // 부가세 환급 뒤 = 공급가 − 보조금 (부가세가 그대로 빠진다)
    expect(p.vat_refunded_price).toBe(p.supply_price - p.subsidy_total);
    expect(p.real_price, '실구매가가 구성요소 합과 다르다')
      .toBe(p.vat_refunded_price + p.reg_cost + p.etc_cost);
    // 빠진 비용이 없는가 — 하나라도 0 이면 어딘가에서 조용히 사라진 것이다
    for (const k of ['reg_acq_tax', 'reg_stamp', 'reg_plate', 'reg_agency', 'delivery_fee', 'etc_fee']) {
      expect(p[k], `${k} 가 비어 있다`).toBeGreaterThan(0);
    }
  });

  /*
   * ⚠️ 여기 있던 「BODY_DRY → 422 unsupported(TBD)」를 바꿔 썼다.
   *    일반탑(DRY)은 그때 단가가 없어 저장을 거부했는데, **지금은 단가가 있다**
   *    (TOP_DRY_LOW · TOP_DRY_STD). 없어진 상태를 검사하는 시험은 통과할 수 없다.
   *    지우지 않고, 지금 지켜야 할 것 — **DRY 도 제대로 값이 매겨지는가** — 로 바꾼다.
   */
  it('일반탑(DRY)도 값이 매겨진다 — 냉동보다 싸다', async () => {
    const res = await request(app)
      .post('/api/v1/quotes')
      .set('Cookie', SALES_COOKIE)
      .send({
        model_code: 'PV5_OPENBED',
        year: 2026,
        selections: { ...REEFER_SELECTIONS, BODYTYPE: 'BODY_DRY' },
        customer: CUSTOMER,
      })
      .expect(201);

    const p = res.body.data.pricing;
    expect(p.status).toBe('ok');
    const { prisma } = await import('../lib/prisma.js');
    const rows = await prisma!.optionPrice.findMany({ where: { model_code: 'PV5_OPENBED' } });
    const price = (c: string) => Number(rows.find(x => x.value_code === c)?.supply_price ?? NaN);
    // 탑만 DRY 로 바뀐다 — 나머지 선택은 그대로다
    expect(p.supply_price).toBe(
      price('TRIM_PLUS') + price('TOP_DRY_LOW') + price('DOPT_DRY_LOW_SLIDE')
      + price('TEMP_O') + price('PART_LOW_NET'));
    expect(price('TOP_DRY_LOW'), '일반탑이 냉동탑보다 비싸다').toBeLessThan(price('TOP_REEFER_LOW'));
  });

  it('필수 파라미터 누락 → 400', async () => {
    await request(app)
      .post('/api/v1/quotes')
      .set('Cookie', SALES_COOKIE)
      .send({ model_code: 'PV5_OPENBED' })
      .expect(400);
  });

  it('인증 없음 → 403', async () => {
    await request(app).post('/api/v1/quotes').send({}).expect(403);
  });
});
