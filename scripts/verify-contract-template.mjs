#!/usr/bin/env node
/**
 * 계약서 양식(contract-template.docx) 검증기.
 *
 * 양식은 수시로 바뀐다. 바꾼 뒤 이 스크립트 하나만 돌리면 배포해도 되는지 알 수 있다.
 *
 *   npm run contract:verify
 *
 * 검사 항목
 *   1. 파일이 docx 인지 (LibreOffice 에서 ODF 로 저장하면 여기서 걸린다)
 *   2. 토큰 27개가 온전한지 — 오타·누락·코드에 없는 토큰
 *   3. 실제 값을 넣어 PDF 로 렌더 — 미치환 토큰 없는지
 *   4. 페이지 수와 빈 페이지 — 여백/섹션 때문에 백지가 끼는 사고가 잦다
 *   5. 계약조항이 새 페이지에서 시작하는지
 *
 * 미리보기 PNG 도 함께 만든다(--preview). 눈으로 확인할 때 쓴다.
 */
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(ROOT, 'doc-templates/contract-template.docx');
const SAMPLE = path.join(ROOT, 'doc-templates/contract-template.sample.json');
const WANT_PREVIEW = process.argv.includes('--preview');

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
let failed = false;
const fail = (m) => { bad(m); failed = true; };

function run(cmd, args, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${cmd} 시간 초과`)); }, timeoutMs);
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(t); reject(e.code === 'ENOENT' ? new Error(`${cmd} 없음`) : e); });
    child.on('close', (c) => { clearTimeout(t); c === 0 ? resolve() : reject(new Error(`${cmd} 종료 ${c}: ${err.slice(0, 300)}`)); });
  });
}

/** PDF 페이지 수 — poppler 없이 파일에서 직접 센다. */
const pageCount = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

console.log('\n계약서 양식 검증 — doc-templates/contract-template.docx\n');

// ── 1. 파일 형식 ────────────────────────────────────────────────────────────
const raw = await readFile(TEMPLATE).catch(() => null);
if (!raw) { fail('파일을 찾을 수 없습니다'); process.exit(1); }
if (raw[0] !== 0x50 || raw[1] !== 0x4b) {
  fail('docx(zip) 파일이 아닙니다 — LibreOffice 저장 시 «Use Word 2010-365 Document Format» 을 눌러야 합니다');
  process.exit(1);
}

const { default: PizZip } = await import('pizzip');
let zip;
try { zip = new PizZip(raw); } catch { fail('압축이 깨졌습니다'); process.exit(1); }
const docXml = zip.file('word/document.xml')?.asText();
if (!docXml) { fail('word/document.xml 이 없습니다 (docx 가 아닐 수 있음)'); process.exit(1); }
ok(`docx 정상 (${(raw.length / 1024).toFixed(0)}KB, 파트 ${Object.keys(zip.files).length}개)`);

// ── 2. 토큰 ────────────────────────────────────────────────────────────────
// 기대 토큰 = 샘플 데이터의 키. 코드(ContractTokens)와 짝이 맞는 단일 소스.
const sample = JSON.parse(await readFile(SAMPLE, 'utf8'));
const expected = Object.keys(sample);

// Word/LibreOffice 가 토큰을 여러 조각으로 쪼개 저장하므로 XML 이 아니라
// 텍스트 노드를 이어붙인 뒤에 찾아야 한다.
const text = [...docXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
const inTemplate = [...new Set([...text.matchAll(/\{\{([^}]{0,40})\}\}/g)].map((m) => m[1].trim()))];

const missing = expected.filter((k) => !inTemplate.includes(k));
const unknown = inTemplate.filter((k) => !expected.includes(k));
if (missing.length) fail(`양식에서 사라진 토큰 ${missing.length}개: ${missing.join(', ')}`);
if (unknown.length) fail(`코드에 없는 토큰 ${unknown.length}개: ${unknown.join(', ')}  → 이 칸은 항상 공란이 됩니다`);
if (!missing.length && !unknown.length) ok(`토큰 ${expected.length}개 모두 정상`);

// ── 3~5. 렌더 ──────────────────────────────────────────────────────────────
const work = await mkdtemp(path.join(tmpdir(), 'ctpl-'));
const profile = path.join(tmpdir(), `soffice_${randomUUID()}`);
try {
  const { fillContractDocx } = await import(path.join(ROOT, 'backend/src/services/contract-docgen.ts'));
  const filled = fillContractDocx(raw, sample);
  const inDocx = path.join(work, 'filled.docx');
  await writeFile(inDocx, filled);

  await run('soffice', [
    '--headless', '--nologo', '--nofirststartwizard',
    `-env:UserInstallation=file://${profile}`,
    '--convert-to', 'pdf', '--outdir', work, inDocx,
  ]);
  const pdfPath = path.join(work, 'filled.pdf');
  const pdf = await readFile(pdfPath);

  const n = pageCount(pdf);
  ok(`PDF 변환 성공 — ${n}페이지`);

  // 페이지별 내용(빈 페이지 탐지). pdftotext 없으면 이 검사만 건너뛴다.
  let pages = null;
  try {
    const out = path.join(work, 'out.txt');
    await run('pdftotext', ['-layout', pdfPath, out]);
    pages = (await readFile(out, 'utf8')).split('\f');
  } catch { warn('pdftotext 가 없어 페이지별 내용 검사는 건너뜁니다'); }

  if (pages) {
    const all = pages.join('');
    const left = [...new Set(all.match(/\{\{[^}]{0,30}\}\}/g) ?? [])];
    left.length ? fail(`값이 채워지지 않은 토큰: ${left.join(', ')}`) : ok('미치환 토큰 없음');

    const blanks = [];
    for (let i = 0; i < n; i++) if (!(pages[i] ?? '').trim()) blanks.push(i + 1);
    blanks.length
      ? fail(`빈 페이지 ${blanks.join(', ')}p — 여백 문단이 넘쳤거나 섹션이 «새 페이지에서 시작» 입니다`)
      : ok('빈 페이지 없음');

    // 계약조항은 '있는 페이지의 첫 줄' 이어야 한다. 페이지 중간에 있으면 나눔이 빠진 것.
    const CLAUSE = '계 약 조 항';
    const clauseAt = pages.findIndex((p) => p.includes(CLAUSE));
    if (clauseAt < 0) {
      warn(`«${CLAUSE}» 제목을 찾지 못했습니다 (제목 문구가 바뀌었나요?)`);
    } else {
      const first = (pages[clauseAt] ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
      first.startsWith(CLAUSE)
        ? ok(`계약조항이 ${clauseAt + 1}페이지 첫 줄에서 시작`)
        : fail(`계약조항이 ${clauseAt + 1}페이지 중간에 있습니다 — 페이지 나눔이 빠졌습니다`);
    }

    for (let i = 0; i < n; i++) {
      const lines = (pages[i] ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
      console.log(`      ${i + 1}p (${lines.length}줄) ${lines[0]?.slice(0, 46) ?? '(비어있음)'}`);
    }
  }

  if (WANT_PREVIEW) {
    const dir = path.join(ROOT, '.local-doc-storage');
    await run('mkdir', ['-p', dir]);
    await run('sips', ['-s', 'format', 'png', '--resampleWidth', '900', pdfPath, '--out', path.join(dir, 'contract-preview.png')]);
    ok(`미리보기: .local-doc-storage/contract-preview.png`);
  }
} catch (e) {
  fail(`렌더 실패: ${e.message}`);
} finally {
  await rm(work, { recursive: true, force: true }).catch(() => {});
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(failed
  ? '\n\x1b[31m실패\x1b[0m — 위 항목을 고친 뒤 다시 실행하세요.\n'
  : '\n\x1b[32m통과\x1b[0m — 배포해도 됩니다.\n');
process.exit(failed ? 1 : 0);
