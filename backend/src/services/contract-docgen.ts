/**
 * 특장 매매 및 구조변경 계약서 자동생성 — 주문 데이터 → 토큰 치환 docx → LibreOffice → PDF.
 *
 * 템플릿: doc-templates/contract-template.docx (레이아웃 수정 금지)
 * 스펙  : doc-templates/contract-template_데이터계약.md
 *   - 2~4p 계약조항은 2단 섹션 — 문단/섹션 경계 건드리지 않는다(토큰 텍스트만 치환).
 *   - 값이 길면 1p가 밀림 → 렌더 후 **페이지 수 4** 검증 필수.
 *
 * LibreOffice 함정 대응(§1):
 *   - 매 호출 임시 프로필 분리(-env:UserInstallation) → 동시 실행 충돌 방지
 *   - 타임아웃 30s
 *   - 출력 PDF가 남아있으면 변환이 조용히 실패하고 옛 파일이 남음 → 변환 전 삭제 + 변환 후 존재/크기/mtime 확인
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { prisma } from '../lib/prisma.js';
import { calcQuote } from '@buildup-ev/shared/pricing';
import { buildQuoteParams } from './quote-calc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const TEMPLATE_PATH = path.join(REPO_ROOT, 'doc-templates/contract-template.docx');

const SOFFICE_TIMEOUT_MS = 30_000;
const EXPECTED_PAGES = 4;
/**
 * 특약사항 권장 길이(경고선). 실측(Noto CJK 기준): 340자까지 4p 유지, 400자에서 5p 로 밀림.
 * 여유를 둬 300자 초과 시 경고하고, 실제 밀림은 아래 페이지 수 검증이 하드 게이트로 막는다.
 */
const SPECIAL_TERMS_SOFT_LIMIT = 300;

export class ContractDocError extends Error {
  constructor(message: string, public code: 'NOT_FOUND' | 'DB_UNAVAILABLE' | 'UNAVAILABLE' | 'RENDER_FAILED' = 'RENDER_FAILED') {
    super(message);
  }
}

/** 서류 저장 루트(배포 워크트리 밖). 프로덕션은 DOC_STORAGE_DIR 필수. */
function storageRoot(): string {
  const dir = process.env['DOC_STORAGE_DIR'];
  if (dir) return dir;
  if (process.env['NODE_ENV'] === 'production') {
    throw new ContractDocError('DOC_STORAGE_DIR 미설정(프로덕션 필수)', 'UNAVAILABLE');
  }
  return path.resolve(REPO_ROOT, '.local-doc-storage');
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new ContractDocError(`${cmd} 실행이 ${timeoutMs}ms 내에 끝나지 않았습니다`, 'UNAVAILABLE'));
    }, timeoutMs);
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT'
        ? new ContractDocError(`${cmd} 를 찾을 수 없습니다(서버 미설치)`, 'UNAVAILABLE')
        : err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new ContractDocError(`${cmd} 종료코드 ${code}: ${stderr.slice(0, 500)}`, 'RENDER_FAILED'));
    });
  });
}

/** PDF 페이지 수 — poppler 미설치 환경이라 파일에서 직접 계산. */
export function countPdfPages(pdf: Buffer): number {
  const byType = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  if (byType > 0) return byType;
  const m = pdf.toString('latin1').match(/\/Count\s+(\d+)/);
  return m ? Number(m[1]) : 0;
}

// ── 토큰 데이터 ────────────────────────────────────────────────────────────
export interface ContractTokens {
  contract_no: string; contract_date: string; contract_party: string;
  buyer_name: string; buyer_agent: string; buyer_relation: string; buyer_regno: string;
  buyer_address: string; buyer_tel: string; buyer_mobile: string; buyer_email: string;
  spec_body: string; spec_height: string; spec_spoiler: string; spec_temp: string;
  spec_door: string; spec_door_add: string; spec_partition: string;
  price_total: string; price_down: string; price_balance: string;
  special_terms: string; receipt_year: string;
}

// 옵션 선택값 → 계약서 표기(데이터계약 §2 값 예시). 하드코딩 금지 원칙에 따라 코드→표기 매핑만 둔다.
const BODY_DISP: Record<string, string> = { BODY_REEFER: '냉장/냉동', BODY_DRY: '내장' };
const HEIGHT_DISP: Record<string, string> = { TOP_LOW: '저상', TOP_STD: '표준' };
const DOOR_DISP: Record<string, string> = {
  DOOR_SWING: '여닫이', DOOR_SLIDE: '슬라이딩', DOOR_EVSLIDE: '미닫이',
  DOOR_COUPANG: '미닫이', DOOR_FOLD: '양문미닫이',
};
const PART_DISP: Record<string, string> = {
  PART_NET: '그물망', PART_REEFER: '냉장/냉동 이동식', PART_NONE: '없음',
};
const ox = (on: boolean) => (on ? 'O' : 'X');
const won = (n: number) => Math.round(n || 0).toLocaleString('ko-KR');

/** 주문 → 계약서 토큰. 옵션 선택값에서 자동 산출(하드코딩 금지). */
export async function buildContractTokens(orderId: number): Promise<ContractTokens> {
  if (!prisma) throw new ContractDocError('DB 연결 필요', 'DB_UNAVAILABLE');

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { quote: { include: { customer: true } } },
  });
  if (!order) throw new ContractDocError('주문을 찾을 수 없습니다', 'NOT_FOUND');

  const quote = order.quote;
  const customer = quote.customer;
  const sel = (quote.selections ?? {}) as Record<string, string>;
  const inp = (quote.inputs ?? {}) as Record<string, unknown>;

  const org = order.maker_org_id
    ? await prisma.org.findUnique({ where: { code: order.maker_org_id }, select: { name: true } })
    : null;

  // 금액은 총견적서 엔진(calcQuote)의 **특장 축** 단일 소스를 그대로 쓴다.
  // ⚠️ quote.supply_price 는 차량 트림까지 포함하므로 특장 계약서에 쓰면 안 된다.
  //    재량할인(프로모션)·지방보조금 토글도 여기서 함께 반영된다.
  const params = await buildQuoteParams(quote.model_code, sel, {
    biz_type: inp['biz_type'] as string | undefined,
    is_sosang: inp['is_sosang'] as boolean | undefined,
    region: inp['region'] as string | undefined,
    address: inp['address'] as string | undefined,
    has_transport_license: inp['has_transport_license'] as boolean | undefined,
    diesel_conversion: inp['diesel_conversion'] as boolean | undefined,
    has_biz_plate: inp['has_biz_plate'] as boolean | undefined,
    tax_exempt_type: inp['tax_exempt_type'] as string | undefined,
  }, {
    down_payment_rate: inp['down_payment_rate'] as number | undefined,
    installment_months: inp['installment_months'] as number | undefined,
    promotion_zeroed: inp['promotion_zeroed'] as string[] | undefined,
    local_subsidy_off: inp['local_subsidy_off'] as boolean | undefined,
  }, quote.created_at.getFullYear());
  const q = calcQuote(params);

  const priceTotal = q.body_payment;      // ⑦-⑧ 특장 결제 금액(VAT 포함)
  const priceDown = Math.min(q.body_deposit, priceTotal);  // 계약금(DB 상수)
  const priceBalance = Math.max(priceTotal - priceDown, 0);

  const d = order.created_at ?? new Date();
  const pad = (n: number) => String(n).padStart(2, '0');

  return {
    contract_no: quote.quote_no ?? `Q-${quote.id}`,
    contract_date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    contract_party: org?.name ?? '',
    buyer_name: customer?.name ?? '',
    buyer_agent: '',
    buyer_relation: '',
    buyer_regno: customer?.reg_no ?? '',
    buyer_address: customer?.address ?? '',
    buyer_tel: '',
    buyer_mobile: customer?.phone ?? '',
    buyer_email: customer?.email ?? '',
    spec_body: BODY_DISP[sel['BODYTYPE'] ?? ''] ?? '',
    spec_height: HEIGHT_DISP[sel['TOP'] ?? ''] ?? '',
    spec_spoiler: ox(sel['SPOILER'] === 'SPOILER_O'),
    spec_temp: ox(sel['TEMP'] === 'TEMP_O'),
    spec_door: DOOR_DISP[sel['DOORTYPE'] ?? ''] ?? '',
    spec_door_add: ox(sel['DOORADD'] === 'ADD_DRIVER'),
    spec_partition: PART_DISP[sel['PARTITION'] ?? ''] ?? '없음',
    price_total: won(priceTotal),
    price_down: won(priceDown),
    price_balance: won(priceBalance),
    special_terms: String(inp['memo'] ?? '').replace(/\s*\n+\s*/g, ' ').trim(),
    receipt_year: String(d.getFullYear()),
  };
}

/** 토큰 치환 → docx(Buffer). 템플릿 토큰은 단일 run 이라 분할 걱정 없음(검증 완료). */
export function fillContractDocx(template: Buffer, tokens: ContractTokens): Buffer {
  const zip = new PizZip(template);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: false,           // 줄바꿈은 페이지 밀림 원인 — special_terms 는 한 문단으로
    delimiters: { start: '{{', end: '}}' },
    nullGetter: () => '',
  });
  doc.render(tokens as unknown as Record<string, unknown>);
  const out = doc.getZip();

  // 미치환 토큰 검사는 **docx XML 기준**(PDF 바이너리는 압축 스트림 때문에 오탐이 난다).
  const xml = out.file('word/document.xml')?.asText() ?? '';
  const left = xml.match(/\{\{\s*\w+\s*\}\}/g);
  if (left?.length) {
    throw new ContractDocError(`미치환 토큰이 남아 있습니다: ${[...new Set(left)].join(', ')}`, 'RENDER_FAILED');
  }
  return out.generate({ type: 'nodebuffer' }) as Buffer;
}

/** docx → PDF. 프로필 분리 + 잠김 방지(변환 전 삭제, 후 갱신 확인). */
async function docxToPdf(docx: Buffer): Promise<Buffer> {
  const work = await mkdtemp(path.join(tmpdir(), 'contract-'));
  const profileDir = path.join(tmpdir(), `soffice_${randomUUID()}`);
  try {
    const inPath = path.join(work, 'contract_filled.docx');
    const outPath = path.join(work, 'contract_filled.pdf');
    await writeFile(inPath, docx);
    // ★ 옛 파일이 남아있으면 변환 실패가 조용히 묻힌다 — 항상 새 임시디렉터리지만 방어적으로 삭제
    await rm(outPath, { force: true });

    const startedAt = Date.now();
    await run('soffice', [
      '--headless', '--nologo', '--nofirststartwizard',
      `-env:UserInstallation=file://${profileDir}`,
      '--convert-to', 'pdf', '--outdir', work, inPath,
    ], SOFFICE_TIMEOUT_MS);

    // 변환 결과가 '이번 실행'으로 갱신됐는지 확인(크기·mtime)
    const st = await stat(outPath).catch(() => null);
    if (!st || st.size === 0) throw new ContractDocError('PDF 변환 실패(출력 없음)', 'RENDER_FAILED');
    if (st.mtimeMs + 1000 < startedAt) throw new ContractDocError('PDF 가 갱신되지 않음(옛 파일)', 'RENDER_FAILED');
    return await readFile(outPath);
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface ContractDocResult {
  pdf: Buffer; filePath: string; version: number; pages: number; warnings: string[];
}

/** 주문 → 계약서 PDF 생성·저장(GeneratedDocument type=contract, 버전 누적). */
export async function generateContractDoc(orderId: number): Promise<ContractDocResult> {
  if (!prisma) throw new ContractDocError('DB 연결 필요', 'DB_UNAVAILABLE');

  const tokens = await buildContractTokens(orderId);

  // 필수값 가드 — 빈 값은 docxtemplater 가 조용히 빈칸으로 치환하므로(토큰 잔존 검사로는 못 잡음)
  // 계약서로서 의미가 없는 공백 계약이 생성되지 않도록 여기서 막는다.
  const REQUIRED: (keyof ContractTokens)[] = ['contract_no', 'contract_date', 'buyer_name'];
  const missing = REQUIRED.filter((k) => !String(tokens[k] ?? '').trim());
  if (missing.length) {
    throw new ContractDocError(`계약서 필수 정보가 없습니다: ${missing.join(', ')} (고객 정보를 먼저 입력하세요)`, 'NOT_FOUND');
  }

  const warnings: string[] = [];
  if (tokens.special_terms.length > SPECIAL_TERMS_SOFT_LIMIT) {
    warnings.push(`특약사항이 ${tokens.special_terms.length}자로 길어 1페이지가 밀릴 수 있습니다(권장 ${SPECIAL_TERMS_SOFT_LIMIT}자 이내).`);
  }

  const template = await readFile(TEMPLATE_PATH);
  const filled = fillContractDocx(template, tokens);
  const pdf = await docxToPdf(filled);

  // ── 검증 ── (미치환 토큰은 fillContractDocx 에서 docx XML 기준으로 이미 검사됨)
  const pages = countPdfPages(pdf);
  if (pages !== EXPECTED_PAGES) {
    throw new ContractDocError(`페이지 수가 ${pages}p 입니다(기대 ${EXPECTED_PAGES}p — 값이 길어 밀렸을 수 있음)`, 'RENDER_FAILED');
  }

  // ── 저장(버전 누적) ──
  const last = await prisma.generatedDocument.findFirst({
    where: { order_id: orderId, type: 'contract' },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (last?.version ?? 0) + 1;
  const dir = path.join(storageRoot(), 'orders', String(orderId));
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `contract_v${version}.pdf`);
  await writeFile(filePath, pdf);
  await prisma.generatedDocument.create({
    data: { order_id: orderId, type: 'contract', version, file_path: filePath },
  });

  return { pdf, filePath, version, pages, warnings };
}
