import path from 'node:path';
import { replayFolder } from './replay.mjs';

// npm run replay -- <captureDir>. npm runs scripts from tools/replay, so a relative folder is taken from
// the directory npm was started in (INIT_CWD).
const [folder] = process.argv.slice(2);
if (!folder) {
  console.error('usage: npm run replay -- <captureDir>');
  process.exit(2);
}
const target = path.resolve(process.env.INIT_CWD ?? process.cwd(), folder);
const { output } = await replayFolder(target);
const hr = output.metrics.hr ? `${output.metrics.hr.value.toFixed(1)} bpm` : 'no HR';
console.log(`${target}: ${output.headlineKey}, ${hr}, ${output.cleanSeconds.toFixed(1)} clean s`);
