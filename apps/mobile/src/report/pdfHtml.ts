import type { TFunction } from 'i18next';

import { evidenceFor } from '@/evidence';
import type { FixtureReading } from '@/results/fixtures';

import {
  columnHeadings,
  diabetesFor,
  diabetesSentence,
  formatFullDate,
  pdfPageReadings,
  reportEvidence,
  stripsFor,
  tableRows,
} from './model';
import { paper } from './paper';
import { stripHeight, stripInset, stripPoints, stripWidth } from './stripGeometry';

const entities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

// Every string that reaches the page goes through here: translations and fixture text are not trusted
// to be free of markup.
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

const stylesheet = `
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: ${paper.text}; background: ${paper.surface}; margin: 24px; font-size: 13px; line-height: 1.45; }
  h1 { font-size: 20px; margin: 0; color: ${paper.accent}; }
  header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .banner { color: ${paper.flag}; font-weight: 700; margin: 8px 0; }
  .demo { display: inline-block; background: ${paper.badgeExperimentalBg}; color: ${paper.badgeExperimentalFg}; font-weight: 700; font-size: 11px; padding: 2px 10px; border-radius: 999px; }
  .dim { color: ${paper.textDim}; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th { background: ${paper.surface2}; text-align: left; font-size: 11px; padding: 6px; }
  td { font-size: 11px; padding: 6px; border-bottom: 1px solid ${paper.line}; }
  figure { margin: 8px 0; }
  figcaption { font-weight: 700; }
  svg { width: 100%; height: auto; }
  p { margin: 8px 0; }
  .page { break-after: page; page-break-after: always; }
  .page:last-child { break-after: auto; page-break-after: auto; }
  footer { margin-top: 16px; font-size: 11px; color: ${paper.textDim}; }
`;

function stripSvg(intervalsMs: readonly number[], color: string, caption: string): string {
  const dots = stripPoints(intervalsMs);
  const line = dots.map(({ x, y }) => `${x},${y}`).join(' ');
  const circles = dots.map(({ x, y }) => `<circle cx="${x}" cy="${y}" r="1.75" fill="${color}"/>`).join('');
  return (
    `<svg viewBox="0 0 ${stripWidth} ${stripHeight}" role="img" aria-label="${escapeHtml(caption)}">` +
    `<line x1="${stripInset}" x2="${stripWidth - stripInset}" y1="${stripHeight / 2}" y2="${stripHeight / 2}" stroke="${paper.line}" stroke-width="1"/>` +
    `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.75" stroke-linejoin="round"/>` +
    `${circles}</svg>`
  );
}

type ReportPdf = {
  t: TFunction;
  language: string;
  reading: FixtureReading;
  dayReadings: readonly FixtureReading[];
  demo: boolean;
};

function pageHtml(
  { t, language, demo }: Pick<ReportPdf, 't' | 'language' | 'demo'>,
  page: FixtureReading,
): string {
  const diabetes = diabetesFor([page], evidenceFor('diabetes').measured);
  const { rhythm, hr } = page.scan.metrics;
  const flagLines = [
    rhythm?.flag ? t('report.flagRhythmOne') : null,
    hr?.flag ? t('report.flagHrOne') : null,
  ].flatMap((line) =>
    line === null ? [] : [`<p><b>${escapeHtml(t('report.flagLabel'))}</b> ${escapeHtml(line)}</p>`],
  );
  const head = columnHeadings(t)
    .map((heading) => `<th>${escapeHtml(heading)}</th>`)
    .join('');
  const body = tableRows(t, language, [page])
    .map(({ cells }) => `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  const strips = stripsFor(t, language, [page]);
  const stripFigures = strips.map(
    ({ caption, intervalsMs, flagged }) =>
      `<figure><figcaption>${escapeHtml(caption)}</figcaption>${stripSvg(intervalsMs, flagged ? paper.flag : paper.text, caption)}</figure>`,
  );
  const notes = [
    strips.length > 0 ? `<p class="dim">${escapeHtml(t('report.intervalNote'))}</p>` : '',
    page.synthetic ? `<p class="dim">${escapeHtml(t('demo.synthetic'))}</p>` : '',
  ];

  return [
    '<section class="page">',
    `<header><h1>${escapeHtml(t('report.heading'))}</h1><span class="dim">${escapeHtml(formatFullDate(page.createdAt, language))}</span></header>`,
    demo ? `<span class="demo">${escapeHtml(t('report.demoMark'))}</span>` : '',
    `<p class="banner">${escapeHtml(t('prototype.banner'))}</p>`,
    ...flagLines,
    `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
    diabetes
      ? `<p><b>${escapeHtml(t('report.diabetesLabel'))}</b> ${escapeHtml(diabetesSentence(t, language, diabetes))}</p>`
      : '',
    ...stripFigures,
    ...notes,
    `<p class="dim"><b>${escapeHtml(`${t('report.evidence')}:`)}</b> ${escapeHtml(reportEvidence(t, language, diabetes !== null))}</p>`,
    `<p class="dim"><b>${escapeHtml(t('report.methodLabel'))}</b> ${escapeHtml(t('report.method'))}</p>`,
    `<p class="dim">${escapeHtml(t('report.leftOut'))}</p>`,
    `<footer>${escapeHtml(t('report.pdfFooter'))}</footer>`,
    '</section>',
  ].join('');
}

// One page per flagged reading of the opened reading's day (§12.5), as HTML for expo-print. Experimental
// measurements have no section (§12.5), and the evidence paragraph comes from evidence.json through the
// shared helpers.
export function buildReportHtml({ t, language, reading, dayReadings, demo }: ReportPdf): string {
  const pages = pdfPageReadings(reading, dayReadings).map((page) => pageHtml({ t, language, demo }, page));
  return [
    `<!DOCTYPE html><html lang="${escapeHtml(language)}"><head><meta charset="utf-8"><title>${escapeHtml(t('report.heading'))}</title><style>${stylesheet}</style></head><body>`,
    ...pages,
    '</body></html>',
  ].join('');
}
