import path from 'node:path';
import { replayFolder } from './replay.mjs';

// npm run replay -- [--rhythm-from-label] <captureDir>. npm runs scripts from tools/replay, so a
// relative folder is taken from the directory npm was started in (INIT_CWD).
const args = process.argv.slice(2);
const rhythmFromLabel = args.includes('--rhythm-from-label');
const folders = args.filter((arg) => arg !== '--rhythm-from-label');
if (folders.length !== 1 || folders[0].startsWith('--')) {
  console.error('usage: npm run replay -- [--rhythm-from-label] <captureDir>');
  process.exit(2);
}
const target = path.resolve(process.env.INIT_CWD ?? process.cwd(), folders[0]);
const { output } = await replayFolder(target, { rhythmFromLabel });
const hr = output.metrics.hr ? `${output.metrics.hr.value.toFixed(1)} bpm` : 'no HR';
console.log(`${target}: ${output.headlineKey}, ${hr}, ${output.cleanSeconds.toFixed(1)} clean s`);
