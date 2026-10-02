import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { printToFileAsync } from 'expo-print';
import { renderRouter } from 'expo-router/testing-library';
import * as Sharing from 'expo-sharing';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';

jest.mock('expo-print', () => ({ printToFileAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

const printToFile = jest.mocked(printToFileAsync);
const isAvailable = jest.mocked(Sharing.isAvailableAsync);
const share = jest.mocked(Sharing.shareAsync);

const pdfUri = 'file:///cache/Print/report.pdf';

function openReport(id: string) {
  renderRouter('./app', { initialUrl: `/report/${id}` });
}

const shareButton = () => screen.getByRole('button', { name: en['report.sharePdf'] });

beforeEach(() => {
  jest.resetAllMocks();
  printToFile.mockResolvedValue({ uri: pdfUri, numberOfPages: 1 });
  isAvailable.mockResolvedValue(true);
  share.mockResolvedValue(undefined);
});

describe('Share PDF', () => {
  it('prints the report to a file, then opens the share sheet for a PDF', async () => {
    openReport('demo');
    fireEvent.press(shareButton());
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(printToFile).toHaveBeenCalledTimes(1);
    const [{ html }] = printToFile.mock.calls[0] as [{ html: string }];
    expect(html).toContain(en['prototype.banner']);
    expect(share).toHaveBeenCalledWith(pdfUri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
    expect(printToFile.mock.invocationCallOrder[0]).toBeLessThan(share.mock.invocationCallOrder[0] as number);
    expect(screen.queryByText(en['report.shareFailed'])).toBeNull();
    await waitFor(() => expect(shareButton()).toBeEnabled());
  });

  it('disables the button and says it is preparing while the PDF is made', async () => {
    let finishPrinting: (file: { uri: string; numberOfPages: number }) => void = () => undefined;
    printToFile.mockReturnValue(new Promise((resolve) => (finishPrinting = resolve)));
    openReport('demo');
    fireEvent.press(shareButton());
    const busy = await screen.findByRole('button', { name: en['report.sharing'] });
    expect(busy).toBeDisabled();
    fireEvent.press(busy);
    expect(printToFile).toHaveBeenCalledTimes(1);
    finishPrinting({ uri: pdfUri, numberOfPages: 1 });
    await waitFor(() => expect(shareButton()).toBeEnabled());
    expect(share).toHaveBeenCalledTimes(1);
  });

  it('says so, and does not open a share sheet, when sharing is unavailable', async () => {
    isAvailable.mockResolvedValue(false);
    openReport('demo');
    fireEvent.press(shareButton());
    expect(await screen.findByText(en['report.shareFailed'])).toBeOnTheScreen();
    expect(share).not.toHaveBeenCalled();
    expect(shareButton()).toBeEnabled();
  });

  it.each([
    ['printing', () => printToFile.mockRejectedValue(new Error('no printer'))],
    ['the share sheet', () => share.mockRejectedValue(new Error('cancelled by system'))],
  ])('says so when %s throws', async (_name, breakIt) => {
    breakIt();
    openReport('demo');
    fireEvent.press(shareButton());
    expect(await screen.findByText(en['report.shareFailed'])).toBeOnTheScreen();
    expect(shareButton()).toBeEnabled();
  });

  it('keeps the share-sheet caption and has no "later update" note', () => {
    openReport('demo');
    expect(screen.getByText(en['report.sharedOnly'])).toBeOnTheScreen();
    expect(screen.queryByText(/later update/)).toBeNull();
  });

  it('has no Share button for an id that is not a reading', () => {
    openReport('nope');
    expect(screen.queryByRole('button', { name: en['report.sharePdf'] })).toBeNull();
  });

  it('words the failure and busy lines in Spanish too', () => {
    expect(es['report.shareFailed']).not.toBe(en['report.shareFailed']);
    expect(es['report.sharing']).not.toBe(en['report.sharing']);
  });
});
