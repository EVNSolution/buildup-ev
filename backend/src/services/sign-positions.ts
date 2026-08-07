/**
 * 서명 필드 좌표 산출 — 계약서 PDF 에서 서명란 위치를 자동으로 찾는다.
 *
 * 왜 좌표인가:
 *   모두싸인의 anchor 방식이 우리 PDF 에서 동작하지 않는다("Anchor text not found in PDF").
 *   한글·ASCII, CJK 폰트·라틴 폰트를 모두 시도했지만 결과가 같았다. poppler 는 찾는데
 *   모두싸인은 못 찾으므로 추출기 차이로 보인다.
 *
 * 왜 좌표를 손으로 재지 않는가:
 *   렌더된 PDF 에서 **'서명' 라벨 자체의 위치**를 읽는다. 양식을 고쳐도 라벨이 따라
 *   움직이므로 좌표를 다시 잴 필요가 없다. 도장칸 '(인)' 은 같은 줄에서 오른쪽에 있는
 *   것을 찾아 짝짓는다(표 구조가 달라 XML 로는 짝을 못 맞춘다).
 *   ※ 예전엔 보이지 않는 마커(#SIGN1~3#)를 심었으나, 그 글자가 라벨 정렬을 밀어
 *     제거했다. 좌표만 쓰므로 마커는 필요 없다.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface SignPosition {
  kind: 'SIGN' | 'STAMP';
  page: number;          // 1-base
  /** 페이지 대비 0~1 비율(좌상단 기준). 모두싸인이 비율로 받는다. */
  x: number;
  y: number;
  /** 진단용 원본 pt 좌표 */
  ptX: number; ptY: number; pageWidth: number; pageHeight: number;
}

interface Word { page: number; x0: number; y0: number; x1: number; y1: number; text: string }

/** 같은 줄로 볼 y 오차(pt). 글자 크기가 달라 중심이 몇 pt 어긋난다. */
const SAME_LINE_TOLERANCE = 8;

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { c.kill('SIGKILL'); reject(new Error(`${cmd} 시간 초과`)); }, 20_000);
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(e.code === 'ENOENT' ? new Error(`${cmd} 미설치`) : e);
    });
    c.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(`${cmd} 종료 ${code}: ${err.slice(0, 200)}`));
    });
  });
}

/** pdftotext -bbox 출력 파싱 → 단어별 좌표 */
function parseBbox(xml: string): { words: Word[]; pages: { w: number; h: number }[] } {
  const words: Word[] = [];
  const pages: { w: number; h: number }[] = [];
  let page = 0;
  for (const line of xml.split('\n')) {
    const pm = line.match(/<page width="([\d.]+)" height="([\d.]+)"/);
    if (pm) { page++; pages.push({ w: Number(pm[1]), h: Number(pm[2]) }); continue; }
    const wm = line.match(/xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"[^>]*>([^<]*)<\/word>/);
    if (wm) {
      words.push({
        page, x0: Number(wm[1]), y0: Number(wm[2]), x1: Number(wm[3]), y1: Number(wm[4]),
        text: wm[5] ?? '',
      });
    }
  }
  return { words, pages };
}

/**
 * 계약서 PDF → 서명 6칸 좌표(서명 3 + 도장 3).
 * 마커를 못 찾으면 빈 배열 — 호출부가 판단한다(빈 서명란으로 보내면 안 된다).
 */
export async function findSignPositions(pdf: Buffer): Promise<SignPosition[]> {
  const dir = await mkdtemp(path.join(tmpdir(), 'signpos-'));
  try {
    const p = path.join(dir, 'c.pdf');
    await writeFile(p, pdf);
    const xml = await run('pdftotext', ['-bbox', p, '-']);
    const { words, pages } = parseBbox(xml);

    // '서명' 라벨 = 서명칸. '자필성명' 은 '성명' 이라 걸리지 않는다.
    const markers = words
      .filter((w) => w.text === '서명')
      .sort((a, b) => a.page - b.page || a.y0 - b.y0);

    const out: SignPosition[] = [];
    for (const m of markers) {
      const pg = pages[m.page - 1] ?? { w: 0, h: 0 };
      if (!pg.w || !pg.h) continue;   // 페이지 크기를 모르면 비율을 낼 수 없다
      const base = { page: m.page, pageWidth: pg.w, pageHeight: pg.h };
      const ratio = (x: number, y: number) => ({ x: x / pg.w, y: y / pg.h, ptX: x, ptY: y });
      out.push({ kind: 'SIGN', ...ratio(m.x0, m.y0), ...base });

      // 같은 줄 · 마커보다 오른쪽에 있는 '(인)' = 도장칸
      const yc = (m.y0 + m.y1) / 2;
      const seal = words
        .filter((w) => w.page === m.page && w.x0 > m.x0
          && Math.abs((w.y0 + w.y1) / 2 - yc) < SAME_LINE_TOLERANCE
          && w.text.includes('인'))
        .sort((a, b) => a.x0 - b.x0)[0];
      // ⚠️ y 는 '서명' 라벨 것을 그대로 쓴다. 글자 크기가 달라 (인) 의 y 를 쓰면
      //    두 칸 높이가 어긋나 보인다(실제로 어긋나 보였다).
      if (seal) out.push({ kind: 'STAMP', ...ratio(seal.x0, m.y0), ...base });
    }
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
