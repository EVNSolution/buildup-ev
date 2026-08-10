/**
 * 전자서명 날인칸 좌표 산출 — 계약서 PDF 에서 매수인 `(인)` 자리를 자동으로 찾는다.
 *
 * 왜 좌표인가:
 *   모두싸인의 anchor 방식이 우리 PDF 에서 동작하지 않는다("Anchor text not found in PDF").
 *   한글·ASCII, CJK 폰트·라틴 폰트를 모두 시도했지만 결과가 같았다. poppler 는 찾는데
 *   모두싸인은 못 찾으므로 추출기 차이로 보인다.
 *
 * 왜 좌표를 손으로 재지 않는가:
 *   렌더된 PDF 에서 **라벨 위치**를 읽어 그 줄의 `(인)` 과 짝지어 낸다. 양식을 고쳐도
 *   라벨이 따라 움직이므로 좌표를 다시 잴 필요가 없다.
 *
 * 왜 `(인)` 만 3곳인가:
 *   모두싸인은 **한 서명자의 모든 서명필드 타입이 같아야** 한다. 그래서 이름은 양식에
 *   `{{buyer_name}}` 으로 인쇄해 내보내고, 전자서명으로는 **날인 3곳만** 받는다.
 *     · 영수증(송금 동의) `(인)`      — 항상
 *     · 개인정보 수집·이용 동의 `(인)` — 항상
 *     · 매수인 서명블록 `(인)`         — 개인 계약이면 개인 줄, 법인 계약이면 법인 줄 한 곳
 *
 * ⚠️ 매도인(이브이앤솔루션 대표이사) 날인칸을 절대 잡으면 안 된다.
 *    매도인 `(인)` 은 매수인 법인 줄 `(인)` 과 **같은 텍스트 줄**에 놓인다(2단 표의 좌·우 칸).
 *    그래서 "줄 안의 글자"로는 구분되지 않는다 — 반드시 **라벨보다 오른쪽**이라는 조건으로
 *    거른다. 매도인 날인은 라벨(`자필성명`)보다 항상 왼쪽에 있다.
 *    (실측: 매도인 x≈454 / 라벨 x≈552 / 매수인 날인 x≈862)
 *
 * ⚠️ 법인 줄은 「회사명」 라벨로 찾으면 안 된다(한 번 그렇게 만들었다가 실패했다).
 *    법인 줄 셀 내용은 `회사명 {{company_name}}` 이라 상호가 길면 **셀 안에서 줄바꿈**되고,
 *    그러면 「회사명」은 첫 줄, 세로가운데 정렬된 `(인)` 은 둘째 줄에 놓여 같은 줄이 아니게 된다.
 *    반면 「자필성명」은 셀에 혼자 있어 절대 줄바꿈되지 않는다. 그래서
 *    **법인 줄 날인 = 개인 줄 날인 바로 아래, 같은 x(같은 표 칸)** 로 찾는다.
 *    LibreOffice 렌더는 실행마다 줄바꿈이 달라질 수 있어(실측 확인) 레이아웃에
 *    의존하지 않는 이 방식이 필요하다.
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
  /** 어느 날인칸인지 — 로그·검증용 */
  slot: SealSlot;
}

/** 날인칸 종류. `buyer_personal` / `buyer_corporate` 중 하나만 실제로 발송된다. */
export type SealSlot = 'receipt' | 'privacy' | 'buyer_personal' | 'buyer_corporate';

interface Word { page: number; x0: number; y0: number; x1: number; y1: number; text: string }

/** 같은 줄로 볼 y 오차(pt). 글자 크기가 달라 중심이 몇 pt 어긋난다. */
const SAME_LINE_TOLERANCE = 8;

/**
 * 날인칸을 찾는 기준 라벨 — 양식에 정확히 3번(영수증·개인정보동의·매수인 개인 줄) 나온다.
 * 셀에 혼자 있어 줄바꿈되지 않으므로 같은 줄의 `(인)` 과 항상 짝이 맞는다.
 * 양식에서 이 글자가 사라지면 서명란을 못 잡는다.
 */
const LABEL_PERSONAL = '자필성명';
/** 날인칸 글자. pdftotext 가 한 단어로 뽑아준다(실측 확인). */
const SEAL = '(인)';
/** 같은 표 칸(같은 세로줄)으로 볼 x 오차(pt). 개인 줄·법인 줄 날인은 같은 칸이라 x 가 같다. */
const SAME_COLUMN_TOLERANCE = 6;

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

/** 라벨과 같은 줄 · 라벨보다 오른쪽에 있는 첫 `(인)`. 매도인 날인은 라벨 왼쪽이라 걸리지 않는다. */
function sealRightOf(label: Word, words: Word[]): Word | undefined {
  const yc = (label.y0 + label.y1) / 2;
  return words
    .filter((w) => w.page === label.page && w.x0 > label.x0
      && Math.abs((w.y0 + w.y1) / 2 - yc) < SAME_LINE_TOLERANCE
      && w.text === SEAL)
    .sort((a, b) => a.x0 - b.x0)[0];
}

/**
 * 계약서 PDF → 매수인 날인칸 3곳.
 *
 * @param isCorporate 법인사업자 계약이면 true — 매수인 블록의 **법인 줄**에 날인칸을 놓는다.
 *                    false 면 **개인 줄**. (양식에는 두 줄 다 있고, 값은 법인일 때만 채워진다)
 * @returns 항상 3개. 하나라도 못 찾으면 **빈 배열** — 날인칸이 빠진 계약서를 발송하면 안 되므로
 *          호출부(modusign.sendDocument)가 발송을 거부하게 한다.
 */
export async function findSignPositions(pdf: Buffer, isCorporate: boolean): Promise<SignPosition[]> {
  const dir = await mkdtemp(path.join(tmpdir(), 'signpos-'));
  try {
    const p = path.join(dir, 'c.pdf');
    await writeFile(p, pdf);
    const xml = await run('pdftotext', ['-bbox', p, '-']);
    const { words, pages } = parseBbox(xml);

    // '자필성명' 3개. 위→아래 순서가 곧 [영수증, 개인정보동의, 매수인 개인 줄] 이다.
    const byDoc = (a: Word, b: Word) => a.page - b.page || a.y0 - b.y0;
    const personals = words.filter((w) => w.text === LABEL_PERSONAL).sort(byDoc);
    if (personals.length !== 3) {
      console.error(`[sign-positions] 라벨 '${LABEL_PERSONAL}' 이 ${personals.length}개입니다(기대 3). `
        + `양식(contract-template.docx)에서 라벨이 바뀌었는지 확인하세요.`);
      return [];
    }

    // 라벨 3개 각각의 같은 줄 오른쪽 `(인)` → 영수증 · 개인정보동의 · 매수인 개인 줄
    const found: { slot: SealSlot; seal: Word }[] = [];
    for (const [i, slot] of (['receipt', 'privacy', 'buyer_personal'] as const).entries()) {
      const label = personals[i]!;
      const seal = sealRightOf(label, words);
      if (!seal) {
        console.error(`[sign-positions] '${slot}' 날인칸 «${SEAL}» 을 찾지 못했습니다 `
          + `(라벨 p${label.page} x=${label.x0.toFixed(0)} y=${label.y0.toFixed(0)}).`);
        return [];
      }
      found.push({ slot, seal });
    }

    // 법인 줄 날인 = 개인 줄 날인 **바로 아래, 같은 표 칸(같은 x)**.
    // 「회사명」 라벨은 상호가 길면 셀 안에서 줄바꿈돼 `(인)` 과 다른 줄이 되므로 쓸 수 없다.
    if (isCorporate) {
      const personal = found[2]!.seal;
      const below = words
        .filter((w) => w.text === SEAL
          && Math.abs(w.x0 - personal.x0) < SAME_COLUMN_TOLERANCE
          && (w.page > personal.page || (w.page === personal.page && w.y0 > personal.y0 + SAME_LINE_TOLERANCE)))
        .sort(byDoc)[0];
      if (!below) {
        console.error('[sign-positions] 매수인 법인 줄 날인칸을 찾지 못했습니다 — '
          + `개인 줄 날인(p${personal.page} x=${personal.x0.toFixed(0)} y=${personal.y0.toFixed(0)}) 아래 `
          + `같은 칸의 «${SEAL}» 이 없습니다. 양식의 「회사명 / 대표이사 / (인)」 줄을 확인하세요.`);
        return [];
      }
      found[2] = { slot: 'buyer_corporate', seal: below };
    }

    const out: SignPosition[] = [];
    for (const { slot, seal } of found) {
      const pg = pages[seal.page - 1];
      if (!pg?.w || !pg?.h) {
        console.error(`[sign-positions] '${slot}' 페이지 크기를 알 수 없어 비율을 낼 수 없습니다(p${seal.page}).`);
        return [];
      }
      out.push({
        kind: 'STAMP',
        slot,
        page: seal.page,
        // `(인)` 글자 상자의 좌상단을 그대로 쓴다 — 날인은 그 자리에 찍혀야 한다.
        // (예전엔 라벨의 y 를 썼다. 한 줄에 서명칸·도장칸 두 개를 놓던 시절, 글자 높이가
        //  달라 두 칸이 어긋나 보였기 때문이다. 지금은 줄당 날인 한 칸뿐이라 그 문제가 없고,
        //  법인 줄은 기준 삼을 라벨이 같은 줄에 없으므로 `(인)` 기준으로 통일한다.)
        x: seal.x0 / pg.w,
        y: seal.y0 / pg.h,
        ptX: seal.x0,
        ptY: seal.y0,
        pageWidth: pg.w,
        pageHeight: pg.h,
      });
    }
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
