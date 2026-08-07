import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deleteContractFiles } from '../services/doc-freeze.js';

const exists = (p: string) => access(p).then(() => true, () => false);

describe('계약 파일 정리 — 고아 파일 방지', () => {
  it('지정한 파일들을 실제로 지운다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cfc-'));
    const a = path.join(dir, 'frozen_quote.pdf');
    const b = path.join(dir, 'contract_signed_1.pdf');
    await writeFile(a, 'A'); await writeFile(b, 'B');
    expect(await exists(a)).toBe(true);

    await deleteContractFiles([a, b]);
    expect(await exists(a)).toBe(false);
    expect(await exists(b)).toBe(false);
  });

  it('없는 파일이 섞여 있어도 나머지를 지우고 예외를 던지지 않는다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cfc-'));
    const real = path.join(dir, 'real.pdf');
    await writeFile(real, 'X');

    await expect(deleteContractFiles([path.join(dir, 'gone.pdf'), real])).resolves.toBeUndefined();
    expect(await exists(real)).toBe(false);
  });

  it('빈 목록이어도 안전하다', async () => {
    await expect(deleteContractFiles([])).resolves.toBeUndefined();
  });
});
