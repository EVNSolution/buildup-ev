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

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED = resolve(__dirname, '../../db/seed');

const prisma = new PrismaClient();

function csv(file: string): Record<string, string>[] {
  const raw = readFileSync(resolve(SEED, file), 'utf-8');
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(',');
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ''])) as Record<string, string>;
  });
}

const bool  = (v: string | undefined) => v === 'Y';
const opt   = (v: string | undefined) => (v && v !== '') ? v : undefined;
const num   = (v: string | undefined) => (v && v !== '') ? parseInt(v, 10) : undefined;
const dec   = (v: string | undefined) => (v && v !== '') ? v : undefined;

async function main() {
  console.log('🌱 seeding…');

  // ── org ───────────────────────────────────────────────────────────────
  const orgs = csv('org.csv').map(r => ({
    code:   r['code']!,
    type:   r['type'] as 'HQ' | 'DEALER' | 'MAKER',
    name:   r['name']!,
    biz_no: opt(r['biz_no']),
    active: bool(r['active']),
  }));
  await prisma.org.createMany({ data: orgs, skipDuplicates: true });
  console.log(`  org: ${orgs.length}`);

  // ── user ──────────────────────────────────────────────────────────────
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
  // invited_by는 자기참조 FK — null 우선 삽입 후 upsert로 해결
  const first  = users.filter(u => !u.invited_by);
  const second = users.filter(u => u.invited_by);
  await prisma.user.createMany({ data: first,  skipDuplicates: true });
  await prisma.user.createMany({ data: second, skipDuplicates: true });
  console.log(`  user: ${users.length}`);

  // ── feature_module ────────────────────────────────────────────────────
  const modules = csv('feature_module.csv').map(r => ({
    code:       r['code']!,
    name:       r['name']!,
    surface:    r['surface']!,
    sort_order: num(r['sort_order']) ?? 0,
    active:     bool(r['active']),
  }));
  await prisma.featureModule.createMany({ data: modules, skipDuplicates: true });
  console.log(`  feature_module: ${modules.length}`);

  // ── access_control ───────────────────────────────────────────────────
  const acs = csv('access_control.csv').map(r => ({
    subject_type: r['subject_type'] as 'role' | 'user',
    subject_ref:  r['subject_ref']!,
    module_code:  r['module_code']!,
    enabled:      bool(r['enabled']),
    memo:         opt(r['memo']),
  }));
  await prisma.accessControl.createMany({ data: acs, skipDuplicates: true });
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
  await prisma.vehicleModel.createMany({ data: models, skipDuplicates: true });
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
    await prisma.optionGroup.createMany({ data: optGroups, skipDuplicates: true });
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
    await prisma.optionValue.createMany({ data: optValues, skipDuplicates: true });
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
    await prisma.region.createMany({ data: regions, skipDuplicates: true });
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
    await prisma.subsidyNational.createMany({ data: snats, skipDuplicates: true });
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
    await prisma.subsidyLocal.createMany({ data: slocs, skipDuplicates: true });
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
    await prisma.taxConfig.createMany({ data: taxes, skipDuplicates: true });
    console.log(`  tax_config: ${taxes.length}`);
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

  console.log('✅ seed 완료');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
