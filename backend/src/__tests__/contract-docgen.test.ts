import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { fillContractDocx, countPdfPages, ContractDocError, isCorporateContract, missingCorporateFields, type ContractTokens } from '../services/contract-docgen.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(__dirname, '../../..', 'doc-templates/contract-template.docx');

const TOKENS: ContractTokens = {
  contract_no: '26-0003', contract_date: '2026-08-06', contract_party: 'EV&Solution',
  buyer_name: '정재성', buyer_agent: '', buyer_relation: '', buyer_regno: '123-45-67890',
  // 개인 계약 — 서명자=본인, 개인 줄만 채우고 법인 줄은 공란
  signer_name: '정재성', buyer_personal_name: '정재성', company_name: '', ceo_name: '',
  buyer_address: '경기도 군포시 산본로 100', buyer_tel: '031-000-0000',
  buyer_mobile: '010-1234-5678', buyer_email: 'test@example.com',
  spec_body: '냉장/냉동', spec_height: '저상', spec_spoiler: 'X', spec_temp: 'O',
  spec_door: '슬라이딩', spec_door_add: 'O', spec_partition: '냉장/냉동 이동식',
  price_total: '21,619,000', price_down: '400,000', price_balance: '21,219,000',
  special_terms: '서비스: 블랙박스, 썬팅',
  receipt_year: '2026', receipt_month: '8', receipt_day: '6',
  receipt_amount: '400,000', receipt_payee: '마스터관리자',
};

function docXml(buf: Buffer): string {
  return new PizZip(buf).file('word/document.xml')?.asText() ?? '';
}

describe('계약서 토큰 치환 (contract-template.docx)', () => {
  const template = readFileSync(TEMPLATE);

  /**
   * 법인 계약 토큰 — 상호는 buyer_name·company_name, 법인 줄은 대표이사,
   * **서명란 2곳은 대리인**(법인은 대리인이 와서 서명한다).
   */
  const CORP: ContractTokens = {
    ...TOKENS, buyer_name: '(주)한빛물류',
    signer_name: '박대리', buyer_agent: '박대리', buyer_personal_name: '',
    company_name: '(주)한빛물류', ceo_name: '민원기',
  };

  it('모든 토큰이 치환되어 {{ }} 가 남지 않는다', () => {
    const xml = docXml(fillContractDocx(template, TOKENS));
    expect(xml).not.toMatch(/\{\{\s*\w+\s*\}\}/);
  });

  it('치환 값이 문서에 실제로 들어간다', () => {
    const xml = docXml(fillContractDocx(template, TOKENS));
    for (const v of ['26-0003', '정재성', '123-45-67890', '21,619,000', '400,000', '슬라이딩']) {
      expect(xml).toContain(v);
    }
  });

  it('빈 값(대리인·관계)은 빈 문자열로 치환되고 토큰이 남지 않는다', () => {
    const xml = docXml(fillContractDocx(template, TOKENS));
    expect(xml).not.toContain('buyer_agent');
    expect(xml).not.toContain('buyer_relation');
  });

  it('연도 토큰이 영수증·개인정보동의 2곳 모두 치환된다', () => {
    const xml = docXml(fillContractDocx(template, { ...TOKENS, receipt_year: '2031' }));
    expect(xml).not.toContain('receipt_year');
    expect((xml.match(/2031/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('영수증에 계약금 금액·영수인이 들어간다', () => {
    const xml = docXml(fillContractDocx(template, TOKENS));
    expect(xml).toContain('400,000');
    expect(xml).toContain('마스터관리자');
  });

  it('계약처는 비워둘 수 있다(특장사 자동기입 아님)', () => {
    const xml = docXml(fillContractDocx(template, { ...TOKENS, contract_party: '' }));
    expect(xml).not.toMatch(/\{\{\s*contract_party\s*\}\}/);
  });

  it('2단 섹션 구조(계약조항 2~4p)가 보존된다', () => {
    const before = docXml(template);
    const after = docXml(fillContractDocx(template, TOKENS));
    const cols = (s: string) => (s.match(/<w:cols[^>]*w:num="2"/g) ?? []).length;
    const sect = (s: string) => (s.match(/<w:sectPr/g) ?? []).length;
    expect(cols(after)).toBe(cols(before));
    expect(sect(after)).toBe(sect(before));
  });

  // ── 매수인 서명란(전자서명 개편) ────────────────────────────────────────
  // 모두싸인이 한 서명자에게 서명·도장 두 종류를 허용하지 않아, **이름은 인쇄**하고
  // 전자서명으로는 `(인)` 날인만 받는다. 그래서 「서명」 라벨 자리에 이름이 찍혀야 한다.

  it('개인 계약: 본인 이름이 성명칸 + 서명란 3곳 = 4번 인쇄된다', () => {
    const xml = docXml(fillContractDocx(template, TOKENS));
    expect((xml.match(/정재성/g) ?? []).length).toBe(4);
  });

  // 「서명」 라벨은 sign-positions.ts 가 날인 좌표를 잡는 기준이다.
  // 개수가 달라지면 서명란을 못 찾아 발송이 막히므로 여기서 고정한다.
  it('법인 계약: 「서명」 라벨 3곳 — 안 쓰는 개인 줄은 글자가 지워진다', () => {
    // 날인 좌표(sign-positions)가 이 라벨 개수를 기준으로 잡는다. 개인 계약과 같아야 한다.
    const xml = docXml(fillContractDocx(template, CORP));
    expect((xml.match(/서명/g) ?? []).length).toBe(3);
  });

  it('개인 계약: 법인 줄이 사라져 「서명」 라벨 3곳', () => {
    const xml = docXml(fillContractDocx(template, TOKENS));
    expect((xml.match(/서명/g) ?? []).length).toBe(3);
  });

  // ── 매수인 블록은 개인 줄·법인 줄 중 **한 줄만** 쓴다 ──────────────────

  it('개인 계약: 매수인 법인 줄(회사명/대표이사)이 통째로 사라진다', () => {
    // 빈 「회사명 / 대표이사 / 서명 (인)」 이 남으면 어디에 서명할지 헷갈린다.
    const xml = docXml(fillContractDocx(template, TOKENS));
    expect(xml).not.toContain('회사명');
    expect(xml).not.toMatch(/\{\{\s*(company_name|ceo_name)\s*\}\}/);
    // 매도인 줄의 「대표이사」는 남아 있어야 한다(지운 건 매수인 법인 줄뿐)
    expect(xml).toContain('대표이사       민  원  기 ');
  });

  it('법인 계약: 개인 줄은 행을 남기되 글자를 비운다(라벨까지 제거)', () => {
    // 행을 지우면 서명블록 높이가 달라지고, 「서명 (인)」 라벨을 남기면
    // 서명하는 자리로 오해한다 — 그래서 행은 두고 내용만 지운다.
    const xml = docXml(fillContractDocx(template, CORP));
    expect(xml).toContain('회사명');                       // 법인 줄은 그대로
    expect((xml.match(/서명/g) ?? []).length).toBe(3);     // 개인 줄 라벨은 사라짐
    // ⚠️ '(인)' 은 XML 에서 '(' / '인' / ')' 세 run 으로 쪼개져 있어 문자열로 못 센다.
    //    행이 남아 있는지는 표 행 개수로 본다(글자만 지웠으므로 개수는 그대로).
    const rows = (xml.match(/<w:tr(?=[\s>])/g) ?? []).length;
    const personalRows = (docXml(fillContractDocx(template, TOKENS)).match(/<w:tr(?=[\s>])/g) ?? []).length;
    expect(rows).toBe(personalRows + 1);   // 개인 계약은 법인 줄을 아예 지우므로 한 행 적다
  });

  it('법인 계약: 상호·대표이사가 채워지고 개인 줄 서명란은 비어 있다', () => {
    const xml = docXml(fillContractDocx(template, CORP));
    expect(xml).toContain('(주)한빛물류');
    expect(xml).toContain('민원기');
    expect(xml).not.toMatch(/\{\{\s*\w+\s*\}\}/);
    // 상호는 상단 성명칸 + 법인 줄 회사명 = 2번만. 서명란에 상호가 찍히면 안 된다.
    expect((xml.match(/\(주\)한빛물류/g) ?? []).length).toBe(2);
  });

  it('법인 + 대리인 있음: 서명자는 대리인 — 서명란 2곳 + 대리인칸 = 3번', () => {
    // 대리인이 와서 서명하는 경우. 대표이사는 매수인 법인 줄에만 인쇄된다.
    const xml = docXml(fillContractDocx(template, CORP));
    expect((xml.match(/박대리/g) ?? []).length).toBe(3);
    expect((xml.match(/민원기/g) ?? []).length).toBe(1);
  });

  it('법인 + 대리인 없음: 서명자는 대표이사 — 서명란 2곳 + 법인 줄 = 3번', () => {
    // 법인도 대표이사가 직접 오는 경우가 더 흔하다. 대리인칸은 공란으로 남는다.
    const xml = docXml(fillContractDocx(template, {
      ...CORP, buyer_agent: '', signer_name: '민원기',   // buildContractTokensFromQuote 의 대체 규칙
    }));
    expect((xml.match(/민원기/g) ?? []).length).toBe(3);
    expect(xml).not.toContain('박대리');
  });

  it('매도인 날인줄(이브이앤솔루션 대표이사)은 법인 계약에서도 보존된다', () => {
    expect(docXml(fillContractDocx(template, CORP))).toContain('대표이사       민  원  기 ');
  });

  it('매도인 날인줄(이브이앤솔루션 대표이사)은 토큰 치환과 무관하게 보존된다', () => {
    // 매수인 블록의 「대표이사」와 글자가 같아 실수로 함께 바뀌기 쉬운 자리다.
    for (const buf of [template, fillContractDocx(template, TOKENS)]) {
      expect(docXml(buf)).toContain('대표이사       민  원  기 ');
    }
  });

  it('특수문자(&, <)가 들어가도 XML 이 깨지지 않는다', () => {
    const buf = fillContractDocx(template, { ...TOKENS, buyer_name: 'A & B <주식회사>' });
    const xml = docXml(buf);
    expect(xml).toContain('&amp;');
    expect(xml).not.toContain('<주식회사>');
  });
});

describe('PDF 페이지 수 계산 (poppler 미설치 환경 대체)', () => {
  it('/Type /Page 로 페이지를 센다', () => {
    const fake = Buffer.from('%PDF-1.4\n/Type /Page \n/Type /Page \n/Type /Pages \n');
    expect(countPdfPages(fake)).toBe(2);
  });

  it('/Type /Page 가 없으면 /Count 로 대체한다', () => {
    const fake = Buffer.from('%PDF-1.4\n/Type /Pages /Count 4\n');
    expect(countPdfPages(fake)).toBe(4);
  });
});

describe('법인 필수값 가드 (missingCorporateFields)', () => {
  const CO = '(주)한빛물류';
  it('대표이사가 비면 막는다 — 법인 줄도 서명란도 공란이 된다', () => {
    expect(missingCorporateFields({ company_name: CO, ceo_name: '' })).toEqual(['대표이사']);
    expect(missingCorporateFields({ company_name: CO, ceo_name: '   ' })).toEqual(['대표이사']);
  });
  it('상호+대표이사만 있으면 통과 — **대리인은 선택**이다', () => {
    // 대리인이 없으면 서명란에 대표이사가 들어가므로 공란이 되지 않는다.
    expect(missingCorporateFields({ company_name: CO, ceo_name: '민원기' })).toEqual([]);
  });
  it('개인 계약(회사명 공란)은 대표이사가 없어도 정상', () => {
    expect(missingCorporateFields({ company_name: '', ceo_name: '' })).toEqual([]);
  });
});

describe('법인 판정 (isCorporateContract)', () => {
  it("저장값 'corporation' 만 법인이다", () => {
    expect(isCorporateContract('corporation')).toBe(true);
  });
  it('그 외 구분·미입력은 개인으로 본다', () => {
    // ⚠️ 프론트 표기는 'corporate' 지만 저장 전 mapBizType 이 'corporation' 으로 바꾼다.
    //    저장값 기준으로만 판정해야 개인/법인 날인 위치가 어긋나지 않는다.
    for (const v of ['individual', 'simplified', 'consumer', 'corporate', '', undefined, null]) {
      expect(isCorporateContract(v)).toBe(false);
    }
  });
});

describe('ContractDocError', () => {
  it('기본 코드는 RENDER_FAILED', () => {
    expect(new ContractDocError('x').code).toBe('RENDER_FAILED');
  });
});

describe('빈 값 처리', () => {
  const template = readFileSync(TEMPLATE);

  it('빈 값은 토큰을 남기지 않고 빈칸으로 치환된다(수기 기입란)', () => {
    const xml = docXml(fillContractDocx(template, { ...TOKENS, buyer_agent: '', buyer_tel: '' }));
    expect(xml).not.toMatch(/\{\{\s*\w+\s*\}\}/);
  });
});
