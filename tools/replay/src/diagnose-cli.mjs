import fs from 'node:fs';
import path from 'node:path';
import { diagnoseFolder, formatReport } from './diagnose.mjs';

// npm run diagnose -- [--ref <bpm>] <captureDir>... : where the heart rate goes wrong in each Lab capture.
// The reference is the owner's own count or a pulse oximeter; a capture's polar_rr.csv is used when --ref is
// absent. Each report is also written as diagnose.json next to the capture.
const args = process.argv.slice(2);
const refAt = args.indexOf('--ref');
const referenceBpm = refAt === -1 ? null : Number(args[refAt + 1]);
const folders = refAt === -1 ? args : args.filter((_, i) => i !== refAt && i !== refAt + 1);
if (folders.length === 0 || (referenceBpm !== null && !(referenceBpm > 0))) {
  console.error('usage: npm run diagnose -- [--ref <bpm>] <captureDir>...');
  process.exit(2);
}
for (const folder of folders) {
  const target = path.resolve(process.env.INIT_CWD ?? process.cwd(), folder);
  const report = await diagnoseFolder(target, { referenceBpm });
  fs.writeFileSync(path.join(target, 'diagnose.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(formatReport(report));
}
