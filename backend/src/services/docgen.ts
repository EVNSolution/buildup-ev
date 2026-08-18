/**
 * 구조변경 서류 자동생성 — 주문 옵션 → BOM → 하중계산 → JSON → python(openpyxl) → xlsx
 * → LibreOffice(soffice) → PDF → DOC_STORAGE_DIR 에 버전 누적 저장.
 *
 * 파이프라인 자체(gen_load_calc.py, 픽셀격자·보정식)는 절대 수정 금지 대상 — 이 파일은
 * 그 스크립트에 넣을 JSON을 조립하고 xlsx→PDF 변환·저장·이력관리만 담당한다.
 */
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../lib/prisma.js';
import { calcBom, maxPayloadKg } from '@buildup-ev/shared/bom';
import { calcLoad } from '@buildup-ev/shared/load-calc';
import { loadWeightConstants } from './weight-constants.js';
import type { GeneratedDocType } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT   = path.resolve(__dirname, '../../..');
const GEN_SCRIPT       = path.join(REPO_ROOT, 'doc-templates/builders/gen_load_calc.py');
const GEN_SPEC_SCRIPT  = path.join(REPO_ROOT, 'doc-templates/builders/gen_spec_table.py');
const PV5_SPEC    = path.join(REPO_ROOT, 'doc-templates/pv5-spec.json');
const SOFFICE_TIMEOUT_MS = 30_000;
const PYTHON_TIMEOUT_MS  = 15_000;

/** 문서생성 환경 미구성(python3/openpyxl/LibreOffice 없음 등) — 라우트에서 503으로 매핑 */
export class DocGenUnavailableError extends Error {}
/** 입력 데이터 자체가 불완전(BOM 미확정 등) — 라우트에서 422로 매핑 */
export class DocGenInputError extends Error {}

function getStorageDir(): string {
  const dir = process.env['DOC_STORAGE_DIR'];
  if (dir) return dir;
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('DOC_STORAGE_DIR 환경변수가 설정되지 않았습니다 (프로덕션 필수 — 배포 워크트리 밖 경로)');
  }
  // 개발 편의 폴백. 배포 워크트리 밖(prod)에서는 위에서 반드시 throw.
  return path.resolve(REPO_ROOT, '.local-doc-storage');
}

function readPV5Spec(): Record<string, unknown> {
  return JSON.parse(readFileSync(PV5_SPEC, 'utf-8'));
}

// ── 외부 프로세스 실행 헬퍼 (타임아웃 + 실패 시 정리) ────────────────────────────

function run(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new DocGenUnavailableError(`${cmd} 실행이 ${timeoutMs}ms 내에 끝나지 않았습니다`));
    }, timeoutMs);

    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new DocGenUnavailableError(`${cmd} 를 찾을 수 없습니다 (서버에 미설치)`));
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} 종료코드 ${code}: ${stderr.slice(0, 2000)}`));
    });
  });
}

/** JSON → xlsx (gen_*.py 생성기, 픽셀격자·보정식 수정 금지) */
async function runPython(script: string, jsonPath: string, outXlsx: string): Promise<void> {
  await run('python3', [script, jsonPath, outXlsx], PYTHON_TIMEOUT_MS);
}

/**
 * xlsx → pdf. LibreOffice 는 같은 유저 프로필로 병렬 실행하면 깨지므로 매 호출마다
 * 임시 UserInstallation 프로필을 분리해서 동시요청 충돌을 방지한다.
 */
async function runSoffice(xlsxPath: string, outDir: string): Promise<void> {
  const profileDir = path.join(tmpdir(), `soffice_${randomUUID()}`);
  try {
    await run('soffice', [
      '--headless', '--nologo', '--nofirststartwizard',
      `-env:UserInstallation=file://${profileDir}`,
      '--convert-to', 'pdf',
      '--outdir', outDir,
      xlsxPath,
    ], SOFFICE_TIMEOUT_MS);
  } finally {
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── 데이터 조립 ────────────────────────────────────────────────────────────────

interface OrderForDocgen {
  id: number;
  quote: { model_code: string; selections: unknown };
  vehicle_info: Record<string, unknown>;
}

async function loadOrder(orderId: number): Promise<OrderForDocgen> {
  if (!prisma) throw new DocGenUnavailableError('DB 연결 필요');
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      quote: { select: { model_code: true, selections: true } },
      options: { select: { group_code: true, value_code: true } },
    },
  });
  if (!order) throw new DocGenInputError('주문을 찾을 수 없습니다');

  const selections: Record<string, string> = order.options.length > 0
    ? Object.fromEntries(order.options.map(o => [o.group_code, o.value_code]))
    : ((order.quote.selections ?? {}) as Record<string, string>);

  return {
    id: order.id,
    quote: { model_code: order.quote.model_code, selections },
    vehicle_info: (order.vehicle_info ?? {}) as Record<string, unknown>,
  };
}

async function loadVehicleAndTire(modelCode: string) {
  if (!prisma) throw new DocGenUnavailableError('DB 연결 필요');
  const vm = await prisma.vehicleModel.findUnique({ where: { code: modelCode } });
  if (!vm) throw new DocGenInputError(`vehicle_model에 ${modelCode} 가 없습니다`);
  if (
    vm.wheelbase_mm == null || vm.curb_axle_front_kg == null ||
    vm.curb_axle_rear_kg == null || vm.gvw_limit_kg == null ||
    !vm.default_tire_front || !vm.default_tire_rear
  ) {
    throw new DocGenInputError(`vehicle_model(${modelCode}) 필수 필드(축간거리/공차축하중/총중량한도/타이어) 누락`);
  }
  const [tireFront, tireRear] = await Promise.all([
    prisma.tire.findUnique({ where: { spec: vm.default_tire_front } }),
    prisma.tire.findUnique({ where: { spec: vm.default_tire_rear } }),
  ]);
  if (!tireFront || !tireRear) {
    throw new DocGenInputError(`tire 테이블에 ${vm.default_tire_front}/${vm.default_tire_rear} 가 없습니다`);
  }
  return { vm, tireFront, tireRear };
}

/**
 * 서류 공통 컨텍스트: 주문·차종·타이어·BOM + 변경전/후 하중계산.
 * 하중계산서·제원대비표가 동일 소스를 공유(값 하드코딩 금지).
 */
async function assembleContext(orderId: number) {
  const order = await loadOrder(orderId);
  const { vm, tireFront, tireRear } = await loadVehicleAndTire(order.quote.model_code);
  const C = await loadWeightConstants(); // weight_constant(DB) → 계산에 주입
  const spec = readPV5Spec();

  const bom = calcBom(order.quote.selections as Record<string, string>, C);
  if (!bom) {
    throw new DocGenInputError('BODYTYPE·TOP·DOORTYPE 옵션 조합이 불완전하거나 유효하지 않습니다');
  }

  const tireCfg = (t: { allowable_load_kg: number }) => ({ allowable_load_kg: t.allowable_load_kg, wheels: 2 });
  const basePayloadKg = maxPayloadKg(C.curb_base_kg, C); // 오픈베드(구조변경 전) 최대적재량 = §4 수식

  const before = calcLoad({
    wheelbase_mm: vm.wheelbase_mm!,
    curb_axle_front_kg: vm.curb_axle_front_kg!,
    curb_axle_rear_kg: vm.curb_axle_rear_kg!,
    gvw_limit_kg: vm.gvw_limit_kg!,
    tire_front: tireCfg(tireFront),
    tire_rear: tireCfg(tireRear),
    cargo: { weight_kg: basePayloadKg, dist_to_rear_axle_mm: C.cargo_d_mm },
    crew_items: [{ weight_kg: C.crew_w_kg, dist_to_rear_axle_mm: C.crew_d_mm }],
  });

  const after = calcLoad({
    wheelbase_mm: vm.wheelbase_mm!,
    curb_axle_front_kg: vm.curb_axle_front_kg!,
    curb_axle_rear_kg: vm.curb_axle_rear_kg!,
    gvw_limit_kg: vm.gvw_limit_kg!,
    tire_front: tireCfg(tireFront),
    tire_rear: tireCfg(tireRear),
    install_items: bom.install_weight_items,
    remove_items: bom.remove_weight_items,
    cargo: { weight_kg: bom.max_payload_kg, dist_to_rear_axle_mm: C.cargo_d_mm },
    crew_items: [{ weight_kg: C.crew_w_kg, dist_to_rear_axle_mm: C.crew_d_mm }],
  });

  return { order, vm, tireFront, tireRear, C, spec, bom, before, after, basePayloadKg };
}

/** gen_load_calc.py 에 넣을 JSON 조립. calcBom/calcLoad 결과만 사용 — 값 하드코딩 금지. */
async function buildLoadCalcJson(orderId: number) {
  const { vm, tireFront, tireRear, C, spec, bom, before, after, basePayloadKg } = await assembleContext(orderId);

  const bodyDim = spec['차체제원_mm'] as Record<string, number>;
  const bedDim  = spec['적재함_내측_mm'] as Record<string, number>;
  const r1 = (v: number) => Math.round(v * 10) / 10;

  // "후" 치수(전장/전폭/전고/하대*)는 VIVAR 치수 API 개발 중 → 확정 전까지 변경전 값으로 채운다(잠정).
  // 실제 구조변경 서류 답지 확보 시 그 값으로 교체 — CLAUDE.md 참조.
  const json = {
    before: {
      type: '화물차특수용도형',
      seats: spec['승차정원'],
      curb: vm.curb_weight_kg,
      payload: basePayloadKg,
      gvw: spec['차량총중량_kg'],
      wheelbase: vm.wheelbase_mm,
      offset: spec['하대옵셋트_mm'],
      length: bodyDim['길이'], width: bodyDim['너비'], height: bodyDim['높이'],
      bed_len: bedDim['길이'], bed_wid: bedDim['너비'], bed_hgt: bedDim['높이'],
    },
    after: {
      type: '화물차특수용도형',
      seats: spec['승차정원'],
      curb: r1(bom.curb_weight_after_kg),
      payload: bom.max_payload_kg,
      gvw: Math.round(after.gvw_kg),
      wheelbase: vm.wheelbase_mm,
      offset: spec['하대옵셋트_mm'],
      length: bodyDim['길이'], width: bodyDim['너비'], height: bodyDim['높이'],
      bed_len: bedDim['길이'], bed_wid: bedDim['너비'], bed_hgt: bedDim['높이'],
      tread2f: 0, tread2r: 0,
      steer_ratio: r1(after.steering_axle_ratio_pct),
    },
    extra: { payload_cut: 0, pusher_w: 0, pusher_d: 0, frame_w: 0, frame_d: 0 },
    load: {
      전전: {
        empty_before: Math.round(before.curb.front_kg), empty_after: Math.round(after.curb.front_kg),
        empty_ratio: r1(after.tire_load_rate.curb_front_pct),
        full_before: Math.round(before.loaded.front_kg), full_after: Math.round(after.loaded.front_kg),
        full_ratio: r1(after.tire_load_rate.loaded_front_pct),
      },
      후전: {
        empty_before: Math.round(before.curb.rear_kg), empty_after: Math.round(after.curb.rear_kg),
        empty_ratio: r1(after.tire_load_rate.curb_rear_pct),
        full_before: Math.round(before.loaded.rear_kg), full_after: Math.round(after.loaded.rear_kg),
        full_ratio: r1(after.tire_load_rate.loaded_rear_pct),
      },
    },
    tire: {
      전전: { spec_before: vm.default_tire_front, load_before: tireFront.allowable_load_kg,
              spec_after: vm.default_tire_front, load_after: tireFront.allowable_load_kg, wheels: 2 },
      후전: { spec_before: vm.default_tire_rear, load_before: tireRear.allowable_load_kg,
              spec_after: vm.default_tire_rear, load_after: tireRear.allowable_load_kg, wheels: 2 },
    },
    install_items: bom.install_items.map(i => ({
      name: i.label, weight: i.weight_kg, dist: vm.wheelbase_mm! - i.cg_x_mm,
    })),
    remove_items: bom.remove_items.map(i => ({
      name: i.label, weight: i.weight_kg, dist: vm.wheelbase_mm! - i.cg_x_mm,
    })),
    crew: { name: '전방 1열', persons: spec['승차정원'], weight: C.crew_w_kg, dist: C.crew_d_mm },
  };

  return { json, legal: after.legal, bom };
}

/**
 * gen_spec_table.py 에 넣을 JSON 조립(주요제원대비표, 별지 제33호의2서식).
 * 변경전=차종마스터/pv5-spec 기준값, 변경후=BOM·하중계산 산출값.
 * 소유자·등록정보는 order.vehicle_info(특장사 입력) — 미입력 시 빈칸으로 렌더.
 * ⚠️ VIVAR 미연동 구간: 변경후 치수(차체 높이·하대·옵셋트)는 확정 불가 → 변경전 값 유지/공란(하중계산서와 동일 규약).
 */
/**
 * 튜닝개요 한 줄 — 「탈거: … / 설치: …」.
 *
 * 제원대비표와 **튜닝 승인 신청서**가 같은 문구를 쓴다. 두 서류가 다른 말을 하면
 * 관청이 되묻는다 — 그래서 각자 만들지 않고 여기 한 곳에서 낸다.
 */
export async function buildTuningSummary(orderId: number): Promise<string> {
  const { bom } = await assembleContext(orderId);
  const rem = bom.remove_items.map(i => i.label).join(', ');
  const ins = bom.install_items.map(i => i.label).join(', ');
  return [rem && `탈거: ${rem}`, ins && `설치: ${ins}`].filter(Boolean).join(' / ');
}

async function buildSpecTableJson(orderId: number) {
  const { order, vm, spec, bom, before, after } = await assembleContext(orderId);
  const vi = order.vehicle_info;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const vis = (k: string) => (vi[k] == null ? '' : String(vi[k]));

  const bodyDim = spec['차체제원_mm'] as Record<string, number>;
  const bedDim  = spec['적재함_내측_mm'] as Record<string, number>;
  const tread   = spec['윤간거리_mm'] as Record<string, number>;
  const eng     = spec['원동기'] as Record<string, unknown>;
  const econ    = spec['연료소비율'] as Record<string, Record<string, number>>;
  const tire    = spec['타이어'] as Record<string, unknown>;

  // 탈거/설치 라벨로 튜닝개요 자동 문구 (사람이 나중에 수정 가능 — 여기선 초안)
  const tuning = await buildTuningSummary(orderId);

  const json = {
    mgmt_no: vis('제원관리번호'),
    owner_addr: vis('소유자주소'),
    owner_name: vis('소유자성명'),
    reg_date: vis('최초등록일'),
    reg_no: vis('등록번호'),
    category: spec['종별'],
    car_name: spec['차명'],
    division: spec['구분'],
    form_code: vis('형식코드') || spec['형식코드'],
    body_shape: spec['차체형상'],
    val: {
      seats: [spec['승차정원'], spec['승차정원']],
      type: [spec['유형'], spec['유형']],
      curb: [spec['공차중량_kg'], r1(bom.curb_weight_after_kg)],
      usage: [spec['용도_기본'], spec['용도_기본']],
      payload: [spec['최대적재량_kg'], bom.max_payload_kg],
      gvw: [spec['차량총중량_kg'], Math.round(after.gvw_kg)],
      offset: [spec['하대옵셋트_mm'], spec['하대옵셋트_mm']], // 변경후=VIVAR 연동 전 잠정 동일
      fuel: [spec['사용연료'], spec['사용연료']],
      front_ratio: [r1(before.steering_axle_ratio_pct), r1(after.steering_axle_ratio_pct)],
      drivetrain: [spec['구동방식'], spec['구동방식']],
    },
    // 변경후 치수: VIVAR 치수 API 개발 중 → 실측 답지 확정 전까지 변경전 값으로 채운다(잠정).
    // 실제 구조변경 서류 답지가 확보되면 그 값으로 교체.
    body: { len: [bodyDim['길이'], bodyDim['길이']], wid: [bodyDim['너비'], bodyDim['너비']], hgt: [bodyDim['높이'], bodyDim['높이']] },
    bed:  { len: [bedDim['길이'], bedDim['길이']], wid: [bedDim['너비'], bedDim['너비']], hgt: [bedDim['높이'], bedDim['높이']] },
    empty:  { ff: [Math.round(before.curb.front_kg), Math.round(after.curb.front_kg)], fr: [0, 0],
              rf: [Math.round(before.curb.rear_kg), Math.round(after.curb.rear_kg)], rm: [0, 0], rr: [0, 0] },
    loaded: { ff: [Math.round(before.loaded.front_kg), Math.round(after.loaded.front_kg)], fr: [0, 0],
              rf: [Math.round(before.loaded.rear_kg), Math.round(after.loaded.rear_kg)], rm: [0, 0], rr: [0, 0] },
    tire_rate: { ff: [r1(before.tire_load_rate.loaded_front_pct), r1(after.tire_load_rate.loaded_front_pct)], fr: [0, 0],
                 rf: [r1(before.tire_load_rate.loaded_rear_pct), r1(after.tire_load_rate.loaded_rear_pct)], rm: [0, 0], rr: [0, 0] },
    wheelbase: vm.wheelbase_mm,
    gvwr: spec['제작허용총중량_kg'],
    model_year: vis('모델연도') || spec['모델연도'],
    vin: vis('차대번호') || spec['차대번호_1_8'],
    engine: {
      ice_form: ['/', '/'], ice_power: ['/', '/'], ice_cyl: ['0/0', '0/0'],
      mot_form: [eng['구동전동기_형식'], eng['구동전동기_형식']],
      mot_cnt: [eng['구동전동기_개수'], eng['구동전동기_개수']],
      mot_power: [eng['구동전동기_최고출력_kW_rpm'], eng['구동전동기_최고출력_kW_rpm']],
      bat_volt: [`${eng['구동축전지_정격전압_V'] ?? ''}/${eng['구동축전지_용량_Ah'] ?? ''}`,
                 `${eng['구동축전지_정격전압_V'] ?? ''}/${eng['구동축전지_용량_Ah'] ?? ''}`],
      bat_form: [eng['구동축전지_형식'], eng['구동축전지_형식']],
      bat_cnt: [1, 1],
      fc_form: ['/', '/'], fc_cnt: ['/', '/'], fc_power: ['/', '/'],
      hybrid: ['', ''],
    },
    econ: {
      eff: [econ['전비_km_kWh']?.['복합'], econ['전비_km_kWh']?.['시가지'], econ['전비_km_kWh']?.['고속']],
      range: [econ['1회충전주행거리_km']?.['복합'], econ['1회충전주행거리_km']?.['시가지'], econ['1회충전주행거리_km']?.['고속']],
    },
    misc: {
      tread_f: [tread['전'], tread['전']], tread_r: [tread['후'], tread['후']],
      trans_type: ['없음', '없음'], trans_speed: ['/', '/'],
    },
    tire: {
      f_front: [tire['형식'], tire['형식']], f_rear: [0, 0],
      r_front: [tire['형식'], tire['형식']], r_mid: [0, 0], r_rear: [0, 0],
    },
    tuning_summary: tuning,
    remark: '',
  };
  return { json };
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

export interface GenerateResult {
  filePath: string;
  version: number;
  legal: { within_gvw: boolean; compliant: boolean };
}

/**
 * 공통 파이프라인: JSON → python(script) → xlsx → soffice → PDF → DOC_STORAGE_DIR 저장 +
 * GeneratedDocument 버전 누적. python3/openpyxl/LibreOffice 미설치 시 DocGenUnavailableError.
 */
async function runDocPipeline(
  orderId: number, type: GeneratedDocType, script: string, json: unknown,
): Promise<{ filePath: string; version: number }> {
  if (!prisma) throw new DocGenUnavailableError('DB 연결 필요');

  const workDir = await mkdtemp(path.join(tmpdir(), 'docgen-'));
  try {
    const jsonPath = path.join(workDir, 'data.json');
    const xlsxPath = path.join(workDir, 'out.xlsx');
    await writeFile(jsonPath, JSON.stringify(json, null, 2), 'utf-8');

    await runPython(script, jsonPath, xlsxPath);
    await runSoffice(xlsxPath, workDir);

    const pdfPath = path.join(workDir, 'out.pdf');

    const lastVersion = await prisma.generatedDocument.findFirst({
      where: { order_id: orderId, type },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (lastVersion?.version ?? 0) + 1;

    const storageDir = path.join(getStorageDir(), 'orders', String(orderId));
    await mkdir(storageDir, { recursive: true });
    const finalPath = path.join(storageDir, `${type}_v${version}.pdf`);
    await copyFile(pdfPath, finalPath);

    await prisma.generatedDocument.create({
      data: { order_id: orderId, type, version, file_path: finalPath },
    });

    return { filePath: finalPath, version };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 하중계산서 생성 + 저장 + 이력. BOM/옵션 불완전 시 DocGenInputError.
 */
export async function generateLoadCalcDoc(orderId: number): Promise<GenerateResult> {
  const { json, legal } = await buildLoadCalcJson(orderId);
  const { filePath, version } = await runDocPipeline(orderId, 'load_calc', GEN_SCRIPT, json);
  return { filePath, version, legal: { within_gvw: legal.within_gvw, compliant: legal.compliant } };
}

/**
 * 주요제원대비표(별지 제33호의2서식) 생성 + 저장 + 이력.
 */
export async function generateSpecTableDoc(orderId: number): Promise<{ filePath: string; version: number }> {
  const { json } = await buildSpecTableJson(orderId);
  return runDocPipeline(orderId, 'spec_table', GEN_SPEC_SCRIPT, json);
}

/** 주문의 서류 목록 — type별 최신 버전만 */
export async function listGeneratedDocs(orderId: number) {
  if (!prisma) throw new DocGenUnavailableError('DB 연결 필요');
  return prisma.generatedDocument.findMany({
    where: { order_id: orderId },
    distinct: ['type'],
    orderBy: [{ type: 'asc' }, { version: 'desc' }],
  });
}

/**
 * 주문의 생성서류 PDF 실제 경로 목록.
 * ⚠️ 삭제 캐스케이드에서는 반드시 **DB 행을 지우기 전에** 호출해야 한다 —
 * generatedDocument 행이 file_path 의 유일한 출처라, 행을 먼저 지우면 경로를
 * 못 찾아 파일이 고아로 남는다(issue #17 ②).
 */
export async function collectGeneratedDocPaths(orderId: number): Promise<string[]> {
  if (!prisma) return [];
  const docs = await prisma.generatedDocument.findMany({
    where: { order_id: orderId },
    select: { file_path: true },
  });
  return docs.map(d => d.file_path);
}

/** collectGeneratedDocPaths 로 미리 확보한 경로의 실제 PDF 파일 정리. DB 행 삭제는 호출자 트랜잭션 담당.
 *  파일 삭제 실패는 무시(로그만) — 트랜잭션은 이미 커밋됐으므로 되돌리지 않는다. */
export async function deleteGeneratedDocFilesByPaths(paths: string[]): Promise<void> {
  await Promise.all(paths.map(p => rm(p, { force: true }).catch(() => {})));
}
