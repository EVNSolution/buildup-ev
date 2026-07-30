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

  const rows = await prisma.weightConstant.findMany();
  if (rows.length === 0) {
    cache = DEFAULT_WEIGHT_CONSTANTS; // 미시드 상태 — 기본값 사용
    return cache;
  }

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
