/**
 * 튜닝 승인 신청서 PDF 생성 + 서명란 좌표.
 *
 * 양식은 `doc-templates/tuning-apply-template.html` — 법정 서식([별지 제33호서식])이라
 * 칸을 늘리거나 순서를 바꾸지 않는다. 원본은 같은 폴더의 `tuning-apply-form.png`.
 */
import { readFile } from 'node:fs/promises';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../lib/prisma.js';
import { htmlToPdf } from '../lib/soffice.js';
import type { SignField } from './modusign.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.resolve(HERE, '../../../doc-templates/tuning-apply-template.html');
const SPEC_PATH = path.resolve(HERE, '../../../doc-templates/pv5-spec.json');

export class TuningFormError extends Error {
  constructor(message: string, readonly missing: string[] = []) { super(message); }
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));
}

/** 신청서에 실을 값 한 벌. */
export interface TuningFormData {
  applicant: { name: string; reg_no: string; tel: string; phone: string; address: string; signer: string };
  vehicle: { model_name: string; type_name: string; engine_type: string; plate_no: string; vin: string };
  tuning: { device: string; detail: string };
  apply: { year: string; month: string; day: string };
}

/**
 * 주문 → 신청서 값.
 *
 * **신청인은 자동차등록증상 소유자다**(자동차관리법 제34조 — 튜닝 승인은 자동차소유자가 신청).
 * 견적서상 고객이 아니라 `vehicle_info.소유자성명·소유자주소` 를 쓴다. 보통 같은 사람이지만,
 * 명의가 다르면 등록증이 정본이다 — 관청은 등록증을 본다.
 *
 * 연락처는 견적 고객의 것을 쓴다. 등록증에는 연락처가 없어 달리 알 길이 없다.
 */
export async function buildTuningFormData(orderId: number): Promise<TuningFormData> {
  if (!prisma) throw new TuningFormError('DB 연결 필요');
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { quote: { include: { customer: true } } },
  });
  if (!order) throw new TuningFormError('주문을 찾을 수 없습니다');

  const vi = (order.vehicle_info ?? {}) as Record<string, unknown>;
  const v = (k: string) => (vi[k] == null ? '' : String(vi[k]).trim());
  const spec = JSON.parse(await readFile(SPEC_PATH, 'utf-8')) as Record<string, unknown>;
  const eng = (spec['원동기'] ?? {}) as Record<string, unknown>;
  const cust = order.quote.customer;

  /*
   * 관청에 내는 서류라 **빈칸으로 내보내지 않는다.** 등록증 정보가 아직 안 들어왔으면
   * 신청서를 만들 수 없다 — 여기서 막지 않으면 고객이 빈 신청서에 서명하게 된다.
   */
  const missing: string[] = [];
  if (!v('소유자성명')) missing.push('소유자성명');
  if (!v('소유자주소')) missing.push('소유자주소');
  if (!v('등록번호'))   missing.push('등록번호');
  if (!v('차대번호'))   missing.push('차대번호');
  if (missing.length) {
    throw new TuningFormError(
      `자동차등록증 정보가 아직 입력되지 않았습니다 — ${missing.join(' · ')}. `
      + '주문 상세의 「차량정보 입력」에서 채운 뒤 발송하세요.',
      missing,
    );
  }

  const now = new Date();
  return {
    applicant: {
      name: v('소유자성명'),
      // 등록증에는 생년월일·사업자번호가 없다 — 견적에서 받아 둔 값이 있으면 채운다
      reg_no: cust?.reg_no ?? '',
      tel: cust?.tel ?? '',
      phone: cust?.phone ?? '',
      address: v('소유자주소'),
      signer: v('소유자성명'),
    },
    vehicle: {
      model_name: String(spec['차명'] ?? ''),
      type_name: v('형식코드') || String(spec['형식코드'] ?? ''),
      engine_type: String(eng['구동전동기_형식'] ?? ''),
      plate_no: v('등록번호'),
      vin: v('차대번호'),
    },
    tuning: {
      // 물품적재장치 = 탑·적재함을 바꾸는 특장. 다른 장치를 튜닝하면 여기가 달라진다(유의사항 2).
      device: '물품적재장치',
      detail: await tuningDetail(orderId),
    },
    apply: {
      year: String(now.getFullYear()),
      month: String(now.getMonth() + 1),
      day: String(now.getDate()),
    },
  };
}

/**
 * 튜닝내용 한 줄 — 제원대비표가 쓰는 「탈거/설치」 문구와 같은 출처를 쓴다.
 * 두 서류가 다른 말을 하면 관청이 되묻는다.
 */
async function tuningDetail(orderId: number): Promise<string> {
  try {
    const { buildTuningSummary } = await import('./docgen.js') as
      { buildTuningSummary?: (id: number) => Promise<string> };
    if (buildTuningSummary) return await buildTuningSummary(orderId);
  } catch { /* 아래 기본값 */ }
  return '';
}

/** 값 → 신청서 PDF. */
export async function renderTuningFormPdf(orderId: number): Promise<Buffer> {
  const data = await buildTuningFormData(orderId);
  const tpl = await readFile(TEMPLATE_PATH, 'utf-8');
  const flat: Record<string, string> = {};
  for (const [group, obj] of Object.entries(data)) {
    for (const [k, val] of Object.entries(obj as Record<string, string>)) flat[`${group}.${k}`] = val;
  }
  const html = tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => esc(flat[key] ?? ''));
  return htmlToPdf(html);
}

// ── 서명란 좌표 ──────────────────────────────────────────────────────────────

/**
 * 서명 위치를 찾는 앵커. 양식의 「(서명 또는 인)」 중 **'서명'** 한 단어를 쓴다.
 * 실측: pdftotext 가 이 문서에서 '서명' 을 **딱 하나** 뽑는다(표의 '신청인' 은 두 개라 못 쓴다).
 * 양식에서 이 문구가 사라지면 서명란을 못 잡는다.
 */
const ANCHOR = '서명';

interface Word { page: number; x0: number; y0: number; text: string }

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { c.kill('SIGKILL'); reject(new Error(`${cmd} 시간 초과`)); }, 20_000);
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('error', reject);
    c.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(`${cmd} 종료코드 ${code}: ${err.slice(0, 500)}`));
    });
  });
}

/**
 * 신청서 PDF → 서명란 1곳.
 *
 * @returns 항상 1개. 못 찾으면 **빈 배열** — 서명란 없는 신청서를 보내면 안 되므로
 *          호출부(modusign.sendDocument)가 발송을 거부하게 한다(계약서와 같은 규칙).
 */
export async function findTuningSignFields(pdf: Buffer): Promise<SignField[]> {
  const dir = await mkdtemp(path.join(tmpdir(), 'tuningsign-'));
  try {
    const p = path.join(dir, 't.pdf');
    await writeFile(p, pdf);
    const xml = await run('pdftotext', ['-bbox', p, '-']);

    const pages: { w: number; h: number }[] = [];
    for (const m of xml.matchAll(/<page width="([\d.]+)" height="([\d.]+)"/g)) {
      pages.push({ w: Number(m[1]), h: Number(m[2]) });
    }
    const words: Word[] = [];
    let page = 0;
    for (const line of xml.split('\n')) {
      if (line.includes('<page ')) page += 1;
      const m = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">(.*?)<\/word>/.exec(line);
      if (m) words.push({ page, x0: Number(m[1]), y0: Number(m[2]), text: (m[3] ?? '').trim() });
    }

    const hits = words.filter((w) => w.text === ANCHOR);
    if (hits.length !== 1) {
      console.error(`[tuning-form] 서명 앵커 '${ANCHOR}' 가 ${hits.length}개입니다(1개 기대). `
        + '양식(tuning-apply-template.html)에서 「(서명 또는 인)」 이 바뀌었는지 확인하세요.');
      return [];
    }
    const a = hits[0]!;
    const pg = pages[a.page - 1];
    if (!pg?.w || !pg?.h) {
      console.error(`[tuning-form] 페이지 크기를 알 수 없어 비율을 낼 수 없습니다(p${a.page}).`);
      return [];
    }
    // 모두싸인은 pt 가 아니라 **페이지 대비 0~1 비율**로 받는다(계약서와 같다).
    return [{ kind: 'SIGN', page: a.page, x: a.x0 / pg.w, y: a.y0 / pg.h }];
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
