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
const EXPECTED_PAGES = 3;
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
  /** 상단 「성명(상호/대표이사)」 칸. 개인=성명, 법인=상호. */
  buyer_name: string;
  buyer_agent: string; buyer_relation: string; buyer_regno: string;
  /**
   * 영수증·개인정보동의 서명란 2곳 = **실제로 와서 서명하는 사람**의 이름.
   * 개인이면 고객 본인, 법인이면 **대리인이 있으면 대리인, 없으면 대표이사**
   * — 법인도 대표이사가 직접 오는 경우가 더 흔해 대리인은 선택 입력이다.
   * (법인 줄의 대표이사는 ceo_name 으로 따로 인쇄된다)
   */
  signer_name: string;
  /**
   * 매수인 서명블록 **개인 줄**. 개인 계약일 때만 값이 들어가고 법인이면 공란.
   * (법인은 아래 회사명/대표이사 줄만 쓴다 — 두 줄 중 한 줄만 채운다)
   */
  buyer_personal_name: string;
  /**
   * 매수인 서명블록 **법인 줄**(회사명/대표이사). **법인사업자일 때만** 값이 들어간다.
   * 그 외(개인사업자·간이과세자·일반구매자)는 공란 — 줄 자체는 양식에 남아 있다.
   */
  company_name: string; ceo_name: string;
  buyer_address: string; buyer_tel: string; buyer_mobile: string; buyer_email: string;
  spec_body: string; spec_height: string; spec_spoiler: string; spec_temp: string;
  spec_door: string; spec_door_add: string; spec_partition: string;
  price_total: string; price_down: string; price_balance: string;
  special_terms: string;
  receipt_year: string; receipt_month: string; receipt_day: string;
  receipt_amount: string; receipt_payee: string;
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

/**
 * 법인사업자 계약인가. 매수인 서명블록의 「회사명/대표이사」 줄을 채울지,
 * 날인칸을 개인 줄과 법인 줄 중 어디에 놓을지를 이 판정 하나로 결정한다.
 * ⚠️ 저장되는 값은 프론트 mapBizType 이 변환한 'corporation' 이다('corporate' 아님).
 */
export function isCorporateContract(bizType: unknown): boolean {
  return bizType === 'corporation';
}

/**
 * 법인 계약에 반드시 있어야 하는 값 중 빠진 것 — 없으면 빈 배열.
 *
 * 법인 계약서에 꼭 필요한 값은 **상호 + 대표이사** 둘이다:
 *   · 대표이사(ceo_name) → 매수인 법인 줄에 인쇄되고,
 *     **대리인이 없으면 영수증·개인정보동의 서명란에도 대표이사가 들어간다**.
 * 그래서 대표이사만 있으면 서명란이 공란이 될 일이 없다.
 * ⚠️ 대리인(buyer_agent)은 **선택**이다 — 법인도 대표이사가 직접 오는 경우가 더 흔하다.
 * (개인 계약은 해당 없음 — 회사명이 비어 있으면 빈 배열)
 */
export function missingCorporateFields(
  t: Pick<ContractTokens, 'company_name' | 'ceo_name'>,
): string[] {
  if (!t.company_name.trim()) return [];
  return t.ceo_name.trim() ? [] : ['대표이사'];
}

/**
 * 토큰만 보고 법인 계약인지 판정 — 렌더 단계는 견적 입력(biz_type)에 접근하지 않는다.
 * 회사명은 법인일 때만 채워지므로(buildContractTokensFromQuote) 이것으로 충분하다.
 * 서명블록에서 법인 줄을 남길지, 날인칸을 몇 개 기대할지가 여기서 갈린다.
 */
export function isCorporateTokens(t: Pick<ContractTokens, 'company_name'>): boolean {
  return Boolean(t.company_name.trim());
}

/** 주문 → 계약서 토큰. 주문은 견적을 가리키는 껍데기이므로 견적 기준 함수로 위임. */
export async function buildContractTokens(orderId: number): Promise<ContractTokens> {
  if (!prisma) throw new ContractDocError('DB 연결 필요', 'DB_UNAVAILABLE');
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { quote_id: true } });
  if (!order) throw new ContractDocError('주문을 찾을 수 없습니다', 'NOT_FOUND');
  return buildContractTokensFromQuote(order.quote_id);
}

/**
 * 견적 → 계약서 토큰. 옵션 선택값에서 자동 산출(하드코딩 금지).
 *
 * 계약서는 **주문 전환 전** 영업 단계(견적서 생성/확정)에서 함께 만들어지므로
 * 주문이 아니라 견적이 기준이다. 팝업에서 입력한 계약 정보는 quote.inputs 에 저장된다.
 */
export async function buildContractTokensFromQuote(quoteId: number): Promise<ContractTokens> {
  if (!prisma) throw new ContractDocError('DB 연결 필요', 'DB_UNAVAILABLE');

  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { customer: true, sales_user: { select: { name: true } } },
  });
  if (!quote) throw new ContractDocError('견적을 찾을 수 없습니다', 'NOT_FOUND');

  const customer = quote.customer;
  const sel = (quote.selections ?? {}) as Record<string, string>;
  const inp = (quote.inputs ?? {}) as Record<string, unknown>;
  const isCorp = isCorporateContract(inp['biz_type']);
  const ceoName = String(inp['ceo_name'] ?? '').trim();
  const agentName = String(inp['buyer_agent'] ?? '').trim();


  // 금액은 총견적서 엔진(calcQuote)의 **특장 축** 단일 소스를 그대로 쓴다.
  // ⚠️ quote.supply_price 는 차량 트림까지 포함하므로 특장 계약서에 쓰면 안 된다.
  //    재량할인(프로모션)·지방보조금 토글도 여기서 함께 반영된다.
  const params = await buildQuoteParams(quote.model_code, sel, {
    biz_type: inp['biz_type'] as string | undefined,
    is_sosang: inp['is_sosang'] as boolean | undefined,
    region: inp['region'] as string | undefined,
    address: inp['address'] as string | undefined,
    has_transport_license: inp['has_transport_license'] as boolean | undefined,
    diesel_status: inp['diesel_status'] as string | undefined,
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

  // 계약서의 모든 날짜는 **견적서 생성 날짜**(견적 생성일) 기준 — 견적서와 어긋나지 않게.
  const d = quote.created_at ?? new Date();
  const pad = (n: number) => String(n).padStart(2, '0');

  return {
    contract_no: quote.quote_no ?? `Q-${quote.id}`,
    contract_date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    contract_party: String(inp['contract_party'] ?? ''),   // 특장사 아님 — 팝업 입력
    buyer_name: customer?.name ?? '',
    // ── 매수인 서명란 ──
    // 법인은 고객명 칸에 **상호**를 받고, 대표이사는 별도 입력값(inputs.ceo_name)이다.
    // 서명란마다 들어갈 이름이 달라 토큰을 나눠 둔다.
    //   · 영수증·개인정보동의 = 실제 서명자   → 개인은 본인, 법인은 대표이사
    //   · 매수인 블록은 **개인 줄·법인 줄 중 한 줄만** 채운다(나머지 줄은 완전히 공란)
    // 법인 서명자 = 대리인이 왔으면 대리인, 아니면 대표이사 본인.
    signer_name: isCorp ? (agentName || ceoName) : (customer?.name ?? ''),
    buyer_personal_name: isCorp ? '' : (customer?.name ?? ''),
    company_name: isCorp ? (customer?.name ?? '') : '',
    ceo_name: isCorp ? ceoName : '',
    buyer_agent: agentName,
    buyer_relation: String(inp['buyer_relation'] ?? ''),
    buyer_regno: String(inp['buyer_regno'] ?? customer?.reg_no ?? ''),
    // 주소 = 지역(시/도·시군구) + 세부주소 — 계약서엔 전체 주소가 필요
    buyer_address: [inp['region'], customer?.address].filter(Boolean).join(' ').trim(),
    buyer_tel: String(inp['buyer_tel'] ?? ''),
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
    receipt_month: String(d.getMonth() + 1),
    receipt_day: String(d.getDate()),
    receipt_amount: won(priceDown),                        // 영수증 = 계약금 금액
    receipt_payee: quote.sales_user?.name ?? '',           // 영수인 = 견적 담당
  };
}

/**
 * 표의 한 행(`w:tr`)을 통째로 제거한다 — marker 를 품은 가장 안쪽 행이 대상.
 *
 * docxtemplater 의 조건부 블록 대신 XML 에서 직접 지우는 이유:
 * 조건부는 문단·행 경계에 태그를 심어야 해서 레이아웃에 어떤 영향이 갈지 예측이 어렵다.
 * 행을 통째로 들어내면 결과가 눈에 보이는 그대로다.
 *
 * ⚠️ 매수인 서명 소표의 행은 안에 또 다른 표가 없다(중첩 없음) — 그래서 marker 앞뒤의
 *    가장 가까운 `<w:tr …>` / `</w:tr>` 짝이 곧 그 행이다. 중첩이 생기면 이 가정이 깨지므로
 *    잘라낸 조각에 여는 `<w:tr` 이 또 있으면 예외를 던진다.
 */
/** marker 를 품은 가장 안쪽 표 행의 [시작, 끝) 범위. dropTableRow·blankTableRow 공용. */
function findRowRange(xml: string, marker: string): [number, number] {
  const at = xml.indexOf(marker);
  if (at < 0) throw new ContractDocError(`양식에서 «${marker}» 를 찾지 못했습니다`, 'RENDER_FAILED');

  // ⚠️ `<w:tr` 로 그냥 찾으면 **`<w:trPr`(행 속성) 에도 걸린다** — 그러면 행 한가운데를
  //    잘라 문서가 깨진다(실제로 깨뜨렸다). 뒤에 공백이나 '>' 가 오는 것만 행 시작이다.
  const OPEN_TR = /<w:tr(?=[\s>])/g;
  let open = -1;
  for (let m = OPEN_TR.exec(xml); m && m.index < at; m = OPEN_TR.exec(xml)) open = m.index;

  const closeAt = xml.indexOf('</w:tr>', at);
  if (open < 0 || closeAt < 0) {
    throw new ContractDocError(`«${marker}» 를 감싸는 표 행을 찾지 못했습니다`, 'RENDER_FAILED');
  }
  const end = closeAt + '</w:tr>'.length;
  if (/<w:tr(?=[\s>])/.test(xml.slice(open + 1, end))) {
    throw new ContractDocError(`«${marker}» 행에 중첩 표가 있어 안전하게 다룰 수 없습니다`, 'RENDER_FAILED');
  }
  return [open, end];
}

/**
 * 행은 남기되 **글자만 지운다** — 칸 높이·테두리는 유지하고 내용만 공란으로.
 * 법인 계약의 매수인 개인 줄이 이 경우다. 줄을 없애면 서명블록 높이가 달라지고,
 * 라벨(「서명 (인)」)을 남겨두면 서명하는 자리로 오해한다.
 */
function blankTableRow(xml: string, marker: string): string {
  const [open, end] = findRowRange(xml, marker);
  const row = xml.slice(open, end).replace(/(<w:t(?:\s[^>]*)?>)[^<]*(<\/w:t>)/g, '$1$2');
  return xml.slice(0, open) + row + xml.slice(end);
}

function dropTableRow(xml: string, marker: string): string {
  const [open, end] = findRowRange(xml, marker);
  return xml.slice(0, open) + xml.slice(end);
}

/**
 * 토큰 치환 → docx(Buffer). 템플릿 토큰은 단일 run 이라 분할 걱정 없음(검증 완료).
 *
 * 매수인 서명블록은 두 줄(법인 줄이 위, 개인 줄이 아래)인데,
 * **개인 계약이면 법인 줄을 통째로 지운다** — 빈 「회사명 / 대표이사 / 서명 (인)」 이 남으면
 * 고객이 어디에 서명해야 하는지 헷갈린다.
 * 법인이면 개인 줄은 **남기되 글자를 지운다**(줄은 유지, 내용만 공란).
 * 사용자가 "개인 줄은 숨기지 말라" 고 했지만 「서명 (인)」 라벨이 남아 공란이 아니었다.
 */
export function fillContractDocx(template: Buffer, tokens: ContractTokens): Buffer {
  const zip = new PizZip(template);

  const xml0 = zip.file('word/document.xml')?.asText() ?? '';
  zip.file('word/document.xml', isCorporateTokens(tokens)
    // 법인 — 개인 줄은 남기되(서명블록 높이 유지) 「서명 (인)」 라벨까지 지워 진짜 공란으로.
    //        라벨이 남아 있으면 서명하는 자리로 오해한다.
    ? blankTableRow(xml0, '{{buyer_personal_name}}')
    // 개인 — 법인 줄은 통째로 지운다. 빈 「회사명 / 대표이사」 가 남으면 헷갈린다.
    : dropTableRow(xml0, '{{company_name}}'));

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

/** 토큰 → PDF (검증 포함, 저장 없음). 주문 저장본과 견적 미리보기가 공유하는 렌더 경로. */
async function renderFromTokens(tokens: ContractTokens): Promise<{ pdf: Buffer; pages: number; warnings: string[] }> {
  // 필수값 가드 — 빈 값은 docxtemplater 가 조용히 빈칸으로 치환하므로(토큰 잔존 검사로는 못 잡음)
  // 계약서로서 의미가 없는 공백 계약이 생성되지 않도록 여기서 막는다.
  const missingCorp = missingCorporateFields(tokens);
  if (missingCorp.length) {
    throw new ContractDocError(
      `법인 계약서에 필요한 값이 없습니다: ${missingCorp.join(', ')} — 고객 정보에서 입력하세요. `
      + '(대표이사는 매수인 법인 줄에 인쇄되고, 대리인이 없으면 서명란에도 대표이사가 들어갑니다)',
      'NOT_FOUND',
    );
  }
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

  // 페이지 수는 **경고**로만 다룬다. 값 길이에 따라 밀릴 수 있는데, 여기서 throw 하면
  // 계약서를 열어보지도 못한 채 막혀 원인 파악이 불가능해진다(미치환 토큰은 별도 하드 게이트).
  const pages = countPdfPages(pdf);
  if (pages !== EXPECTED_PAGES) {
    warnings.push(`페이지 수가 ${pages}p 입니다(기대 ${EXPECTED_PAGES}p — 입력값이 길어 밀렸을 수 있습니다).`);
  }
  return { pdf, pages, warnings };
}

/** 견적 → 계약서 PDF (즉석 렌더, 저장 없음). 영업페이지 미리보기·이메일 첨부용. */
export async function renderContractPdfForQuote(quoteId: number): Promise<{ pdf: Buffer; filename: string; pages: number; warnings: string[] }> {
  const tokens = await buildContractTokensFromQuote(quoteId);
  const { pdf, pages, warnings } = await renderFromTokens(tokens);
  const who = tokens.buyer_name ? `_${tokens.buyer_name}` : '';
  return { pdf, filename: `특장매매계약서_${tokens.contract_no}${who}.pdf`, pages, warnings };
}

/** 주문 → 계약서 PDF 생성·저장(GeneratedDocument type=contract, 버전 누적). */
export async function generateContractDoc(orderId: number): Promise<ContractDocResult> {
  if (!prisma) throw new ContractDocError('DB 연결 필요', 'DB_UNAVAILABLE');

  const tokens = await buildContractTokens(orderId);
  const { pdf, pages, warnings } = await renderFromTokens(tokens);

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
