import { config } from './config.js';
import { createApp } from './app.js';

const app = createApp();
app.listen(config.port, () => {
  console.log(`buildup-ev API listening on :${config.port} [${config.nodeEnv}]`);
});
