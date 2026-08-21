/**
 * **고객 서류함** — 한 고객에게 만들어 준 견적서·계약서를 한자리에서 본다.
 *
 * 화면(견적 목록·견적·주문)은 지금 **건별·날짜순**이다. 같은 고객이 견적을 세 번 고치면
 * 세 줄로 흩어지고, 「이 사람한테 지금까지 뭘 보냈지」를 보려면 줄마다 열어 봐야 한다.
 * 서류함은 그 질문에 바로 답한다 — 고객 하나에 폴더 하나.
 *
 * ⚠️ **같은 사람인지 판정은 새로 만들지 않는다.** `customer-master.ts` 의
 *    `customerMatches()` 가 그 정의고(성명+생년월일 → 성명+휴대폰), 여기서는 같은 규칙을
 *    행 묶기로 옮겨 쓴다. 두 곳이 갈리면 고객 마스터가 한 사람으로 본 것을 서류함은
 *    둘로 보여 주게 된다.
 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { archiveRoot } from './doc-archive.js';
import { docStorageDir } from '../lib/soffice.js';

/** 서류함에 들어오는 고객 행(그룹을 만드는 데 필요한 것만). */
export interface FolderCustomer {
  id: number;
  name: string;
  reg_no: string | null;
  phone: string | null;
  updated_at: Date;
}

/** 한 사람으로 묶인 고객 행들. */
export interface CustomerGroup {
  /** 화면·주소에 쓰는 열쇠 — 그룹에서 가장 작은 고객번호(행이 늘어도 변하지 않는다) */
  key: number;
  name: string;
  reg_no: string | null;
  phone: string | null;
  /** 이 그룹에 묶인 고객 행 전부 — 서류가 여러 행에 흩어져 있을 수 있다 */
  ids: number[];
  updatedAt: Date;
}

const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');
const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase();

/**
 * **같은 사람끼리 묶는다** — `customerMatches()` 와 같은 규칙.
 *
 *   ① 성명 + 생년월일(사업자번호)이 같으면 같은 사람
 *   ② 성명 + 휴대폰이 같고, **생년월일이 서로 어긋나지 않으면** 같은 사람
 *      (이름·번호가 같아도 생년월일이 다르면 다른 사람이다 — 가족이 한 번호를 쓰는 경우)
 *
 * ②가 필요한 이유: 견적 단계에서는 생년월일을 안 받는다. 나중에 계약하면서 채우므로,
 * ①만으로 묶으면 **계약 전후가 다른 폴더로 갈린다**.
 */
export function groupCustomers(rows: FolderCustomer[]): CustomerGroup[] {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: number, b: number) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  };
  for (const c of rows) parent.set(c.id, c.id);

  // ① 성명 + 생년월일
  const byReg = new Map<string, number[]>();
  for (const c of rows) {
    const r = digits(c.reg_no);
    if (!r) continue;
    const k = `${norm(c.name)}|${r}`;
    (byReg.get(k) ?? byReg.set(k, []).get(k)!).push(c.id);
  }
  for (const ids of byReg.values()) for (const id of ids) union(ids[0]!, id);

  // ② 성명 + 휴대폰 (생년월일이 서로 어긋나지 않을 때만)
  const byPhone = new Map<string, FolderCustomer[]>();
  for (const c of rows) {
    const p = digits(c.phone);
    if (!p) continue;
    const k = `${norm(c.name)}|${p}`;
    (byPhone.get(k) ?? byPhone.set(k, []).get(k)!).push(c);
  }
  for (const list of byPhone.values()) {
    for (const a of list) {
      for (const b of list) {
        if (a.id === b.id) continue;
        const [ra, rb] = [digits(a.reg_no), digits(b.reg_no)];
        if (ra && rb && ra !== rb) continue;   // 생년월일이 다르다 — 다른 사람
        union(a.id, b.id);
      }
    }
  }

  const byRoot = new Map<number, FolderCustomer[]>();
  for (const c of rows) {
    const r = find(c.id);
    (byRoot.get(r) ?? byRoot.set(r, []).get(r)!).push(c);
  }

  return [...byRoot.entries()].map(([key, members]) => {
    // 대표값은 **가장 최근에 손댄 행**에서 가져온다 — 이름·번호를 고쳤으면 그 값이 맞다
    const newest = [...members].sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime())[0]!;
    return {
      key,
      name: newest.name,
      reg_no: members.find(m => m.reg_no)?.reg_no ?? null,
      phone: newest.phone ?? members.find(m => m.phone)?.phone ?? null,
      ids: members.map(m => m.id).sort((a, b) => a - b),
      updatedAt: new Date(Math.max(...members.map(m => m.updated_at.getTime()))),
    };
  });
}

// ── 서류 목록 ──────────────────────────────────────────────────────────────

export interface FolderDoc {
  /** 내려받을 때 쓰는 열쇠 — 저장소 뿌리 기준 상대경로를 감싼 값 */
  id: string;
  kind: string;
  /** 견적번호(있으면) */
  quoteNo: string | null;
  /** 만들어진 시각 (ISO) */
  at: string;
  size: number;
  /**
   * **서명 요청 시점에 굳힌 정본**인가. 고객이 실제로 받아 본 문서라 맨 위에 고정한다.
   * 나머지는 그 아래로 시간 역순.
   */
  pinned: boolean;
}

/** `0003_2026-08-19_견적서_26-9087.pdf` 를 뜯는다. 견적번호는 없을 수 있다(공개 접수). */
const ARCHIVE_NAME = /^(\d{4})_(\d{4}-\d{2}-\d{2})_(.+?)(?:_(\d{2}-\d{4}))?\.pdf$/;

/** 저장소 뿌리 기준 상대경로 → 화면에 넘길 열쇠(경로를 그대로 노출하지 않는다). */
export function docId(absPath: string): string {
  const rel = path.relative(docStorageDir(), absPath);
  return Buffer.from(rel, 'utf-8').toString('base64url');
}

/**
 * 열쇠 → 실제 경로. **저장소 밖으로 나가면 거절한다.**
 * 열쇠가 화면에서 오는 값이라, 여기서 막지 않으면 임의 파일 읽기가 된다.
 */
export function resolveDocId(id: string): string | null {
  let rel: string;
  try { rel = Buffer.from(id, 'base64url').toString('utf-8'); } catch { return null; }
  if (!rel || rel.includes('\0')) return null;
  const root = path.resolve(docStorageDir());
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) return null;
  if (!abs.endsWith('.pdf')) return null;
  return abs;
}

/** 내용 해시 — PDF 가 매번 바뀌는 부분(만든 시각)을 빼고 잰다. doc-archive 와 같은 기준. */
function contentHash(buf: Buffer): string {
  const normalized = buf
    .toString('latin1')
    .replace(/\/(?:CreationDate|ModDate)\s*\([^)]*\)/g, '')
    .replace(/\/ID\s*\[[^\]]*\]/g, '');
  return createHash('sha256').update(normalized, 'latin1').digest('hex');
}

/**
 * 견적 하나의 **옵션 요약** — 화면에 「무엇을 고른 건인지」 한 줄로 보여 준다.
 *
 * 파일 이름만 늘어놓으면 「26-9087 견적서」가 셋 있을 때 무엇이 다른지 알 수 없다.
 * 고른 사양이 함께 보여야 고객과 통화하며 「그 냉동 저상 건」을 짚을 수 있다.
 *
 * ⚠️ 이름은 **DB(option_value.name)** 에서 온다. 화면에 표기를 또 적어 두면
 *    옵션 이름을 고쳤을 때 두 곳이 갈린다.
 */
export interface OptionChip { group: string; label: string }

/** 요약에 넣을 그룹과 순서 — 사양을 가르는 것부터. 나머지는 굳이 줄에 올리지 않는다. */
const SUMMARY_GROUPS = ['TRIM', 'BODYTYPE', 'TOP', 'DOORTYPE', 'DOORADD', 'PARTITION', 'TEMP'];

export function optionChips(
  selections: Record<string, string>,
  nameOf: (code: string) => string | undefined,
): OptionChip[] {
  const out: OptionChip[] = [];
  for (const g of SUMMARY_GROUPS) {
    const v = selections[g];
    if (!v) continue;
    const label = nameOf(v);
    if (!label) continue;
    // 「없음」·「X」는 고른 게 없다는 뜻이라 줄만 길어진다
    if (label === '없음' || label === 'X') continue;
    out.push({ group: g, label });
  }
  return out;
}

/** 고정본 한 건 — 서명 요청 때 굳힌 견적서·계약서. */
export interface PinnedInput { quoteNo: string | null; frozenAt: Date; quotePath: string | null; contractPath: string | null }

/**
 * 그룹의 서류를 **화면에 뿌릴 순서대로** 모은다.
 *
 * ⚠️ **내용이 같은 파일은 한 번만 보인다.** 견적서는 열 때마다 렌더되므로 옛 판이
 *    남아 있을 수 있고, 고객 행이 여럿이면 같은 서류가 폴더 둘에 들어 있기도 하다.
 *    같은 것을 여러 줄로 보여 주면 「무엇이 달라졌나」를 읽을 수 없다.
 *    지우지는 않는다 — 목록에서 접을 뿐이다(원본은 그대로 둔다).
 */
export async function collectDocs(customerIds: number[], pinned: PinnedInput[]): Promise<FolderDoc[]> {
  const out: FolderDoc[] = [];
  const seen = new Set<string>();

  // ── 고정본 먼저 — 같은 내용이 뒤에 또 나오면 그쪽이 접힌다 ──
  for (const p of pinned) {
    for (const abs of [p.quotePath, p.contractPath]) {
      if (!abs) continue;
      const buf = await readFile(abs).catch(() => null);
      if (!buf) continue;
      seen.add(contentHash(buf));
      out.push({
        id: docId(abs),
        kind: abs.includes('contract') ? '계약서 (서명 요청본)' : '견적서 (서명 요청본)',
        quoteNo: p.quoteNo,
        at: p.frozenAt.toISOString(),
        size: buf.length,
        pinned: true,
      });
    }
  }

  // ── 보관함 ──
  const root = archiveRoot();
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => []);
  const mine = dirs
    .filter(d => d.isDirectory() && customerIds.some(id => d.name.startsWith(`${id}_`)))
    .map(d => path.join(root, d.name));

  const rows: (FolderDoc & { hash: string })[] = [];
  for (const dir of mine) {
    for (const f of (await readdir(dir).catch(() => []))) {
      const m = ARCHIVE_NAME.exec(f);
      if (!m) continue;
      const abs = path.join(dir, f);
      const [buf, st] = await Promise.all([readFile(abs).catch(() => null), stat(abs).catch(() => null)]);
      if (!buf || !st) continue;
      rows.push({
        id: docId(abs),
        kind: m[3]!.replace(/_/g, ' '),
        quoteNo: m[4] ?? null,
        at: st.mtime.toISOString(),
        size: buf.length,
        pinned: false,
        hash: contentHash(buf),
      });
    }
  }

  // 최신이 위 — 같은 내용은 **가장 최근 것 하나만** 남긴다
  rows.sort((a, b) => b.at.localeCompare(a.at));
  for (const r of rows) {
    if (seen.has(r.hash)) continue;
    seen.add(r.hash);
    const { hash: _hash, ...doc } = r;
    out.push(doc);
  }

  // 고정본이 맨 위, 그 아래는 시간 역순
  return out.sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || b.at.localeCompare(a.at));
}


/** 견적 하나 — 옵션 요약과 그 건의 서류를 함께 담는다. */
export interface FolderQuote {
  id: number;
  quoteNo: string | null;
  status: string;
  createdAt: string;
  finalPrice: number | null;
  options: OptionChip[];
  /** 서명 요청 때 굳힌 정본이 있는 건인가 */
  frozenAt: string | null;
  docs: FolderDoc[];
}

/**
 * 서류를 **견적별로 나눈다** — 화면이 견적 카드 하나에 그 건의 서류를 모아 보여 준다.
 *
 * 나누는 열쇠는 **견적번호**다. 보관함 파일 이름에 견적번호가 들어 있고, 고정본은 견적에 붙어 있다.
 * ⚠️ 견적번호가 없는 건(공개 접수 직후)은 번호로 이을 수 없다 —
 *    그런 서류는 `null` 묶음으로 따로 모은다. 버리지 않는다.
 */
export function groupDocsByQuote(docs: FolderDoc[]): Map<string | null, FolderDoc[]> {
  const by = new Map<string | null, FolderDoc[]>();
  for (const d of docs) {
    const k = d.quoteNo ?? null;
    const list = by.get(k) ?? [];
    list.push(d);
    by.set(k, list);
  }
  return by;
}
