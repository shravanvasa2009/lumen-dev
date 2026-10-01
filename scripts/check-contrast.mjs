import fs from 'node:fs';

// UI-3: every text and icon pair in both themes meets WCAG 2.1 AA. Reads the app's own theme tokens,
// so a color change that breaks contrast fails CI.
const tokens = JSON.parse(fs.readFileSync('apps/mobile/src/theme/tokens.json', 'utf8'));
const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const failures = [];
let checked = 0;
for (const theme of ['dark', 'light']) {
  for (const pair of tokens.pairs) {
    for (const bg of pair.bg) {
      const value = ratio(tokens[theme][pair.fg], tokens[theme][bg]);
      checked += 1;
      if (value < pair.min) failures.push(`${theme}: ${pair.fg} on ${bg} = ${value.toFixed(2)}:1 (needs ${pair.min}:1)`);
    }
  }
}
if (failures.length) {
  console.error(`UI-3 failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`UI-3 OK: ${checked} token pairs meet WCAG AA in both themes`);
