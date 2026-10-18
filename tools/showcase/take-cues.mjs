import { execFileSync, spawn } from 'node:child_process';

// node tools/showcase/take-cues.mjs nitin-practice|nitin-scan|shravan-practice|shravan-scan
// Speaks the countdown and the moves for one showcase take, on a Mac (`say`) or Windows (System.Speech), for a
// phone the computer can't press: the person taps Start in the Lab on "Go" and Stop when told. The A17 has its
// own driven version (tools/showcase-cues.ps1 in the workspace). The moves match it: camera at the floor, the
// finger on at 4 s, then still; the take keeps that opening, and the film shows it.

const TAKES = { practice: 50, scan: 120 };
const take = process.argv[2] ?? '';
const kind = take.split('-').at(-1);
const lengthS = TAKES[kind];
if (!/^(nitin|shravan)-(practice|scan)$/.test(take) || lengthS === undefined) {
  console.error('usage: node tools/showcase/take-cues.mjs <nitin|shravan>-<practice|scan>');
  process.exit(1);
}

const CUES = {
  0: 'Point the camera at the floor',
  4: 'Finger on, flat over the lens and the flash. Then hold still',
};

function speak(text, wait = false) {
  const command =
    process.platform === 'darwin'
      ? ['say', [text]]
      : [
          'powershell',
          [
            '-NoProfile',
            '-Command',
            `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${text.replace(/'/g, "''")}')`,
          ],
        ];
  if (wait) execFileSync(command[0], command[1]);
  else spawn(command[0], command[1], { stdio: 'ignore' });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

speak(
  `Recording ${take.replace('-', ' ')}. Hold the phone with the camera facing the floor. Tap Start on Go.`,
  true,
);
for (const count of ['3', '2', '1']) {
  speak(count, true);
  await sleep(600);
}
speak('Go');
const goMs = Date.now();
for (let second = 0; second <= lengthS; second += 1) {
  await sleep(Math.max(0, goMs + second * 1000 - Date.now()));
  console.log(`${String(second).padStart(3)} s`);
  if (CUES[second]) speak(CUES[second]);
  else if (second > 0 && second % 10 === 0) speak(String(second));
}
speak('Stop. Tap Stop, then Send to PC.', true);
