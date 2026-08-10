import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { fillContractDocx, countPdfPages, ContractDocError, isCorporateContract, type ContractTokens } from '../services/contract-docgen.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(__dirname, '../../..', 'doc-templates/contract-template.docx');

const TOKENS: ContractTokens = {
  contract_no: '26-0003', contract_date: '2026-08-06', contract_party: 'EV&Solution',
  buyer_name: '정재성', buyer_agent: '', buyer_relation: '', buyer_regno: '123-45-67890',
  company_name: '', ceo_name: '',   // 개인 계약 — 법인 줄은 공란

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

  it('매수인 이름이 서명란 3곳 + 성명칸 1곳 = 4번 인쇄된다', () => {
    const xml = docXml(fillContractDocx(template, TOKENS));
    expect((xml.match(/정재성/g) ?? []).length).toBe(4);
  });

  it('양식에 「서명」 라벨이 남아 있지 않다(이름 토큰으로 교체됨)', () => {
    // 라벨이 남아 있으면 고객이 손으로 쓸 칸으로 오해한다.
    expect(docXml(template)).not.toContain('<w:t>서명</w:t>');
  });

  it('법인 계약이면 회사명·대표이사가 채워진다', () => {
    const xml = docXml(fillContractDocx(template, {
      ...TOKENS, buyer_name: '(주)한빛물류', company_name: '(주)한빛물류', ceo_name: '민원기',
    }));
    expect(xml).toContain('민원기');
    expect(xml).not.toMatch(/\{\{\s*\w+\s*\}\}/);
  });

  it('개인 계약이면 회사명·대표이사는 공란이지만 줄(라벨)은 남는다', () => {
    const xml = docXml(fillContractDocx(template, TOKENS));   // company_name·ceo_name = ''
    expect(xml).toContain('회사명');
    expect(xml).toContain('대표이사');
    expect(xml).not.toMatch(/\{\{\s*(company_name|ceo_name)\s*\}\}/);
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
