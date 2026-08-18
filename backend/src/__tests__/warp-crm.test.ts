/**
 * WARP CRM 연동 — 변환·클라이언트·라우트 테스트 (DB 불필요, fetch 는 mock).
 *
 * ⚠️ 이 연동은 **부가 기능**이다. 어떤 실패(미설정·다운·타임아웃·키 불일치)도
 *    견적 입력을 막으면 안 된다 — 전부 null 로 끝나는지가 핵심 검증이다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { authCookie } from './helpers.js';
import {
  digitsOnly, isWarpConfigured, lookupWarpCustomer,
  toAutofillHit, toBirthRegno, toBizRegno, type WarpCustomerDto,
} from '../services/warp-crm.js';

const SALES_COOKIE = authCookie('sales1@evnsolution.com', 'SALES', 'ORG_HQ');
const MAKER_COOKIE = authCookie('maker1@example.com', 'MAKER', 'ORG_MK1');

function warpCustomer(over: Partial<WarpCustomerDto> = {}): WarpCustomerDto {
  return {
    name: '홍길동', phone: '010-1234-5678', email: 'hong@example.com', customerSegment: 'B2C',
    birthInfo: '1990.01.02', birthYear: 1990, regionCity: '경기', regionDist: '남양주시',
    addressDetail: '다산동 123', isSoleProprietor: true, soleBusinessName: '길동상사',
    soleBusinessNo: '123-45-67890', soleBusinessType: '운수업',
    companyName: null, businessRegNo: null, companyAddress: null, companyPhone: '02-555-1234',
    hasVehicle: true, vehicleMaker: '현대', vehicleName: '포터EV', vehiclePlateNo: '12가3456',
    vehicleYear: '2023', truckType1: '카고', truckType2: null, truckType3: null, truckType4: null,
    ...over,
  };
}

beforeEach(() => {
  vi.stubEnv('WARP_API_BASE_URL', 'http://warp.test');
  vi.stubEnv('WARP_API_KEY', 'k'.repeat(64));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('변환 (toBirthRegno / toBizRegno / toAutofillHit)', () => {
  it('생년월일은 숫자 8자리일 때만 YYYY-MM-DD, 아니면 버린다', () => {
    expect(toBirthRegno('1990.01.02')).toBe('1990-01-02');
    expect(toBirthRegno('19900102')).toBe('1990-01-02');
    expect(toBirthRegno('900102')).toBeNull();       // 6자리 — 세기를 추측하지 않는다
    expect(toBirthRegno('900102-1234567')).toBeNull(); // 주민번호 13자리
    expect(toBirthRegno(null)).toBeNull();
  });

  it('사업자번호는 숫자 10자리일 때만 000-00-00000', () => {
    expect(toBizRegno('123-45-67890')).toBe('123-45-67890');
    expect(toBizRegno('1234567890')).toBe('123-45-67890');
    expect(toBizRegno('12345')).toBeNull();
    expect(toBizRegno(null)).toBeNull();
  });

  it('법인 businessRegNo 가 개인사업자 soleBusinessNo 보다 우선한다', () => {
    const hit = toAutofillHit(warpCustomer({ businessRegNo: '999-88-77777' }), 1);
    expect(hit.biz_regno).toBe('999-88-77777');
    expect(toAutofillHit(warpCustomer(), 1).biz_regno).toBe('123-45-67890');
  });

  it('B2C 주소는 지역(시/구), B2B 는 회사주소 우선', () => {
    expect(toAutofillHit(warpCustomer(), 1).address).toBe('경기 남양주시');
    const b2b = toAutofillHit(warpCustomer({ customerSegment: 'B2B', companyAddress: '서울 강남구 테헤란로 1' }), 1);
    expect(b2b.address).toBe('서울 강남구 테헤란로 1');
    expect(b2b.ceo_name).toBe('홍길동');           // B2B 만 대표이사 후보를 준다
    expect(toAutofillHit(warpCustomer(), 1).ceo_name).toBeNull();
  });

  it('차량은 표시 전용 배열로 — truck_types 는 빈 값을 걸러 담는다', () => {
    const hit = toAutofillHit(warpCustomer(), 1);
    expect(hit.vehicles).toEqual([{
      maker: '현대', name: '포터EV', plate_no: '12가3456', year: '2023', truck_types: ['카고'],
    }]);
    expect(toAutofillHit(warpCustomer({ hasVehicle: null, vehicleMaker: null, vehicleName: null, vehiclePlateNo: null }), 1).vehicles).toEqual([]);
    expect(toAutofillHit(warpCustomer(), 3).match_count).toBe(3);
  });
});

describe('lookupWarpCustomer — 실패는 전부 null (견적 입력을 막지 않는다)', () => {
  it('env 미설정이면 fetch 없이 null', async () => {
    vi.stubEnv('WARP_API_BASE_URL', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(isWarpConfigured()).toBe(false);
    expect(await lookupWarpCustomer('홍길동', '010-1234-5678')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('매칭되면 자동 기입 값으로 변환한다 (전화는 숫자만 보낸다)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      matched: true, matchCount: 2, customer: warpCustomer(),
    })));
    vi.stubGlobal('fetch', fetchSpy);
    const hit = await lookupWarpCustomer('홍길동', '010-1234-5678');
    expect(hit?.email).toBe('hong@example.com');
    expect(hit?.birth_regno).toBe('1990-01-02');
    expect(hit?.match_count).toBe(2);
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toContain('http://warp.test/api/external/customer-lookup?');
    expect(url).toContain('phone=01012345678');
    expect(digitsOnly('010-1234-5678')).toBe('01012345678');
  });

  it('미매칭 → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ matched: false }))));
    expect(await lookupWarpCustomer('홍길동', '010-1234-5678')).toBeNull();
  });

  it('비200 응답 → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));
    expect(await lookupWarpCustomer('홍길동', '010-1234-5678')).toBeNull();
  });

  it('네트워크 오류·타임아웃 → null (throw 하지 않는다)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')));
    await expect(lookupWarpCustomer('홍길동', '010-1234-5678')).resolves.toBeNull();
  });

  it('이름 없음·전화 9자리 미만이면 조회하지 않는다', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await lookupWarpCustomer('', '010-1234-5678')).toBeNull();
    expect(await lookupWarpCustomer('홍길동', '1234')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/customers/warp-lookup', () => {
  const app = createApp();

  it('미로그인 → 403 / MAKER → 403 (rbac SALES·ADMIN)', async () => {
    await request(app).get('/api/v1/customers/warp-lookup?name=홍길동&phone=01012345678').expect(403);
    await request(app)
      .get('/api/v1/customers/warp-lookup?name=홍길동&phone=01012345678')
      .set('Cookie', MAKER_COOKIE)
      .expect(403);
  });

  it('입력 미비 → 400', async () => {
    await request(app)
      .get('/api/v1/customers/warp-lookup?phone=01012345678')
      .set('Cookie', SALES_COOKIE)
      .expect(400);
    await request(app)
      .get('/api/v1/customers/warp-lookup?name=홍길동&phone=1234')
      .set('Cookie', SALES_COOKIE)
      .expect(400);
  });

  it('매칭 → 200 { data: hit }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      matched: true, matchCount: 1, customer: warpCustomer(),
    }))));
    const res = await request(app)
      .get('/api/v1/customers/warp-lookup?name=홍길동&phone=010-1234-5678')
      .set('Cookie', SALES_COOKIE)
      .expect(200);
    expect(res.body.data.email).toBe('hong@example.com');
    expect(res.body.data.vehicles).toHaveLength(1);
  });

  it('WARP 미설정·오류여도 200 { data: null } — 절대 5xx 로 견적 입력을 막지 않는다', async () => {
    vi.stubEnv('WARP_API_KEY', '');
    const res = await request(app)
      .get('/api/v1/customers/warp-lookup?name=홍길동&phone=01012345678')
      .set('Cookie', SALES_COOKIE)
      .expect(200);
    expect(res.body.data).toBeNull();
  });
});
