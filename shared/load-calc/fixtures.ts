/**
 * 테스트용 DB 시드 CSV 로더.
 * db/seed/*.csv 를 읽어 타입이 있는 객체로 반환.
 * 실서비스에서는 이 파일 대신 실제 DB 쿼리를 사용.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEED_DIR = path.resolve(
  fileURLToPath(import.meta.url),
  "../../../db/seed"
);

function readCsv(filename: string): Record<string, string>[] {
  const raw = fs.readFileSync(path.join(SEED_DIR, filename), "utf-8");
  const lines = raw.trim().split("\n");
  const headers = (lines[0] ?? "").split(",");
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (vals[i] ?? "").trim()]));
  });
}

export interface VehicleModel {
  code: string;
  name: string;
  wheelbase_mm: number;
  curb_axle_front_kg: number;
  curb_axle_rear_kg: number;
  curb_weight_kg: number;
  default_tire_front: string;
  default_tire_rear: string;
  gvw_limit_kg: number | null;
}

export interface TireRow {
  spec: string;
  allowable_load_kg: number;
}

export function loadVehicleModels(): VehicleModel[] {
  return readCsv("vehicle_model.csv").map((r) => ({
    code: r["code"] ?? "",
    name: r["name"] ?? "",
    wheelbase_mm: Number(r["wheelbase_mm"]),
    curb_axle_front_kg: Number(r["curb_axle_front_kg"]),
    curb_axle_rear_kg: Number(r["curb_axle_rear_kg"]),
    curb_weight_kg: Number(r["curb_weight_kg"]),
    default_tire_front: r["default_tire_front"] ?? "",
    default_tire_rear: r["default_tire_rear"] ?? "",
    gvw_limit_kg: r["gvw_limit_kg"] ? Number(r["gvw_limit_kg"]) : null,
  }));
}

export function loadTires(): Map<string, number> {
  const rows = readCsv("tire.csv");
  return new Map(rows.map((r) => [r["spec"] ?? "", Number(r["allowable_load_kg"])]));
}
