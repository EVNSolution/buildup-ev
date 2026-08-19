/**
 * **고객별 서류 보관함** — 만들어진 견적서·계약서를 생성 순서대로 한 폴더에 쌓는다.
 *
 * 왜 필요한가:
 *   지금 디스크는 **번호로 흩어져 있다** — `quotes/243/`, `orders/18/`, `uploads/14/`.
 *   「이 고객 서류 다 주세요」에 답하려면 견적 번호와 주문 번호를 먼저 찾아야 하고,
 *   견적서는 아예 남지도 않았다(열 때마다 새로 렌더하고 버렸다).
 *   서버에 들어가 폴더 하나만 열면 그 고객의 서류가 순서대로 보이는 편이 낫다.
 *
 * 어떻게 쌓나:
 *   `<DOC_STORAGE_DIR>/customers/<고객번호>_<고객명>/0007_2026-08-19_견적서_26-9087.pdf`
 *   앞의 네 자리가 **그 고객에게 만들어 준 순서**다. 폴더를 `ls` 하면 그대로 시간순이 된다.
 *
 * ⚠️ **같은 내용은 다시 쌓지 않는다.** 견적서는 화면에서 열 때마다 다시 렌더되므로,
 *    그냥 쌓으면 똑같은 파일이 하루에도 수십 장 생긴다. 직전에 쌓은 같은 종류의 파일과
 *    **내용을 대조해** 달라졌을 때만 새 번호를 준다.
 *
 * ⚠️ **여기서 실패해도 서류 발행은 막지 않는다.** 보관은 곁다리다 — 디스크가 가득 찼다고
 *    고객에게 나갈 견적서가 안 나오면 안 된다. 실패는 로그로만 남긴다.
 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { docStorageDir } from '../lib/soffice.js';

/** 무슨 서류인가 — 파일명에 그대로 들어간다. */
export type ArchiveKind =
  | '견적서'
  | '계약서'
  | '계약서_서명본'
  | '튜닝신청서_서명본';

/** 보관함 뿌리 — 문서 저장소 아래 `customers/`(배포 슬롯 밖이라 재배포에도 남는다). */
export function archiveRoot(): string {
  return path.join(docStorageDir(), 'customers');
}

/** 제어문자·경로 구분자·윈도우 금지문자를 지운다. 폴더명과 파일명 양쪽에 쓴다. */
function safeSegment(v: string): string {
  return v
    .replace(new RegExp('[\\u0000-\\u001f\\u007f/\\\\:*?"<>|]', 'g'), '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

/**
 * 이 고객의 폴더. **고객번호로 찾는다** — 이름이 바뀌어도 쌓이던 자리를 계속 쓴다.
 * (`18_홍길동` 이 있는데 이름이 바뀌었다고 `18_홍길순` 을 새로 만들면 서류가 두 곳으로 갈린다)
 */
async function customerDir(customerId: number, customerName: string | null): Promise<string> {
  const root = archiveRoot();
  await mkdir(root, { recursive: true });
  const prefix = `${customerId}_`;
  const existing = (await readdir(root, { withFileTypes: true }))
    .filter(d => d.isDirectory() && d.name.startsWith(prefix))
    .map(d => d.name)
    .sort();
  const dir = path.join(root, existing[0] ?? `${prefix}${safeSegment(customerName ?? '') || '이름없음'}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

const SEQ = /^(\d{4})_/;

/** 폴더 안 파일 목록(정렬됨)과 다음 순번. */
async function scan(dir: string): Promise<{ files: string[]; next: number }> {
  const files = (await readdir(dir)).filter(f => f.endsWith('.pdf')).sort();
  let max = 0;
  for (const f of files) {
    const m = SEQ.exec(f);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return { files, next: max + 1 };
}

/**
 * **내용만** 보는 해시 — PDF 가 매번 달라지는 부분을 빼고 잰다.
 *
 * 같은 견적서를 두 번 렌더하면 바이트가 다르다. 다른 것은 딱 두 군데,
 * `/CreationDate` 와 `/ModDate` 다(만든 시각이 초 단위로 박힌다). 실제로 두 번 뽑아
 * 대조해 확인했다 — 455,208 바이트 중 그 두 줄만 달랐다.
 * 그대로 비교하면 **열 때마다 새 파일이 쌓인다**(처음 만들었을 때 실제로 그랬다).
 *
 * 문서 식별자 `/ID` 도 함께 지운다. 지금 렌더러는 이 값을 흔들지 않지만, 흔드는 순간
 * 같은 증상이 조용히 되돌아온다.
 */
function contentHash(buf: Buffer): string {
  const normalized = buf
    .toString('latin1')
    .replace(/\/(?:CreationDate|ModDate)\s*\([^)]*\)/g, '')
    .replace(/\/ID\s*\[[^\]]*\]/g, '');
  return createHash('sha256').update(normalized, 'latin1').digest('hex');
}

export interface ArchiveInput {
  /** 고객이 없으면 쌓을 자리가 없다 — 조용히 건너뛴다(공개 접수 직후 등) */
  customerId: number | null | undefined;
  customerName: string | null | undefined;
  /** 견적번호 — 파일명에 넣어 어느 건의 서류인지 알아보게 한다 */
  quoteNo?: string | null;
  kind: ArchiveKind;
  pdf: Buffer;
  /** 파일명에 쓸 날짜(YYYY-MM-DD). 없으면 오늘 */
  date?: Date;
}

/**
 * 한 장 쌓는다. 새로 쌓았으면 경로를, 건너뛰었으면 null 을 돌려준다.
 * **예외를 던지지 않는다** — 부르는 쪽이 try/catch 로 감싸지 않아도 된다.
 */
export async function archiveCustomerDoc(input: ArchiveInput): Promise<string | null> {
  const { customerId, customerName, quoteNo, kind, pdf } = input;
  if (!customerId || !pdf?.length) return null;

  try {
    const dir = await customerDir(customerId, customerName ?? null);
    const { files, next } = await scan(dir);

    /*
     * 직전에 쌓은 **같은 종류·같은 건**의 파일과 대조한다.
     * 견적서는 열 때마다 다시 렌더되므로, 이 검사가 없으면 똑같은 파일이 계속 쌓인다.
     */
    const tag = `_${kind}${quoteNo ? `_${safeSegment(quoteNo)}` : ''}.pdf`;
    const last = files.filter(f => f.endsWith(tag)).pop();
    if (last) {
      const prev = await readFile(path.join(dir, last)).catch(() => null);
      if (prev && contentHash(prev) === contentHash(pdf)) return null;   // 내용이 그대로다 — 새 번호를 주지 않는다
    }

    const day = (input.date ?? new Date()).toISOString().slice(0, 10);
    /*
     * 번호가 겹칠 수 있다(동시에 두 건이 들어오는 경우). `wx` 로 **있으면 실패**하게 열어
     * 겹치면 다음 번호로 물러난다 — 덮어쓰면 앞서 쌓인 서류가 사라진다.
     */
    for (let seq = next; seq < next + 20; seq++) {
      const name = `${String(seq).padStart(4, '0')}_${day}${tag}`;
      const abs = path.join(dir, name);
      try {
        await writeFile(abs, pdf, { flag: 'wx' });
        return abs;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
    console.error('[doc-archive] 빈 순번을 찾지 못했습니다', { customerId, kind });
    return null;
  } catch (e) {
    // 보관은 곁다리다 — 실패해도 서류 발행 자체는 그대로 진행되어야 한다
    console.error('[doc-archive] 보관 실패', { customerId, kind, err: e });
    return null;
  }
}
