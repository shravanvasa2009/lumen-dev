import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { EvidenceBadge } from '@/components/EvidenceBadge';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import tokens from '@/theme/tokens.json';

import seedFile from '../../assets/evidence.json';
import { evidenceMetrics, readEvidence } from './index';

import '@/i18n';

const strength = { experimental: 0, 'public-data': 1, checked: 2 } as const;

let mockScheme: 'light' | 'dark' = 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

function fileWith(metrics: Record<string, unknown>) {
  return { commit: null, date: null, metrics };
}

describe('EVID-1: the reader never shows more than the file supports', () => {
  it.each([
    ['no file', undefined],
    ['null', null],
    ['a string', 'checked'],
    ['an empty object', {}],
    ['no metrics block', { commit: null }],
    ['metrics that is not an object', { metrics: 7 }],
  ])('%s: every metric is Experimental and not measured', (_name, file) => {
    const evidence = readEvidence(file);
    expect(Object.keys(evidence)).toEqual([...evidenceMetrics]);
    for (const metric of evidenceMetrics) {
      expect(evidence[metric]).toEqual({ label: 'experimental', measured: false });
    }
  });

  it('a missing metric, a missing label, or an unknown label is Experimental', () => {
    const evidence = readEvidence(
      fileWith({
        hr: { passed: true },
        rhythm: { label: 'gold-standard', passed: true },
        hrv: { label: 'Checked', passed: true },
        resp: { label: 42, passed: true },
        diabetes: null,
      }),
    );
    for (const metric of evidenceMetrics) expect(evidence[metric].label).toBe('experimental');
  });

  it('"checked" without a passed criterion is Experimental, with one it is Checked', () => {
    const evidence = readEvidence(
      fileWith({
        hr: { label: 'checked', passed: false },
        rhythm: { label: 'checked' },
        hrv: { label: 'checked', passed: 'true' },
        resp: { label: 'checked', passed: true },
      }),
    );
    expect(evidence.hr.label).toBe('experimental');
    expect(evidence.rhythm.label).toBe('experimental');
    expect(evidence.hrv.label).toBe('experimental');
    expect(evidence.resp).toEqual({ label: 'checked', measured: true });
  });

  it('"public-data" needs a passed criterion too, so diabetes cannot claim it without one', () => {
    const evidence = readEvidence(
      fileWith({
        diabetes: { label: 'public-data', passed: false },
        rhythm: { label: 'public-data' },
        hr: { label: 'public-data', passed: true },
      }),
    );
    expect(evidence.diabetes).toEqual({ label: 'experimental', measured: false });
    expect(evidence.rhythm).toEqual({ label: 'experimental', measured: false });
    expect(evidence.hr).toEqual({ label: 'public-data', measured: true });
  });

  it('no combination of label and passed shows a label stronger than the file states', () => {
    const labels = ['checked', 'public-data', 'experimental', 'nonsense', undefined];
    for (const label of labels) {
      for (const passed of [true, false, undefined]) {
        const shown = readEvidence(fileWith({ hr: { label, passed } })).hr.label;
        const stated = label === 'checked' || label === 'public-data' ? label : 'experimental';
        if (passed !== true) expect(shown).toBe('experimental');
        expect(strength[shown]).toBeLessThanOrEqual(strength[stated]);
      }
    }
  });

  it('the bundled seed file shows every metric, including diabetes, as Experimental', () => {
    const evidence = readEvidence(seedFile);
    for (const metric of evidenceMetrics) {
      expect(seedFile.metrics[metric].label).toBe('experimental');
      expect(evidence[metric].label).toBe('experimental');
    }
  });
});

describe.each([
  ['dark', tokens.dark],
  ['light', tokens.light],
] as const)('EvidenceBadge in the %s theme', (scheme, colors) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  it('draws nothing for Experimental unless the screen asks for it', () => {
    render(<EvidenceBadge metric="diabetes" />);
    expect(screen.queryByTestId('evidence-badge')).toBeNull();
  });

  it('shows the word, in the Experimental colours, where the Accuracy screen asks for it', () => {
    render(<EvidenceBadge metric="diabetes" showExperimental />);
    const word = screen.getByText(en['evidence.experimental']);
    expect(StyleSheet.flatten(word.props.style).color).toBe(colors.badgeFlagFg);
    expect(StyleSheet.flatten(screen.getByTestId('evidence-badge').props.style).backgroundColor).toBe(
      colors.badgeFlagBg,
    );
  });
});

describe('the evidence words exist in both languages', () => {
  it.each([
    'evidence.checked',
    'evidence.publicData',
    'evidence.experimental',
    'evidence.notTested',
  ] as const)('%s', (key) => {
    expect(en[key]).toBeTruthy();
    expect(es[key]).toBeTruthy();
  });
});
