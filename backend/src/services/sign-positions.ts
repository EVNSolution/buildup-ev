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
 * 기준 라벨은 **「서명」** 이다. 양식에서 「서명」과 「(인)」은 같은 칸에 붙어 있고
 * (`서명 (인)`), 문서에 나오는 순서가 곧 아래 순서다:
 *
 *   0 영수증(송금 동의)  1 개인정보 수집·이용 동의  2 매수인 **법인 줄**  3 매수인 개인 줄
 *
 * 개인 계약이면 렌더 단계에서 **법인 줄을 통째로 지우므로**(contract-docgen.fillContractDocx)
 * 라벨이 3개가 되고, 그때도 매수인 줄은 여전히 index 2 다. 즉 **법인·개인 모두 index 2**.
 * 기대 개수만 다르다(법인 4 / 개인 3) — 개수가 어긋나면 양식이 바뀐 것이므로 발송을 막는다.
 *
 * ⚠️ 매도인(이브이앤솔루션 대표이사) 날인칸을 절대 잡으면 안 된다.
 *    매도인 `(인)` 은 매수인 줄 `(인)` 과 **같은 텍스트 줄**에 놓인다(2단 표의 좌·우 칸).
 *    그래서 "줄 안의 글자"로는 구분되지 않는다 — 반드시 **라벨보다 오른쪽**이라는 조건으로
 *    거른다. 매도인 날인은 「서명」 라벨보다 항상 왼쪽이다.
 *    (실측: 매도인 (인) x≈459 / 매수인 서명 라벨 x≈851 / 매수인 (인) x≈874)
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
 * 날인칸을 찾는 기준 라벨. 양식에서 이 글자가 사라지면 서명란을 못 잡는다.
 * `서명 (인)` 이 한 칸에 있어 pdftotext 가 '서명' / '(인)' 두 단어로 뽑는다(실측 확인).
 */
const LABEL = '서명';
/** 날인칸 글자. pdftotext 가 한 단어로 뽑아준다(실측 확인). */
const SEAL = '(인)';
/** 매수인 날인은 라벨 목록에서 항상 세 번째 — 법인 줄이 개인 줄보다 위에 있다. */
const BUYER_INDEX = 2;

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
 * 계약서 PDF → 날인칸 3곳(영수증 · 개인정보동의 · 매수인 한 줄).
 *
 * @param isCorporate 법인 계약이면 true. 양식에 법인 줄이 남아 있어 「서명」 라벨이 4개고,
 *                    개인 계약이면 렌더 단계에서 법인 줄을 지워 3개다. 매수인 줄은 두 경우 모두
 *                    라벨 순서 index 2 (법인 줄이 개인 줄보다 위).
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

    // 「서명」 라벨을 문서 순서로. [영수증, 개인정보동의, (법인 줄), 개인 줄]
    const byDoc = (a: Word, b: Word) => a.page - b.page || a.y0 - b.y0;
    const labels = words.filter((w) => w.text === LABEL).sort(byDoc);
    const expected = isCorporate ? 4 : 3;
    if (labels.length !== expected) {
      console.error(`[sign-positions] 라벨 '${LABEL}' 이 ${labels.length}개입니다`
        + `(${isCorporate ? '법인' : '개인'} 계약 기대 ${expected}). `
        + `양식(contract-template.docx)에서 서명란이 바뀌었는지 확인하세요.`);
      return [];
    }

    const wanted: { slot: SealSlot; label: Word }[] = [
      { slot: 'receipt', label: labels[0]! },
      { slot: 'privacy', label: labels[1]! },
      { slot: isCorporate ? 'buyer_corporate' : 'buyer_personal', label: labels[BUYER_INDEX]! },
    ];

    const found: { slot: SealSlot; seal: Word }[] = [];
    for (const { slot, label } of wanted) {
      // 같은 줄에서 라벨보다 **오른쪽** 첫 «(인)» — 매도인 날인은 라벨 왼쪽이라 걸리지 않는다.
      const seal = sealRightOf(label, words);
      if (!seal) {
        console.error(`[sign-positions] '${slot}' 날인칸 «${SEAL}» 을 찾지 못했습니다 `
          + `(라벨 '${LABEL}' p${label.page} x=${label.x0.toFixed(0)} y=${label.y0.toFixed(0)}).`);
        return [];
      }
      found.push({ slot, seal });
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
