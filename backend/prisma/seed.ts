/**
 * Prisma seed — db/seed CSV를 멱등(createMany skipDuplicates)으로 적재.
 * 채워진 것: F(org/user/feature_module/access_control) + vehicle_model + region +
 *            subsidy_local + tax_config + door_unit_price + tire
 * 빈 것(option_group·option_value 등): 에러 없이 통과.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WEIGHT_CONSTANT_SEED } from '@buildup-ev/shared/bom/weight-constants';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED = resolve(__dirname, '../../db/seed');

const prisma = new PrismaClient();

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let inQuotes = false;
  let cur = '';
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(cur); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur);
  return result;
}

function csv(file: string): Record<string, string>[] {
  const raw = readFileSync(resolve(SEED, file), 'utf-8');
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCSVLine(lines[0]!);
  return lines.slice(1).map(line => {
    const vals = splitCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ''])) as Record<string, string>;
  });
}

const bool  = (v: string | undefined) => v === 'Y';
const opt   = (v: string | undefined) => (v && v !== '') ? v : undefined;
const num   = (v: string | undefined) => (v && v !== '') ? parseInt(v, 10) : undefined;
const dec   = (v: string | undefined) => (v && v !== '') ? v : undefined;

async function main() {
  console.log('🌱 seeding…');

  // ── org (upsert — CSV가 항상 source of truth) ─────────────────────────
  const orgs = csv('org.csv').map(r => ({
    code:   r['code']!,
    type:   r['type'] as 'HQ' | 'DEALER' | 'MAKER',
    name:   r['name']!,
    biz_no: opt(r['biz_no']),
    active: bool(r['active']),
  }));
  for (const org of orgs) {
    await prisma.org.upsert({ where: { code: org.code }, update: org, create: org });
  }
  console.log(`  org: ${orgs.length}`);

  // ── user (upsert — invited_by FK: null 우선 처리) ─────────────────────
  const users = csv('user.csv').map(r => ({
    email:          r['email']!,
    org_code:       r['org_code']!,
    role:           r['role'] as 'SALES' | 'ADMIN' | 'MAKER',
    name:           r['name']!,
    phone:          opt(r['phone']),
    status:         (r['status'] || 'invited') as 'active' | 'invited' | 'suspended',
    must_change_pw: bool(r['must_change_pw']),
    invited_by:     opt(r['invited_by']),
    active:         bool(r['active']),
  }));
  const first  = users.filter(u => !u.invited_by);
  const second = users.filter(u =>  u.invited_by);
  for (const u of first)  {
    await prisma.user.upsert({ where: { email: u.email }, update: u, create: u });
  }
  for (const u of second) {
    await prisma.user.upsert({ where: { email: u.email }, update: u, create: u });
  }
  console.log(`  user: ${users.length}`);

  // ── feature_module + access_control (FK 순서: AC 전체 삭제 → FM 삭제 → FM 삽입 → AC 삽입)
  // 모듈 코드 전면 교체 시 기존 AC rows(user override 포함)가 구 코드를 참조하므로 전부 초기화
  const modules = csv('feature_module.csv').map(r => ({
    code:       r['code']!,
    name:       r['name']!,
    surface:    r['surface']!,
    sort_order: num(r['sort_order']) ?? 0,
    active:     bool(r['active']),
  }));
  const acs = csv('access_control.csv').map(r => ({
    subject_type: r['subject_type'] as 'role' | 'user',
    subject_ref:  r['subject_ref']!,
    module_code:  r['module_code']!,
    enabled:      bool(r['enabled']),
    memo:         opt(r['memo']),
  }));
  await prisma.accessControl.deleteMany({});
  await prisma.featureModule.deleteMany({});
  await prisma.featureModule.createMany({ data: modules });
  await prisma.accessControl.createMany({ data: acs });
  console.log(`  feature_module: ${modules.length}`);
  console.log(`  access_control: ${acs.length}`);

  // ── vehicle_model ─────────────────────────────────────────────────────
  const models = csv('vehicle_model.csv').map(r => ({
    code:               r['code']!,
    name:               r['name']!,
    drive_type:         r['drive_type']!,
    seats_default:      num(r['seats_default']) ?? 2,
    length_mm:          num(r['length_mm']),
    width_mm:           num(r['width_mm']),
    height_mm:          num(r['height_mm']),
    wheelbase_mm:       num(r['wheelbase_mm']),
    tread_front_mm:     num(r['tread_front_mm']),
    tread_rear_mm:      num(r['tread_rear_mm']),
    curb_weight_kg:     num(r['curb_weight_kg']),
    curb_axle_front_kg: num(r['curb_axle_front_kg']),
    curb_axle_rear_kg:  num(r['curb_axle_rear_kg']),
    gvw_limit_kg:       num(r['gvw_limit_kg']),
    max_length_mm:      num(r['max_length_mm']),
    max_width_mm:       num(r['max_width_mm']),
    max_height_mm:      num(r['max_height_mm']),
    default_tire_front: opt(r['default_tire_front']),
    default_tire_rear:  opt(r['default_tire_rear']),
    active:             bool(r['active']),
  }));
  for (const m of models) {
    await prisma.vehicleModel.upsert({ where: { code: m.code }, update: m, create: m });
  }
  console.log(`  vehicle_model: ${models.length}`);

  // ── option_group / option_value / option_group_model (데이터 없으면 통과) ───
  const optGroups = csv('option_group.csv').map(r => ({
    code:        r['code']!,
    category:    opt(r['category']),
    name:        r['name']!,
    select_type: r['select_type']!,
    required:    bool(r['required']),
    sort_order:  num(r['sort_order']) ?? 0,
    active:      bool(r['active']),
  }));
  if (optGroups.length) {
    for (const g of optGroups) {
      await prisma.optionGroup.upsert({ where: { code: g.code }, update: g, create: g });
    }
    console.log(`  option_group: ${optGroups.length}`);
  }

  const optValues = csv('option_value.csv').map(r => ({
    code:       r['code']!,
    group_code: r['group_code']!,
    name:       r['name']!,
    vivar_code: opt(r['vivar_code']),
    sort_order: num(r['sort_order']) ?? 0,
    active:     bool(r['active']),
  }));
  if (optValues.length) {
    for (const v of optValues) {
      await prisma.optionValue.upsert({ where: { code: v.code }, update: v, create: v });
    }
    console.log(`  option_value: ${optValues.length}`);
  }

  const ogm = csv('option_group_model.csv').map(r => ({
    group_code: r['group_code']!,
    model_code: r['model_code']!,
  }));
  if (ogm.length) {
    await prisma.optionGroupModel.createMany({ data: ogm, skipDuplicates: true });
    console.log(`  option_group_model: ${ogm.length}`);
  }

  // ── option_rule ──────────────────────────────────────────────────────
  const rules = csv('option_rule.csv').map(r => ({
    code:        r['code']!,
    when_value:  r['when_value']!,
    effect:      r['effect']!,
    target_type: r['target_type']!,
    target_code: r['target_code']!,
    memo:        opt(r['memo']),
  }));
  // 규칙은 CSV와 정확히 일치해야 하므로 전체 교체(삭제 후 삽입). FK 없음.
  await prisma.optionRule.deleteMany({});
  if (rules.length) {
    await prisma.optionRule.createMany({ data: rules });
    console.log(`  option_rule: ${rules.length}`);
  }

  // ── option_price ─────────────────────────────────────────────────────
  const optPrices = csv('option_price.csv').map(r => ({
    model_code:   r['model_code']!,
    value_code:   r['value_code']!,
    supply_price: num(r['supply_price']) ?? 0,
    memo:         opt(r['memo']),
  }));
  if (optPrices.length) {
    for (const op of optPrices) {
      await prisma.optionPrice.upsert({
        where: { model_code_value_code: { model_code: op.model_code, value_code: op.value_code } },
        update: op, create: op,
      });
    }
    console.log(`  option_price: ${optPrices.length}`);
  }

  // ── door_unit_price ───────────────────────────────────────────────────
  const doors = csv('door_unit_price.csv').map(r => ({
    model_code: r['model_code']!,
    top:        r['top']!,
    doortype:   r['doortype']!,
    unit_price: num(r['unit_price']) ?? 0,
  }));
  if (doors.length) {
    await prisma.doorUnitPrice.createMany({ data: doors, skipDuplicates: true });
    console.log(`  door_unit_price: ${doors.length}`);
  }

  // ── region ────────────────────────────────────────────────────────────
  const regions = csv('region.csv').map(r => ({
    name:    r['name']!,
    sido:    r['sido']!,
    sigungu: r['sigungu']!,
  }));
  if (regions.length) {
    for (const rg of regions) {
      await prisma.region.upsert({ where: { name: rg.name }, update: rg, create: rg });
    }
    console.log(`  region: ${regions.length}`);
  }

  // ── subsidy_national (비어 있으면 통과) ────────────────────────────────
  const snats = csv('subsidy_national.csv').map(r => ({
    model_code:  r['model_code']!,
    year:        num(r['year']) ?? 0,
    amount:      num(r['amount']) ?? 0,
    sosang_rate: dec(r['sosang_rate']),
  }));
  if (snats.length) {
    for (const sn of snats) {
      await prisma.subsidyNational.upsert({
        where: { model_code_year: { model_code: sn.model_code, year: sn.year } },
        update: sn, create: sn,
      });
    }
    console.log(`  subsidy_national: ${snats.length}`);
  }

  // ── subsidy_local ─────────────────────────────────────────────────────
  const slocs = csv('subsidy_local.csv').map(r => ({
    region:          r['region']!,
    year:            num(r['year']) ?? 0,
    amount:          num(r['amount']) ?? 0,
    extra:           num(r['extra']),
    remaining_quota: num(r['remaining_quota']),
    as_of:           opt(r['as_of']),
  }));
  if (slocs.length) {
    for (const sl of slocs) {
      await prisma.subsidyLocal.upsert({
        where: { region_year: { region: sl.region, year: sl.year } },
        update: sl, create: sl,
      });
    }
    console.log(`  subsidy_local: ${slocs.length}`);
  }

  // ── tax_config ────────────────────────────────────────────────────────
  const taxes = csv('tax_config.csv').map(r => ({
    param_key: r['param_key']!,
    value:     r['value']!,
    unit:      opt(r['unit']),
    memo:      opt(r['memo']),
  }));
  if (taxes.length) {
    for (const tx of taxes) {
      await prisma.taxConfig.upsert({ where: { param_key: tx.param_key }, update: tx, create: tx });
    }
    console.log(`  tax_config: ${taxes.length}`);
  }

  // ── installment_rate (할부개월수별 이율 — 총견적서 옵션DB AF/AG) ──────────
  const irs = csv('installment_rate.csv').map(r => ({
    months: num(r['months']) ?? 0,
    rate:   r['rate']!,
    label:  opt(r['label']),
    active: r['active'] !== 'N',
  }));
  if (irs.length) {
    for (const ir of irs) {
      await prisma.installmentRate.upsert({ where: { months: ir.months }, update: ir, create: ir });
    }
    console.log(`  installment_rate: ${irs.length}`);
  }

  // ── tire (2,356행 — createMany bulk) ─────────────────────────────────
  const tires = csv('tire.csv').map(r => ({
    spec:              r['spec']!,
    allowable_load_kg: num(r['allowable_load_kg']) ?? 0,
  }));
  if (tires.length) {
    // 500개 단위 청크 (Postgres 파라미터 제한 대비)
    const CHUNK = 500;
    for (let i = 0; i < tires.length; i += CHUNK) {
      await prisma.tire.createMany({ data: tires.slice(i, i + CHUNK), skipDuplicates: true });
    }
    console.log(`  tire: ${tires.length}`);
  }

  // ── weight_constant (무게계산 상수 — 단일소스 shared/bom/weight-constants.ts) ──
  for (const c of WEIGHT_CONSTANT_SEED) {
    const row = { key: c.key, category: c.category, value: c.value, unit: c.unit, description: c.description };
    await prisma.weightConstant.upsert({ where: { key: c.key }, update: row, create: row });
  }
  console.log(`  weight_constant: ${WEIGHT_CONSTANT_SEED.length}`);

  console.log('✅ seed 완료');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
