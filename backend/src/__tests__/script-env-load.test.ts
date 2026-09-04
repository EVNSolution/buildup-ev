import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * **운영에서 돌리는 스크립트는 env 를 먼저 실어야 한다.**
 *
 * 이 앱에는 dotenv 가 없다. `config.ts` 가 릴리스 루트의 `.env` 를 읽어 `process.env` 에
 * 넣고, `server.ts` 는 그것을 **가장 먼저** import 한다.
 *
 * 스크립트가 그 순서를 안 지키면 prisma·push 가 **빈 환경으로 먼저 만들어진다.**
 * 실제로 운영에서 「DB 연결이 없습니다」로 죽었고, 푸시도 「VAPID 키가 없다」고 했다 —
 * 둘 다 실제로는 설정돼 있었는데도.
 */
const ROOT = path.resolve(__dirname, '../../..');
const DIR = path.join(ROOT, 'backend/src/scripts');

describe('운영 스크립트', () => {
  const scripts = readdirSync(DIR).filter(f => f.endsWith('.ts'));

  it('스크립트가 있다', () => expect(scripts.length).toBeGreaterThan(0));

  it.each(scripts)('%s — DB·알림을 쓰면 config 를 먼저 부른다', file => {
    const src = readFileSync(path.join(DIR, file), 'utf8');
    const usesEnv = /from '\.\.\/lib\/prisma\.js'|from '\.\.\/services\//.test(src);
    if (!usesEnv) return;

    const imports = [...src.matchAll(/^import .*?['"](.+?)['"];?$/gm)].map(m => m[1]!);
    expect(imports[0], `${file}: config.js 를 가장 먼저 import 해야 한다`).toBe('../config.js');
  });
});
