/**
 * 올리기 전에 사진을 줄인다 — **브라우저에서.**
 *
 * 현장에서 폰으로 찍은 사진은 3~5MB 다. 신호가 약한 곳에서 그대로 올리면 올라가지 않고,
 * 서버에서 줄이려면 5MB 를 먼저 다 올려야 한다. 브라우저가 줄여 보내면 올릴 양이
 * 1/10 이 되고 서버에 네이티브 이미지 라이브러리도 필요 없다.
 *
 * **검수 사진은 「왔다는 증거」가 아니라 「상태를 따지는 근거」다**(하자 다툼에 쓰인다).
 * 그래서 긴 변 2400px · 화질 0.85 로 넉넉히 잡는다 — 흠집이나 라벨을 확대해 볼 수 있어야 한다.
 *
 * ⚠️ 서류(인수증·자동차등록증·승인서)는 이 함수를 **거치지 않는다.** 글자를 읽어야 하고
 *    관청·분쟁에 쓰이므로 원본 그대로 올린다(shared/process/steps.ts KEEP_ORIGINAL).
 */

/** 긴 변 상한 — 확대해서 흠집을 볼 수 있는 선. */
export const MAX_EDGE = 2400;
/** JPEG 화질 — 0.85 아래로 내리면 압축 자국이 흠집처럼 보인다(다툼의 근거로 쓰기 어렵다). */
export const JPEG_QUALITY = 0.85;

/** 줄일 수 있는 형식인지. HEIC 는 브라우저가 대개 못 그린다 — 원본으로 보낸다. */
function canResize(file: File): boolean {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽지 못했습니다')) };
    img.src = url;
  });
}

export interface ResizeResult {
  file: File;
  /** 실제로 줄였는지 — 화면에 「원본 그대로 올립니다」를 알려 주기 위해 */
  resized: boolean;
  beforeBytes: number;
  afterBytes: number;
}

/**
 * 긴 변이 상한을 넘으면 줄인다.
 *
 * **줄일 수 없거나 실패하면 원본을 그대로 돌려준다.** 줄이기는 편의이지 관문이 아니다 —
 * 여기서 예외를 던지면 사진을 못 올리게 되고, 그건 줄이지 못하는 것보다 나쁘다.
 * (서버가 크기 상한을 따로 지키므로 너무 큰 파일은 거기서 걸린다)
 */
export async function shrinkImage(file: File): Promise<ResizeResult> {
  const before = file.size;
  const asIs = (resized: boolean): ResizeResult => ({ file, resized, beforeBytes: before, afterBytes: before });

  if (!canResize(file)) return asIs(false);

  try {
    const img = await loadImage(file);
    const long = Math.max(img.width, img.height);
    if (long <= MAX_EDGE) return asIs(false);   // 이미 작으면 다시 압축하지 않는다

    const scale = MAX_EDGE / long;
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return asIs(false);
    // 축소는 부드럽게 — 기본값으로 줄이면 계단이 생겨 흠집처럼 보인다
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', JPEG_QUALITY));
    if (!blob) return asIs(false);
    // 줄였는데 오히려 커지면(작은 PNG 등) 원본을 쓴다
    if (blob.size >= before) return asIs(false);

    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return {
      file: new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified }),
      resized: true,
      beforeBytes: before,
      afterBytes: blob.size,
    };
  } catch {
    // 못 줄여도 올리는 길은 막지 않는다
    return asIs(false);
  }
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${Math.round(n / 1024 / 102.4) / 10}MB`;
}
