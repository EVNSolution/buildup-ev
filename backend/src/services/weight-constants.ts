/**
 * weight_constant(DB) → 구조화 WeightConstants 로더.
 *
 * shared 순수함수(calcBom/calcTopWeightKg/maxPayloadKg)는 DB를 못 읽으므로(브라우저서도 동작),
 * 백엔드가 이 로더로 DB 상수를 읽어 함수에 "주입"한다. (pricing 의 tax config 주입과 동일 패턴.)
 *  - 테이블이 비어있으면(아직 seed 전) 코드 기본값(DEFAULT_WEIGHT_CONSTANTS)으로 폴백.
 *  - 행이 있는데 필수 키가 빠졌으면 buildWeightConstants 가 throw(설정 오류를 조용히 넘기지 않음).
 * 관리자 CRUD 로 값이 바뀌면 invalidateWeightConstantsCache() 로 캐시를 비운다.
 */
import { prisma } from '../lib/prisma.js';
import {
  buildWeightConstants,
  DEFAULT_WEIGHT_CONSTANTS,
  type WeightConstants,
} from '@buildup-ev/shared/bom/weight-constants';

let cache: WeightConstants | null = null;

export async function loadWeightConstants(): Promise<WeightConstants> {
  if (cache) return cache;
  if (!prisma) return DEFAULT_WEIGHT_CONSTANTS;

  let rows;
  try {
    rows = await prisma.weightConstant.findMany();
  } catch (e) {
    // 테이블 미생성(마이그레이션 전)·DB 일시오류 → 기본값(=코드 seed 동일값)으로 폴백.
    // 캐시하지 않아 테이블 생성/시드 후 자동으로 DB 값을 다시 집는다.
    console.warn('[weight-constants] DB 조회 실패 — 기본값 사용:', e instanceof Error ? e.message : e);
    return DEFAULT_WEIGHT_CONSTANTS;
  }

  // 미시드(빈 테이블)도 캐시하지 않고 기본값 — 시드 직후 재조회에서 자동 반영.
  if (rows.length === 0) return DEFAULT_WEIGHT_CONSTANTS;

  // 행이 있는데 필수 키가 빠졌으면 buildWeightConstants 가 throw(설정오류를 조용히 넘기지 않음).
  cache = buildWeightConstants(
    rows.map((r) => ({
      key: r.key,
      category: r.category,
      value: Number(r.value),
      unit: r.unit ?? '',
      description: r.description ?? '',
    }))
  );
  return cache;
}

/** 관리자가 상수를 수정한 뒤 호출 — 다음 loadWeightConstants 부터 DB 재조회. */
export function invalidateWeightConstantsCache(): void {
  cache = null;
}
