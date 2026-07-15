/**
 * doc-templates/pv5-spec.json 의 하중계산_기준입력 섹션을 읽어 반환.
 * DB(vehicle_model)에 없는 정원/적재 위치 기준값 — 테스트·백엔드 공통으로 사용.
 * 키가 없으면 조용히 기본값으로 폴백하지 않고 즉시 throw — 정답지 값이 스펙 파일에서
 * 소리없이 누락되는 것을 막기 위함 (과거 폴백값이 우연히 정답과 같아 버그를 못 잡은 사고 있었음).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface LoadCalcDefaults {
  crewWeight: number;
  crewDist: number;
  cargoDist: number;
}

export function loadPV5LoadCalcDefaults(): LoadCalcDefaults {
  const specPath = path.resolve(
    fileURLToPath(import.meta.url),
    "../../../doc-templates/pv5-spec.json"
  );
  const spec = JSON.parse(fs.readFileSync(specPath, "utf-8")) as Record<string, unknown>;
  const ki = spec["하중계산_기준입력"] as Record<string, number> | undefined;
  if (!ki) throw new Error("pv5-spec.json: '하중계산_기준입력' 섹션이 없습니다");

  const crewWeight = ki["정원_중량_kg"];
  const crewDist = ki["정원_위치_후축까지_mm"];
  const cargoDist = ki["적재_위치_후축까지_mm"];

  if (crewWeight === undefined) throw new Error("pv5-spec.json: 하중계산_기준입력.정원_중량_kg 누락");
  if (crewDist === undefined) throw new Error("pv5-spec.json: 하중계산_기준입력.정원_위치_후축까지_mm 누락");
  if (cargoDist === undefined) throw new Error("pv5-spec.json: 하중계산_기준입력.적재_위치_후축까지_mm 누락");

  return { crewWeight, crewDist, cargoDist };
}
