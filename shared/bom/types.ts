import type { WeightItem } from '../load-calc/types.js';

export interface BomItem {
  label: string;
  weight_kg: number;
  cg_x_mm: number; // CG_x 전축기준 (mm)
}

export interface BomResult {
  body_type: string;            // '냉동탑' | '내장탑'
  top_type: string;             // '저상' | '표준'
  door_config: string;          // 도어구성 키
  remove_items: BomItem[];
  install_items: BomItem[];     // 무게계산_포함:true 항목만
  extra_option_labels: string[]; // 무게계산_포함:false 항목 이름 (서류 표기용)
  curb_weight_after_kg: number; // 차량중량_후 = 1905 - Σ탈거 + Σ설치
  max_payload_kg: number;       // 최대적재량_후 (탑 조합값)
  tuning_summary: string;       // 자동 생성 튜닝 개요 문장
  // shared/load-calc WeightItem 형태로 변환된 항목 (후축까지거리)
  remove_weight_items: WeightItem[];
  install_weight_items: WeightItem[];
}
