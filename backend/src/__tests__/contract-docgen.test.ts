import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { fillContractDocx, countPdfPages, ContractDocError, type ContractTokens } from '../services/contract-docgen.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(__dirname, '../../..', 'doc-templates/contract-template.docx');

const TOKENS: ContractTokens = {
  contract_no: '26-0003', contract_date: '2026-08-06', contract_party: 'EV&Solution',
  buyer_name: '정재성', buyer_agent: '', buyer_relation: '', buyer_regno: '123-45-67890',
  buyer_address: '경기도 군포시 산본로 100', buyer_tel: '031-000-0000',
  buyer_mobile: '010-1234-5678', buyer_email: 'test@example.com',
  spec_body: '냉장/냉동', spec_height: '저상', spec_spoiler: 'X', spec_temp: 'O',
  spec_door: '슬라이딩', spec_door_add: 'O', spec_partition: '냉장/냉동 이동식',
  price_total: '21,619,000', price_down: '400,000', price_balance: '21,219,000',
  special_terms: '서비스: 블랙박스, 썬팅', receipt_year: '2026',
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

  it('2단 섹션 구조(계약조항 2~4p)가 보존된다', () => {
    const before = docXml(template);
    const after = docXml(fillContractDocx(template, TOKENS));
    const cols = (s: string) => (s.match(/<w:cols[^>]*w:num="2"/g) ?? []).length;
    const sect = (s: string) => (s.match(/<w:sectPr/g) ?? []).length;
    expect(cols(after)).toBe(cols(before));
    expect(sect(after)).toBe(sect(before));
  });

  it('계약조항 본문이 그대로 유지된다(수정 금지 영역)', () => {
    const xml = docXml(fillContractDocx(template, TOKENS));
    expect(xml).toContain('제1조');
    expect(xml).toContain('관할법원');
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
