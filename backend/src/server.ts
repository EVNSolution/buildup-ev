import { assertRuntimeConfig, config } from './config.js';
import { createApp } from './app.js';

assertRuntimeConfig();
const app = createApp();
app.listen(config.port, () => {
  console.log(`buildup-ev API listening on :${config.port} [${config.nodeEnv}]`);
});
