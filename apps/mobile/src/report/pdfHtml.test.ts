import i18next from 'i18next';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { readingById, readingsOnDay, type FixtureReading } from '@/results/fixtures';
import tokens from '@/theme/tokens.json';

import { buildReportHtml } from './pdfHtml';

import '@/i18n';

const demo = readingById('demo') as FixtureReading;
const englishT = i18next.getFixedT('en');

function htmlFor(options: { demo?: boolean; t?: typeof englishT; language?: string } = {}): string {
  return buildReportHtml({
    t: options.t ?? englishT,
    language: options.language ?? 'en',
    reading: demo,
    dayReadings: readingsOnDay(demo.createdAt),
    demo: options.demo ?? true,
  });
}

// The stylesheet has "100%" widths, which are not figures about a measurement.
const pageText = (html: string) => html.replace(/<style>[\s\S]*<\/style>/, '');

const flaggedReading = readingById('demo-flag') as FixtureReading;
const secondFlagged: FixtureReading = { ...flaggedReading, id: 'demo-flag-2' };
const pageCount = (html: string) => html.match(/<section class="page">/g)?.length ?? 0;

describe('buildReportHtml pages', () => {
  it('makes one page for the one flagged reading on the demo day', () => {
    expect(pageCount(htmlFor())).toBe(1);
  });

  it('makes one page per flagged reading, each with the header and a page break rule', () => {
    const html = buildReportHtml({
      t: englishT,
      language: 'en',
      reading: demo,
      dayReadings: [demo, flaggedReading, secondFlagged],
      demo: true,
    });
    expect(pageCount(html)).toBe(2);
    expect(html.match(new RegExp(en['prototype.banner'], 'g'))).toHaveLength(2);
    expect(html).toContain('.page { break-after: page; page-break-after: always; }');
    expect(html).toContain('.page:last-child { break-after: auto; page-break-after: auto; }');
    expect(pageText(html).match(/Experimental\. Not yet tested\./g)).toHaveLength(4);
  });

  it('makes a single page for the opened reading when nothing is flagged', () => {
    const html = buildReportHtml({
      t: englishT,
      language: 'en',
      reading: demo,
      dayReadings: [demo],
      demo: true,
    });
    expect(pageCount(html)).toBe(1);
    expect(html.includes(en['report.flagLabel'])).toBe(false);
    expect(html).toContain(en['prototype.banner']);
  });
});

describe('buildReportHtml', () => {
  it('opens with the prototype header and the report heading', () => {
    const html = htmlFor();
    expect(html).toContain(en['prototype.banner']);
    expect(html).toContain(en['report.heading']);
    expect(html).toContain('Sep 27, 2026');
  });

  it('draws in the light tokens only', () => {
    const html = htmlFor();
    expect(html).toContain(tokens.light.surface);
    expect(html).toContain(tokens.light.text);
    for (const dark of [tokens.dark.surface, tokens.dark.surface2, tokens.dark.text]) {
      expect(html.includes(dark)).toBe(false);
    }
    expect(html.includes(tokens.light.criticalText)).toBe(false);
  });

  it('escapes angle brackets, ampersands and both kinds of quote in every string', () => {
    const hostile = `<img src=x onerror="alert('hi')"> & more`;
    const hostileCopy = i18next.createInstance();
    void hostileCopy.init({
      lng: 'en',
      keySeparator: false,
      initAsync: false,
      interpolation: { escapeValue: false },
      resources: { en: { translation: { ...en, 'report.heading': hostile, 'report.method': hostile } } },
    });
    const html = htmlFor({ t: hostileCopy.t });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(&#39;hi&#39;)&quot;&gt; &amp; more');
  });

  it('tabulates the flagged reading and draws its interval strip', () => {
    const html = htmlFor();
    expect(html).toContain(`<th>${en['report.colRhythm']}</th>`);
    expect(html.match(/<tr><td>/g)).toHaveLength(1);
    expect(html.match(/<svg /g)).toHaveLength(1);
    expect(html).toContain(en['report.flagRhythmOne']);
    expect(html).toContain(en['report.intervalNote']);
    expect(html).toContain(en['demo.synthetic']);
  });

  it('marks Demo only for demo data', () => {
    expect(htmlFor({ demo: true })).toContain(`>${en['report.demoMark']}</span>`);
    expect(htmlFor({ demo: false }).includes(en['report.demoMark'])).toBe(false);
  });

  it('leaves experimental measurements out and says so', () => {
    const html = htmlFor();
    expect(html).toContain(en['report.leftOut']);
    expect(html).not.toMatch(/HRV|Breathing|extra beats|pulse shape|Diabetes/i);
  });

  it('shows Experimental and Not yet tested with no evidence file, with no accuracy figure (EVID-1)', () => {
    const html = pageText(htmlFor());
    expect(html).toMatch(/Heart rate: Experimental\. Not yet tested\./);
    expect(html).toMatch(/Rhythm check: Experimental\. Not yet tested\./);
    expect(html).not.toMatch(/\d+(\.\d+)?%|Average error|Sensitivity|AUROC/);
  });

  it('states the method, the limits and that nothing is uploaded', () => {
    const html = htmlFor();
    expect(html).toContain(en['report.method']);
    expect(html).toContain(en['report.pdfFooter']);
    expect(en['report.pdfFooter']).toContain('Nothing is uploaded.');
  });

  it('follows the app language', () => {
    const html = htmlFor({ t: i18next.getFixedT('es'), language: 'es' });
    expect(html).toContain('<html lang="es">');
    expect(html).toContain(es['prototype.banner']);
    expect(html).toContain(es['report.pdfFooter']);
    expect(html.includes(en['report.method'])).toBe(false);
  });
});
