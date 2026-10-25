import { execFileSync, spawn } from 'node:child_process';

// node tools/showcase/take-cues.mjs nitin-practice|nitin-scan|shravan-practice|shravan-scan
// Speaks the countdown and the moves for one showcase take, on a Mac (`say`) or Windows (System.Speech). Both
// people can record at once: each phone's Camera app records video with the flash on, started on "Go". The
// camera shows the carpet for the first 3 s, then the finger goes on and stays still (owner, 2026-10-25: 2–4 s
// of carpet); the take keeps that opening and the film shows it. tools/showcase/video-take.mjs makes the take.

const TAKES = { practice: 50, scan: 120 };
const take = process.argv[2] ?? '';
const kind = take.split('-').at(-1);
const lengthS = TAKES[kind];
if (!/^(nitin|shravan)-(practice|scan)$/.test(take) || lengthS === undefined) {
  console.error('usage: node tools/showcase/take-cues.mjs <nitin|shravan>-<practice|scan>');
  process.exit(1);
}

const CUES = {
  0: 'Camera at the carpet',
  3: 'Finger on, flat over the lens and the flash. Then hold still',
};
// The scan take's slip; video-take.mjs finds when the video shows it, and the app coaches it then.
const SCAN_CUES = { 41: 'Slide your finger half off the lens', 45: 'Back on, flat. Hold still' };

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
  `Recording ${take.replace('-', ' ')}. Camera app on video, flash on, camera facing the carpet. Tap record on Go.`,
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
  const cue = CUES[second] ?? (kind === 'scan' ? SCAN_CUES[second] : undefined);
  if (cue) speak(cue);
  else if (second > 0 && second % 10 === 0) speak(String(second));
}
speak('Stop. Lift your finger and stop the recording.', true);
