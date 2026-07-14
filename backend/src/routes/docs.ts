/**
 * GET  /orders/:id/docs/load-calc   — 하중계산서 PDF (ADMIN + MAKER 자기 org)
 * GET  /orders/:id/docs/spec-table  — 주요제원대비표 PDF
 * GET  /orders/:id/docs/work-order  — 작업지시서 PDF
 * PATCH /orders/:id/vehicle-info    — 차량정보 저장 (서류 바인딩)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { calcBom } from '@buildup-ev/shared/bom';
import { calcLoad } from '@buildup-ev/shared/load-calc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TPL_DIR   = join(__dirname, '../templates');

const TMPL_LOAD  = readFileSync(join(TPL_DIR, '하중계산서.html'),     'utf-8');
const TMPL_SPEC  = readFileSync(join(TPL_DIR, '주요제원대비표.html'), 'utf-8');
const TMPL_WORK  = readFileSync(join(TPL_DIR, '작업지시서.html'),    'utf-8');

export const docsRouter = Router();

// ── 타입 ──────────────────────────────────────────────────────────────────────

type VehicleInfo = {
  제원관리번호?: string;
  등록번호?: string;
  차대번호?: string;
  형식코드?: string;
  모델연도?: string | number;
  소유자성명?: string;
  소유자주소?: string;
  최초등록일?: string;
};

// Prisma에 vehicle_info 추가 후 db push 전까지 타입 캐스트용
type OrderAny = Record<string, unknown>;
type OrderFull = {
  id: number;
  quote_id: number;
  status: string;
  maker_org_id: string | null;
  vehicle_info?: VehicleInfo | null;
  quote: {
    customer: { name: string | null } | null;
    selections: unknown;  // fallback: order_option 없을 때 사용
  };
  maker_org: { name: string; code: string } | null;
  options: Array<{
    group_code: string;
    value_code: string;
    value: { name: string; group: { code: string; name: string } };
  }>;
  documents: Array<{ id: number; name: string; status: string }>;
};

// ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────

function esc(s: string | number | undefined | null): string {
  if (s == null) return '—';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function renderPdf(html: string): Promise<Buffer> {
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.setContent(html, { waitUntil: 'networkidle0' as any });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return pdf as Buffer;
  } finally {
    await browser.close();
  }
}

/** 주문 전체 조회 + MAKER org 범위 체크. 오류 시 res에 직접 응답하고 null 반환 */
async function loadOrder(req: Request, res: Response): Promise<OrderFull | null> {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return null;
  }
  const id = Number((req.params as Record<string, string>)['id']);
  if (isNaN(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 order id' } });
    return null;
  }

  const raw = await prisma.order.findUnique({
    where: { id },
    include: {
      quote: { select: { customer: true, selections: true } },
      maker_org: true,
      documents: { orderBy: { id: 'asc' } },
      options: {
        include: { value: { include: { group: { select: { code: true, name: true } } } } },
      },
    },
  }) as (OrderAny | null);

  if (!raw) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } });
    return null;
  }

  const auth = req.auth!;
  if (auth.role === 'MAKER' && !auth.is_master && raw['maker_org_id'] !== auth.org_code) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: '자기 조직의 주문만 조회할 수 있습니다' } });
    return null;
  }

  return raw as unknown as OrderFull;
}

/** OrderOption 배열 → selections Record. order_option 없으면 quote.selections 사용 */
function toSelections(order: OrderFull): Record<string, string> {
  if (order.options.length > 0) {
    const sel: Record<string, string> = {};
    for (const o of order.options) sel[o.group_code] = o.value_code;
    return sel;
  }
  // fallback: quote.selections JSON (영업에서 선택한 원본)
  return (order.quote.selections ?? {}) as Record<string, string>;
}

// ── PV5 고정 제원 (pv5-spec.json 확정값) ──────────────────────────────────────

const PV5 = {
  차명:           'PV5',
  종별:           '화물',
  구분:           '소형',
  차체형상:        '세미본네트형',
  형식코드:        'SW1-O-21L6-A-G7A',
  구동방식:        '4x2',
  사용연료:        '전기',
  승차정원:        2,
  유형:           '특수형',
  용도:           '화물 운송용',
  차체_길이:       5040,
  차체_너비:       1895,
  차체_높이:       1950,
  하대_길이:       2420,
  하대_너비:       1785,
  하대_높이:       355,
  하대옵셋:        35,
  축간거리:        2995,
  윤간거리_전:     1617,
  윤간거리_후:     1625,
  공차중량:        1905,
  공차_전축:       1105,
  공차_후축:       800,
  최대적재량:      600,
  차량총중량:      2635,
  제작허용총중량:  2680,
  전동기형식:      'DD4S',
  전동기개수:      1,
  전동기출력:      '120 kW / 4600~9000 rpm',
  배터리:         'REESS-SWL(EV) 402V / 177Ah',
  변속기:         '없음(감속기, 단수 없음)',
  주행거리:       '복합 330 / 시가지 370 / 고속 282',
  전비:           '복합 4.1 / 시가지 4.7 / 고속 3.6',
  타이어형식:      '215/65 R16',
  타이어허용:      750,
  차대번호_18:    'KNCWAX71',
  모델연도:       2026,
  내연기관:       '해당없음',
} as const;

function makeLoadInput(bom: ReturnType<typeof calcBom>, maxPayload: number) {
  return {
    wheelbase_mm:       PV5.축간거리,
    curb_axle_front_kg: PV5.공차_전축,
    curb_axle_rear_kg:  PV5.공차_후축,
    gvw_limit_kg:       PV5.제작허용총중량,
    tire_front: { allowable_load_kg: PV5.타이어허용, wheels: 2 },
    tire_rear:  { allowable_load_kg: PV5.타이어허용, wheels: 2 },
    remove_items:  bom!.remove_weight_items,
    install_items: bom!.install_weight_items,
    cargo:       { weight_kg: maxPayload, dist_to_rear_axle_mm: PV5.축간거리 - 2400 },
    crew_items:  [{ weight_kg: 130,       dist_to_rear_axle_mm: PV5.축간거리 - 1100 }],
  };
}

function openBedLoaded() {
  return calcLoad({
    wheelbase_mm:       PV5.축간거리,
    curb_axle_front_kg: PV5.공차_전축,
    curb_axle_rear_kg:  PV5.공차_후축,
    gvw_limit_kg:       PV5.제작허용총중량,
    tire_front: { allowable_load_kg: PV5.타이어허용, wheels: 2 },
    tire_rear:  { allowable_load_kg: PV5.타이어허용, wheels: 2 },
    cargo:      { weight_kg: PV5.최대적재량, dist_to_rear_axle_mm: PV5.축간거리 - 2400 },
    crew_items: [{ weight_kg: 130, dist_to_rear_axle_mm: PV5.축간거리 - 1100 }],
  });
}

// ── PATCH /orders/:id/vehicle-info ────────────────────────────────────────────

docsRouter.patch('/:id/vehicle-info', rbac('ADMIN', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const id = Number((req.params as Record<string, string>)['id']);
  if (isNaN(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 order id' } });
    return;
  }
  const raw = await prisma.order.findUnique({ where: { id } }) as (OrderAny | null);
  if (!raw) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } });
    return;
  }
  const auth = req.auth!;
  if (auth.role === 'MAKER' && !auth.is_master && raw['maker_org_id'] !== auth.org_code) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: '자기 조직의 주문만 수정할 수 있습니다' } });
    return;
  }
  const info = req.body as VehicleInfo;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = await (prisma.order.update as any)({
      where: { id },
      data: { vehicle_info: info },
      select: { id: true, vehicle_info: true },
    });
    res.json({ data: updated });
  } catch (e) {
    console.error('[PATCH /orders/:id/vehicle-info]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '차량정보 저장 중 오류' } });
  }
});

// ── GET /orders/:id/docs/work-order — 작업지시서 PDF ──────────────────────────

docsRouter.get('/:id/docs/work-order', rbac('ADMIN', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  const order = await loadOrder(req, res);
  if (!order) return;

  const vi = (order.vehicle_info ?? {}) as VehicleInfo;
  const today = new Date().toISOString().slice(0, 10);
  const selections = toSelections(order);
  const bom = calcBom(selections);

  // optionRows: order_option 우선, 없으면 selections→DB lookup
  let optionRows = '';
  if (order.options.length > 0) {
    optionRows = order.options
      .map(o => `<tr><td class="lbl c">${esc(o.value.group.name)}</td><td class="c">${esc(o.value.name)}</td></tr>`)
      .join('\n');
  } else if (prisma) {
    const valueCodes = Object.values(selections).filter(Boolean);
    if (valueCodes.length) {
      const vals = await prisma.optionValue.findMany({
        where: { code: { in: valueCodes } },
        include: { group: { select: { name: true } } },
      });
      const vMap = new Map(vals.map(v => [v.code, v]));
      optionRows = Object.entries(selections)
        .filter(([, vc]) => vMap.has(vc))
        .map(([, vc]) => {
          const v = vMap.get(vc)!;
          return `<tr><td class="lbl c">${esc(v.group.name)}</td><td class="c">${esc(v.name)}</td></tr>`;
        }).join('\n');
    }
  }

  const vars: Record<string, string> = {
    주문번호:   esc(order.id),
    작성일:     today,
    차명:       PV5.차명,
    model_code: 'PV5_OPENBED',
    고객명:     esc(order.quote.customer?.name),
    특장사명:   esc(order.maker_org?.name),
    등록번호:   esc(vi.등록번호),
    작업내역:   bom ? esc(bom.tuning_summary) : '—',
    OPTION_ROWS: optionRows,
  };

  const html = TMPL_WORK.replace('{{OPTION_ROWS}}', optionRows)
                        .replace(/\{\{([^}]+)\}\}/g, (m, k: string) => vars[k] ?? m);

  try {
    const pdf = await renderPdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(`작업지시서_주문${order.id}.pdf`)}`);
    res.end(pdf);
  } catch (e) {
    console.error('[GET docs/work-order]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'PDF 생성 중 오류' } });
  }
});

// ── GET /orders/:id/docs/load-calc — 하중계산서 PDF ──────────────────────────

docsRouter.get('/:id/docs/load-calc', rbac('ADMIN', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  const order = await loadOrder(req, res);
  if (!order) return;

  const selections = toSelections(order);
  const bom = calcBom(selections);
  if (!bom) {
    res.status(422).json({ error: { code: 'BOM_UNAVAILABLE', message: 'BODYTYPE·TOP·DOORTYPE 옵션이 불완전합니다.' } });
    return;
  }

  const result   = calcLoad(makeLoadInput(bom, bom.max_payload_kg));
  const prevLoad = openBedLoaded();   // 구조변경 전 (오픈베드)
  const r1 = (v: number) => String(Math.round(v * 10) / 10);

  const gvwOk  = result.legal.within_gvw;
  const tireOk = result.tire_load_rate.loaded_front_pct <= 100 && result.tire_load_rate.loaded_rear_pct <= 100;
  const allOk  = gvwOk && tireOk;
  const label  = (ok: boolean) => ok ? '적합 ✓' : '부적합 ✗';

  // 후축까지 거리 = 축간거리 - CG_x(전축기준)
  const toRear = (cgx: number) => String(PV5.축간거리 - cgx);

  // 4열 행: 구분·항목·중량·위치(후축까지)
  const removeRows  = bom.remove_items.map(i =>
    `<tr><td class="lbl">탈거</td><td class="l">${esc(i.label)}</td><td>${i.weight_kg}</td><td>${toRear(i.cg_x_mm)}</td></tr>`
  ).join('\n');
  const installRows = bom.install_items.map(i =>
    `<tr><td class="lbl">설치</td><td class="l">${esc(i.label)}</td><td>${i.weight_kg}</td><td>${toRear(i.cg_x_mm)}</td></tr>`
  ).join('\n');

  const vars: Record<string, string> = {
    // 제원 전 (구조변경 전 = 오픈베드)
    정원_전:           String(PV5.승차정원),
    차량중량_전:       String(PV5.공차중량),
    최대적재_전:       String(PV5.최대적재량),
    총중량_전:         String(PV5.차량총중량),
    축간_전:           String(PV5.축간거리),
    옵셋_전:           String(PV5.하대옵셋),
    앞오버행_전:       '—',
    뒤오버행_전:       '—',
    전장_전:           String(PV5.차체_길이),
    전폭_전:           String(PV5.차체_너비),
    전고_전:           String(PV5.차체_높이),
    하대장_전:         String(PV5.하대_길이),
    하대폭_전:         String(PV5.하대_너비),
    하대고_전:         String(PV5.하대_높이),

    // 제원 후 (BOM 산출; 치수 미확정 항목은 '—')
    정원_후:           String(PV5.승차정원),
    차량중량_후:       r1(bom.curb_weight_after_kg),
    최대적재_후:       String(bom.max_payload_kg),
    총중량_후:         String(Math.round(result.gvw_kg)),
    축간_후:           String(PV5.축간거리),
    옵셋_후:           String(PV5.하대옵셋),
    앞오버행_후:       '—',
    뒤오버행_후:       '—',
    전장_후:           String(PV5.차체_길이),
    전폭_후:           String(PV5.차체_너비),
    전고_후:           '—',
    하대장_후:         '—',
    하대폭_후:         '—',
    하대고_후:         '—',

    // 축하중 전 (오픈베드)
    공차전축_전:       String(Math.round(PV5.공차_전축)),
    공차전축_후:       String(Math.round(result.curb.front_kg)),
    부하율공차전축:    r1(result.tire_load_rate.curb_front_pct),
    적차전축_전:       String(Math.round(prevLoad.loaded.front_kg)),
    적차전축_후:       String(Math.round(result.loaded.front_kg)),
    부하율적차전축:    r1(result.tire_load_rate.loaded_front_pct),

    공차후축_전:       String(Math.round(PV5.공차_후축)),
    공차후축_후:       String(Math.round(result.curb.rear_kg)),
    부하율공차후축:    r1(result.tire_load_rate.curb_rear_pct),
    적차후축_전:       String(Math.round(prevLoad.loaded.rear_kg)),
    적차후축_후:       String(Math.round(result.loaded.rear_kg)),
    부하율적차후축:    r1(result.tire_load_rate.loaded_rear_pct),

    // 타이어
    타이어규격_전:     PV5.타이어형식,
    타이어규격_후:     PV5.타이어형식,
    타이어허용:        String(PV5.타이어허용),

    // 정원 / 법규
    정원_인원:         String(PV5.승차정원),
    정원_중량:         '130',
    정원_위치:         String(PV5.축간거리 - 1100),  // 후축까지 = 2995-1100 = 1895mm
    제작허용총중량:    String(PV5.제작허용총중량),
    총중량판정:        label(gvwOk),
    부하율판정:        label(tireOk),
    종합판정:          label(allOk),
  };

  // REMOVE/INSTALL 먼저 치환 후, 한국어 포함 모든 플레이스홀더를 [^}]+ 패턴으로 치환
  const html = TMPL_LOAD
    .replace('{{REMOVE_ROWS}}',  removeRows)
    .replace('{{INSTALL_ROWS}}', installRows)
    .replace(/\{\{([^}]+)\}\}/g, (m, k: string) => vars[k] ?? m);

  try {
    const pdf = await renderPdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(`하중계산서_주문${order.id}.pdf`)}`);
    res.end(pdf);
  } catch (e) {
    console.error('[GET docs/load-calc]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'PDF 생성 중 오류' } });
  }
});

// ── GET /orders/:id/docs/spec-table — 주요제원대비표 PDF ──────────────────────

docsRouter.get('/:id/docs/spec-table', rbac('ADMIN', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  const order = await loadOrder(req, res);
  if (!order) return;

  const selections = toSelections(order);
  const bom = calcBom(selections);
  if (!bom) {
    res.status(422).json({ error: { code: 'BOM_UNAVAILABLE', message: 'BODYTYPE·TOP·DOORTYPE 옵션이 불완전합니다.' } });
    return;
  }

  const result   = calcLoad(makeLoadInput(bom, bom.max_payload_kg));
  const prevLoad = openBedLoaded();
  const vi       = (order.vehicle_info ?? {}) as VehicleInfo;
  const r1       = (v: number) => String(Math.round(v * 10) / 10);

  const vars: Record<string, string> = {
    제원관리번호:     esc(vi.제원관리번호),
    소유자주소:       esc(vi.소유자주소),
    소유자성명:       esc(vi.소유자성명),
    최초등록일:       esc(vi.최초등록일),
    등록번호:         esc(vi.등록번호),
    종별:             PV5.종별,
    차명:             PV5.차명,
    구분:             PV5.구분,
    형식코드:         vi.형식코드 ? esc(vi.형식코드) : PV5.형식코드,
    차체형상:         PV5.차체형상,
    승차정원_전:      String(PV5.승차정원),
    승차정원_후:      String(PV5.승차정원),
    유형_전:          PV5.유형,
    유형_후:          PV5.유형,
    차량중량_전:      String(PV5.공차중량),
    차량중량_후:      String(Math.round(bom.curb_weight_after_kg * 10) / 10),
    용도_전:          PV5.용도,
    용도_후:          PV5.용도,
    최대적재량_전:    String(PV5.최대적재량),
    최대적재량_후:    String(bom.max_payload_kg),
    차량총중량_전:    String(PV5.차량총중량),
    차량총중량_후:    String(Math.round(result.gvw_kg)),
    사용연료:         PV5.사용연료,
    내연기관:         PV5.내연기관,
    차체길이_전:      String(PV5.차체_길이),
    차체길이_후:      String(PV5.차체_길이),
    차체너비_전:      String(PV5.차체_너비),
    차체너비_후:      String(PV5.차체_너비),
    차체높이_전:      String(PV5.차체_높이),
    차체높이_후:      '—',  // VIVAR 연동 후
    하대길이_전:      String(PV5.하대_길이),
    하대길이_후:      '—',
    하대너비_전:      String(PV5.하대_너비),
    하대너비_후:      '—',
    하대높이_전:      String(PV5.하대_높이),
    하대높이_후:      '—',
    하대옵셋_전:      String(PV5.하대옵셋),
    하대옵셋_후:      String(PV5.하대옵셋),
    공차전축_전:      String(PV5.공차_전축),
    공차전축_후:      String(result.curb.front_kg),
    공차후축_전:      String(PV5.공차_후축),
    공차후축_후:      String(result.curb.rear_kg),
    적차전축_전:      String(prevLoad.loaded.front_kg),
    적차전축_후:      String(result.loaded.front_kg),
    적차후축_전:      String(prevLoad.loaded.rear_kg),
    적차후축_후:      String(result.loaded.rear_kg),
    타이어율전축_전:  r1(prevLoad.tire_load_rate.loaded_front_pct),
    타이어율전축_후:  r1(result.tire_load_rate.loaded_front_pct),
    타이어율후축_전:  r1(prevLoad.tire_load_rate.loaded_rear_pct),
    타이어율후축_후:  r1(result.tire_load_rate.loaded_rear_pct),
    앞바퀴율_전:      r1(prevLoad.steering_axle_ratio_pct),
    앞바퀴율_후:      r1(result.steering_axle_ratio_pct),
    축간거리:         String(PV5.축간거리),
    제작허용총중량:    String(PV5.제작허용총중량),
    윤간거리_전:      String(PV5.윤간거리_전),
    윤간거리_후:      String(PV5.윤간거리_후),
    전동기형식:       PV5.전동기형식,
    전동기개수:       String(PV5.전동기개수),
    전동기출력:       PV5.전동기출력,
    배터리:           PV5.배터리,
    변속기:           PV5.변속기,
    주행거리:         PV5.주행거리,
    전비:             PV5.전비,
    타이어형식:       PV5.타이어형식,
    구동방식:         PV5.구동방식,
    모델연도:         vi.모델연도 ? esc(vi.모델연도) : String(PV5.모델연도),
    차대번호_18:      PV5.차대번호_18,
    튜닝개요:         esc(bom.tuning_summary),
    비고:             bom.extra_option_labels.length
                        ? esc(bom.extra_option_labels.join(', ') + ' 추가')
                        : '',
  };

  const html = TMPL_SPEC.replace(/\{\{([^}]+)\}\}/g, (m, k: string) => vars[k] ?? m);

  try {
    const pdf = await renderPdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(`주요제원대비표_주문${order.id}.pdf`)}`);
    res.end(pdf);
  } catch (e) {
    console.error('[GET docs/spec-table]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'PDF 생성 중 오류' } });
  }
});
