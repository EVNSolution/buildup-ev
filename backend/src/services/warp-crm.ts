/**
 * WARP CRM 고객조회 클라이언트 — 서버 전용 (modusign.ts 패턴).
 *   인증: WARP_API_KEY 를 x-api-key 헤더로. 키·주소는 .env/시크릿에만 — 프론트 노출 금지.
 *
 * ⚠️ **부가 기능이다.** WARP 가 죽거나 키가 틀리거나 타임아웃이 나도 견적 입력을
 *    막으면 안 된다 — 모든 실패는 조용히 null 로 끝난다(로그만 남긴다).
 *    env 미설정이면 fetch 자체를 하지 않는다(기능 꺼짐).
 */

const TIMEOUT_MS = 5_000;

/** 매칭 키·표시에 쓰는 정규화 — 숫자만. */
export function digitsOnly(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '');
}

/** WARP 응답의 customer 필드(화이트리스트 DTO — WARP lib/external-lookup/match.ts 와 동일 계약). */
export interface WarpCustomerDto {
  name: string;
  phone: string | null;
  email: string | null;
  customerSegment: string | null;   // 'B2C' | 'B2B'
  birthInfo: string | null;
  birthYear: number | null;
  regionCity: string | null;
  regionDist: string | null;
  addressDetail: string | null;
  isSoleProprietor: boolean | null;
  soleBusinessName: string | null;
  soleBusinessNo: string | null;
  soleBusinessType: string | null;
  companyName: string | null;
  businessRegNo: string | null;
  companyAddress: string | null;
  companyPhone: string | null;
  hasVehicle: boolean | null;
  vehicleMaker: string | null;
  vehicleName: string | null;
  vehiclePlateNo: string | null;
  vehicleYear: string | null;
  truckType1: string | null;
  truckType2: string | null;
  truckType3: string | null;
  truckType4: string | null;
}

interface WarpLookupResponse {
  matched: boolean;
  matchCount?: number;
  customer?: WarpCustomerDto;
}

/** 차량 참고 정보 — 화면 표시 전용, 견적에 저장하지 않는다. */
export interface WarpVehicleInfo {
  maker: string | null;
  name: string | null;
  plate_no: string | null;
  year: string | null;
  truck_types: string[];
}

/** 견적 폼 자동 기입용 변환 결과. */
export interface WarpAutofillHit {
  /** WARP 에 등록된 고객명 — 안내 배너 표시용(폼에는 채우지 않는다: 매칭 키다). */
  name: string;
  email: string | null;
  /** 생년월일 YYYY-MM-DD — birthInfo 숫자가 정확히 8자리일 때만. 비정형은 버린다. */
  birth_regno: string | null;
  /** 사업자번호 000-00-00000 — 정확히 10자리일 때만. 법인(businessRegNo) 우선. */
  biz_regno: string | null;
  /** 대표이사 후보 — B2B 고객일 때 WARP 담당자명. 빈 칸일 때만 채워지므로 참고 수준. */
  ceo_name: string | null;
  address: string | null;
  address_detail: string | null;
  /** 유선번호 — WARP companyPhone. */
  tel: string | null;
  /** 동일 이름+전화로 여러 건 등록돼 있으면 2 이상 — 최신 1건 기준임을 안내한다. */
  match_count: number;
  vehicles: WarpVehicleInfo[];
}

export function isWarpConfigured(): boolean {
  return Boolean(process.env['WARP_API_BASE_URL'] && process.env['WARP_API_KEY']);
}

/** 8자리 생년월일만 YYYY-MM-DD 로. 그 외(주민번호 조각·자유입력)는 버린다 — 틀린 값이 계약서에 들어가면 안 된다. */
export function toBirthRegno(birthInfo: string | null | undefined): string | null {
  const d = digitsOnly(birthInfo);
  if (d.length !== 8) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
}

/** 10자리 사업자번호만 000-00-00000 로. */
export function toBizRegno(raw: string | null | undefined): string | null {
  const d = digitsOnly(raw);
  if (d.length !== 10) return null;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

/** WARP 고객 DTO → 견적 폼 자동 기입 값. */
export function toAutofillHit(c: WarpCustomerDto, matchCount: number): WarpAutofillHit {
  const isB2b = c.customerSegment === 'B2B';

  // 주소: B2C 는 지역(시/구), B2B 는 회사주소를 우선하되 없으면 서로 대체한다
  const regionAddress = [c.regionCity, c.regionDist].filter(Boolean).join(' ') || null;
  const address = isB2b ? (c.companyAddress ?? regionAddress) : (regionAddress ?? c.companyAddress);

  const vehicles: WarpVehicleInfo[] = [];
  if (c.hasVehicle || c.vehicleMaker || c.vehicleName || c.vehiclePlateNo) {
    vehicles.push({
      maker: c.vehicleMaker,
      name: c.vehicleName,
      plate_no: c.vehiclePlateNo,
      year: c.vehicleYear,
      truck_types: [c.truckType1, c.truckType2, c.truckType3, c.truckType4]
        .filter((t): t is string => Boolean(t)),
    });
  }

  return {
    name: c.name,
    email: c.email,
    birth_regno: toBirthRegno(c.birthInfo),
    // 법인 businessRegNo 우선, 없으면 개인사업자 soleBusinessNo
    biz_regno: toBizRegno(c.businessRegNo) ?? toBizRegno(c.soleBusinessNo),
    ceo_name: isB2b ? (c.name || null) : null,
    address,
    address_detail: c.addressDetail,
    tel: c.companyPhone,
    match_count: matchCount,
    vehicles,
  };
}

/**
 * 이름 + 전화번호 **완전일치** 조회. 매칭 없음·미설정·오류·타임아웃 전부 null.
 * 로그에는 전화 뒷 4자리만 남긴다(개인정보).
 */
export async function lookupWarpCustomer(name: string, phone: string): Promise<WarpAutofillHit | null> {
  if (!isWarpConfigured()) return null;
  const trimmedName = name.trim();
  const phoneDigits = digitsOnly(phone);
  if (!trimmedName || phoneDigits.length < 9) return null;

  const base = (process.env['WARP_API_BASE_URL'] ?? '').replace(/\/+$/, '');
  const q = new URLSearchParams({ name: trimmedName, phone: phoneDigits });
  try {
    const res = await fetch(`${base}/api/external/customer-lookup?${q}`, {
      headers: { 'x-api-key': process.env['WARP_API_KEY']!, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // 키 불일치(401)·미설정(503) 등 — 조회만 건너뛴다. 본문에 개인정보가 없어 상태만 남긴다.
      console.warn(`[warp-crm] lookup 실패 (${res.status}) — phone=****${phoneDigits.slice(-4)}`);
      return null;
    }
    const body = (await res.json()) as WarpLookupResponse;
    if (!body.matched || !body.customer) return null;
    return toAutofillHit(body.customer, body.matchCount ?? 1);
  } catch (e) {
    // 타임아웃·연결 실패 — 부가 기능이므로 삼키고 null (견적 입력을 막지 않는다)
    console.warn(`[warp-crm] lookup 오류 — phone=****${phoneDigits.slice(-4)}:`, e instanceof Error ? e.message : e);
    return null;
  }
}
