import { assertRuntimeConfig, config } from './config.js';
import { createApp } from './app.js';
import { startDueNudge } from './services/due-nudge.js';
import { loadHolidays } from './services/holidays.js';

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
  /*
   * 공휴일 달력을 계산에 물린다 — 납기 한도는 「배정일로부터 N영업일」이라
   * 연휴가 빠지지 않으면 특장사가 고를 수 있는 날짜가 실제보다 적어진다.
   * 실패해도 서버는 뜬다(주말만 빼는 예전 계산으로 돈다).
   */
  void loadHolidays(true).then(n => {
    if (n > 0) console.log(`[holidays] 공휴일 ${n}일을 영업일 계산에 반영했습니다`);
  });
});
