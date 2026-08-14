/**
 * 단계 증빙 파일 저장.
 *
 * **저장 위치는 릴리스 슬롯 밖**이다. 배포는 슬롯을 통째로 갈아치우므로 슬롯 안에 두면
 * 다음 배포에 사진이 사라진다. 이미 같은 이유로 문서 저장소가 슬롯 밖에 있어
 * (`DOC_STORAGE_DIR`) 그 아래에 얹는다 — 새 환경변수를 만들면 배포 담당이 또 설정해야 한다.
 *
 * **줄이는 일은 화면에서 한다**(frontend/src/lib/imageResize.ts).
 * 현장에서 폰으로 찍은 사진은 3~5MB 인데, 신호가 약한 곳에서 그대로 올리면 올라가지 않는다.
 * 브라우저가 줄여서 보내면 올릴 양 자체가 1/10 이 되고, 서버에 네이티브 이미지 라이브러리
 * (sharp 등)를 들이지 않아도 된다. 서버는 **한도를 지키는 쪽**만 맡는다 — 화면을 못 믿어서가
 * 아니라, 못 줄이는 브라우저나 직접 부르는 요청이 있어도 저장소가 터지지 않아야 하기 때문이다.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { docStorageDir } from './soffice.js';
import { keepsOriginal, type EvidenceKind } from '@buildup-ev/shared/process';

/** 사진(줄여서 올라온다) · 서류(원본) 각각의 상한. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;    // 줄이면 보통 0.2~0.5MB — 8MB 는 안전망
export const MAX_DOC_BYTES = 20 * 1024 * 1024;

/**
 * 받아 주는 형식.
 * ⚠️ **SVG 는 받지 않는다.** 그 안에 스크립트가 들어갈 수 있어, 나중에 브라우저로 열면
 *    우리 도메인에서 실행된다. 증빙은 사진과 PDF 면 충분하다.
 */
export const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',   // 아이폰 원본. 브라우저가 못 줄이면 그대로 올라온다
  'application/pdf': '.pdf',
};

export function maxBytesFor(kind: EvidenceKind): number {
  return keepsOriginal(kind) ? MAX_DOC_BYTES : MAX_PHOTO_BYTES;
}

/** 제어문자(0x00-0x1f, 0x7f)와 경로 구분자 */
const CTRL_OR_SEP = new RegExp('[\\u0000-\\u001f\\u007f/\\\\]', 'g');

/** 저장 루트 — 문서 저장소 아래 `uploads/`. */
export function uploadRoot(): string {
  return path.join(docStorageDir(), 'uploads');
}

/**
 * 주문별 폴더에 무작위 이름으로 저장한다.
 *
 * 원래 파일명을 경로에 쓰지 않는 이유: 이름에 `../` 이나 널바이트가 들어오면 저장 위치가
 * 밖으로 새어 나간다. 사람이 볼 이름은 DB(`original_name`)에 따로 남기고, 디스크 이름은
 * 우리가 만든 것만 쓴다.
 */
export async function reserveFilePath(orderId: number, mime: string): Promise<{ abs: string; rel: string }> {
  const ext = ALLOWED_MIME[mime] ?? '.bin';
  const dir = path.join(uploadRoot(), String(orderId));
  await mkdir(dir, { recursive: true });
  const name = `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`;
  return { abs: path.join(dir, name), rel: path.join(String(orderId), name) };
}

/**
 * DB 에 적힌 상대경로 → 실제 경로. **루트 밖으로 나가면 거절한다.**
 * 경로가 DB 에서 온다고 안전한 것은 아니다 — 한 번이라도 이상한 값이 들어가면
 * 그 뒤로는 파일 읽기가 곧 임의 파일 읽기가 된다.
 */
export function resolveStoredPath(rel: string): string | null {
  const root = path.resolve(uploadRoot());
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

/**
 * 사람이 볼 이름 — **제어문자와 경로 구분자만** 걷어낸다.
 * 공백·하이픈까지 지우면 「인수증 2026-08-14.pdf」를 알아보기 어려워진다.
 * 이 값은 파일 경로에 쓰이지 않는다(경로는 우리가 만든 이름만 쓴다) — 표시용이다.
 */
export function safeDisplayName(name: string): string {
  return name.replace(CTRL_OR_SEP, '_').slice(0, 200);
}
