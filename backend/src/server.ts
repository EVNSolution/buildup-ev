import { assertRuntimeConfig, config } from './config.js';
import { createApp } from './app.js';
import { startDueNudge } from './services/due-nudge.js';

assertRuntimeConfig();
const app = createApp();
app.listen(config.port, () => {
  console.log(`buildup-ev API listening on :${config.port} [${config.nodeEnv}]`);
  /*
   * 납기 알림 — 정기 실행 장치(cron·systemd timer)가 따로 없어 **프로세스 안에서** 돈다.
   * blue/green 으로 두 슬롯이 잠깐 함께 도는 순간이 있지만, 발송 기록을 DB 에서
   * 유일하게 두어 두 번 가지 않는다(due-nudge.ts).
   */
  startDueNudge();
});
