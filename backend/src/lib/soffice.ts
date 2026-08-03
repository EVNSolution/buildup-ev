/**
 * LibreOffice(soffice) 기반 HTML→PDF 변환 + 문서 저장경로 해석.
 * docgen 파이프라인과 동일 툴체인(soffice + 서버 한글폰트)을 쓰되, 계약서 등 다른 서류가
 * docgen 내부에 의존하지 않도록 공용 유틸로 분리. (docgen 자체는 기존대로 유지.)
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export class SofficeUnavailableError extends Error {}

const SOFFICE_TIMEOUT_MS = 30_000;

/** 서류 저장 루트(배포 워크트리 밖). 프로덕션은 DOC_STORAGE_DIR 필수. */
export function docStorageDir(): string {
  const dir = process.env['DOC_STORAGE_DIR'];
  if (dir) return dir;
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('DOC_STORAGE_DIR 환경변수가 설정되지 않았습니다 (프로덕션 필수 — 배포 워크트리 밖 경로)');
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..', '.local-doc-storage');
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new SofficeUnavailableError(`${cmd} 실행이 ${timeoutMs}ms 내에 끝나지 않았습니다`));
    }, timeoutMs);
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') reject(new SofficeUnavailableError(`${cmd} 를 찾을 수 없습니다 (서버에 미설치)`));
      else reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} 종료코드 ${code}: ${stderr.slice(0, 2000)}`));
    });
  });
}

/**
 * HTML 문자열 → PDF(Buffer). soffice 는 같은 프로필 병렬실행 시 깨지므로 매 호출 임시 프로필 분리.
 * 한글은 서버에 설치된 CJK 폰트로 임베딩된다(docgen 폰트설정 공유).
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const work = await mkdtemp(path.join(tmpdir(), 'soffice_'));
  const profileDir = path.join(tmpdir(), `sofficeprofile_${randomUUID()}`);
  try {
    const inPath = path.join(work, 'in.html');
    await writeFile(inPath, html, 'utf-8');
    await run('soffice', [
      '--headless', '--nologo', '--nofirststartwizard',
      `-env:UserInstallation=file://${profileDir}`,
      '--convert-to', 'pdf', '--outdir', work, inPath,
    ], SOFFICE_TIMEOUT_MS);
    return await readFile(path.join(work, 'in.pdf'));
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * docx(Buffer) → PDF(Buffer). docxtemplater 로 채운 계약서 등을 변환.
 * htmlToPdf 와 동일하게 매 호출 임시 프로필 분리. 한글은 서버 CJK 폰트로 임베딩.
 */
export async function docxToPdf(docx: Buffer): Promise<Buffer> {
  const work = await mkdtemp(path.join(tmpdir(), 'soffice_'));
  const profileDir = path.join(tmpdir(), `sofficeprofile_${randomUUID()}`);
  try {
    const inPath = path.join(work, 'in.docx');
    await writeFile(inPath, docx);
    await run('soffice', [
      '--headless', '--nologo', '--nofirststartwizard',
      `-env:UserInstallation=file://${profileDir}`,
      '--convert-to', 'pdf', '--outdir', work, inPath,
    ], SOFFICE_TIMEOUT_MS);
    return await readFile(path.join(work, 'in.pdf'));
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}
