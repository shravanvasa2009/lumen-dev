import { memoryFiles, mockFileSystem } from '@/testing/memoryFiles';

import type { PlannedNotification } from './plan';
import { loadScheduleRecord, saveScheduleRecord } from './record';

jest.mock('expo-file-system', () => mockFileSystem);

const DAILY: PlannedNotification = {
  id: 'daily-2026-10-12T08:00',
  type: 'daily',
  fireAt: '2026-10-12T08:00:00-05:00',
  route: 'lumen://check',
  createdFor: 'daily',
};

beforeEach(() => memoryFiles.clear());

describe('schedule record', () => {
  it('is empty before the first sync', () => {
    expect(loadScheduleRecord()).toEqual([]);
  });

  it('keeps what was saved', () => {
    saveScheduleRecord([DAILY]);
    expect(loadScheduleRecord()).toEqual([DAILY]);
    saveScheduleRecord([]);
    expect(loadScheduleRecord()).toEqual([]);
  });

  it('skips entries an older or edited file holds wrongly', () => {
    memoryFiles.set(
      'notification-schedule.json',
      JSON.stringify([DAILY, { ...DAILY, type: 'weekly' }, { ...DAILY, fireAt: 'soon' }, 'daily']),
    );
    expect(loadScheduleRecord()).toEqual([DAILY]);
  });

  it('reports a damaged file and starts a new record', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    memoryFiles.set('notification-schedule.json', '[{"id":');
    expect(loadScheduleRecord()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('schedule record could not be read'));
    warn.mockRestore();
  });
});
