import {
  type NotificationPrefs,
  type NotificationTriggers,
  type NotificationType,
  planNotifications,
  type PlannedNotification,
  scheduleRecord,
} from './plan';

const CHICAGO = 'America/Chicago';
const at = (iso: string) => Date.parse(iso);

const NO_TRIGGERS: NotificationTriggers = {
  confirmationFor: null,
  doctorFollowupFor: null,
  standingStartedAt: null,
  lastPhoneCheckAt: null,
};

type PlanInput = {
  now: string;
  on: readonly NotificationType[];
  triggers?: Partial<NotificationTriggers>;
  dailyTime?: NotificationPrefs['dailyTime'];
  quietHours?: NotificationPrefs['quietHours'];
  timeZone?: string;
  previousSchedule?: readonly PlannedNotification[];
};

function plan({
  now,
  on,
  triggers = {},
  dailyTime,
  quietHours,
  timeZone = CHICAGO,
  previousSchedule = [],
}: PlanInput) {
  const types: readonly NotificationType[] = [
    'daily',
    'confirmation',
    'doctor-followup',
    'standing',
    'retest',
  ];
  return planNotifications({
    prefs: {
      enabled: Object.fromEntries(
        types.map((type) => [type, on.includes(type)]),
      ) as NotificationPrefs['enabled'],
      dailyTime: dailyTime ?? { hour: 8, minute: 0 },
      quietHours: quietHours ?? { start: { hour: 21, minute: 0 }, end: { hour: 7, minute: 0 } },
    },
    triggers: { ...NO_TRIGGERS, ...triggers },
    now: at(now),
    timeZone,
    previousSchedule,
  });
}

// Runs syncs one after another, each starting from the record the one before saved, as the scheduler does.
function syncInTurn(...syncs: readonly PlanInput[]) {
  return syncs.reduce<{ planned: PlannedNotification[]; record: PlannedNotification[] }>(
    ({ record }, input) => {
      const planned = plan({ ...input, previousSchedule: record });
      return { planned, record: scheduleRecord(record, planned, at(input.now)) };
    },
    { planned: [], record: [] },
  );
}

const typesOn = (day: string, entries: readonly PlannedNotification[]) =>
  entries.filter(({ fireAt }) => fireAt.startsWith(day)).map(({ type }) => type);

const fireTimes = (entries: ReturnType<typeof plan>) => entries.map(({ fireAt }) => fireAt);
const NO_QUIET_HOURS = { start: { hour: 0, minute: 0 }, end: { hour: 0, minute: 0 } };

describe('each type', () => {
  it('schedules the daily check at the chosen local time for the next 30 days', () => {
    const entries = plan({ now: '2026-10-05T10:00:00-05:00', on: ['daily'] });
    expect(entries).toHaveLength(30);
    expect(entries[0]).toEqual({
      id: 'daily-2026-10-06T08:00',
      type: 'daily',
      fireAt: '2026-10-06T08:00:00-05:00',
      route: 'lumen://check',
      createdFor: 'daily',
    });
    expect(entries.at(-1)?.fireAt).toBe('2026-11-04T08:00:00-06:00');
  });

  it('includes today when the daily time is still ahead', () => {
    const entries = plan({ now: '2026-10-05T07:59:00-05:00', on: ['daily'] });
    expect(entries[0]?.fireAt).toBe('2026-10-05T08:00:00-05:00');
  });

  it('asks for a confirmation later the same day and the next morning', () => {
    const entries = plan({
      now: '2026-10-04T07:46:00-05:00',
      on: ['confirmation'],
      triggers: { confirmationFor: { readingId: 'reading-7f3a', takenAt: at('2026-10-04T07:45:00-05:00') } },
    });
    expect(entries).toEqual([
      {
        id: 'confirm-2026-10-04T11:45',
        type: 'confirmation',
        fireAt: '2026-10-04T11:45:00-05:00',
        route: 'lumen://check?mode=full',
        createdFor: 'reading-7f3a',
      },
      {
        id: 'confirm-2026-10-05T08:00',
        type: 'confirmation',
        fireAt: '2026-10-05T08:00:00-05:00',
        route: 'lumen://check?mode=full',
        createdFor: 'reading-7f3a',
      },
    ]);
  });

  it('keeps only the morning confirmation when quiet hours push the same-day one past midnight', () => {
    const entries = plan({
      now: '2026-10-04T19:01:00-05:00',
      on: ['confirmation'],
      triggers: { confirmationFor: { readingId: 'reading-late', takenAt: at('2026-10-04T19:00:00-05:00') } },
    });
    expect(fireTimes(entries)).toEqual(['2026-10-05T08:00:00-05:00']);
  });

  it('asks about a doctor visit 7 days after a flagged result', () => {
    const entries = plan({
      now: '2026-10-04T15:31:00-05:00',
      on: ['doctor-followup'],
      triggers: {
        doctorFollowupFor: { readingId: 'reading-9c1d', takenAt: at('2026-10-04T15:30:00-05:00') },
      },
    });
    expect(entries).toEqual([
      {
        id: 'doctor-2026-10-11T15:30',
        type: 'doctor-followup',
        fireAt: '2026-10-11T15:30:00-05:00',
        route: '/follow-up',
        createdFor: 'reading-9c1d',
      },
    ]);
  });

  it('recommends a phone re-test 30 days after the last phone check', () => {
    const entries = plan({
      now: '2026-10-05T12:00:00-05:00',
      on: ['retest'],
      triggers: { lastPhoneCheckAt: at('2026-09-20T12:00:00-05:00') },
    });
    expect(entries).toEqual([
      {
        id: 'retest-2026-10-20T12:00',
        type: 'retest',
        fireAt: '2026-10-20T12:00:00-05:00',
        route: '/settings/phone',
        createdFor: 'phone-check',
      },
    ]);
  });

  it('times standing-test alerts to protocol minutes 1, 3, 5 and 10 after the 5 lying minutes', () => {
    const startedAt = at('2026-10-05T12:00:00-05:00');
    const entries = plan({
      now: '2026-10-05T12:00:00-05:00',
      on: ['standing'],
      triggers: { standingStartedAt: startedAt },
    });
    expect(fireTimes(entries)).toEqual([
      '2026-10-05T12:06:00-05:00',
      '2026-10-05T12:08:00-05:00',
      '2026-10-05T12:10:00-05:00',
      '2026-10-05T12:15:00-05:00',
    ]);
    expect(
      entries.every(
        ({ route, createdFor }) =>
          route === 'lumen://standing' && createdFor === `standing-test-${startedAt}`,
      ),
    ).toBe(true);
  });

  it('leaves out standing alerts already due', () => {
    const entries = plan({
      now: '2026-10-05T12:07:00-05:00',
      on: ['standing'],
      triggers: { standingStartedAt: at('2026-10-05T12:00:00-05:00') },
    });
    expect(fireTimes(entries)).toEqual([
      '2026-10-05T12:08:00-05:00',
      '2026-10-05T12:10:00-05:00',
      '2026-10-05T12:15:00-05:00',
    ]);
  });

  it('schedules nothing for a type that is turned off', () => {
    const triggers = {
      confirmationFor: { readingId: 'reading-1', takenAt: at('2026-10-05T09:00:00-05:00') },
      doctorFollowupFor: { readingId: 'reading-1', takenAt: at('2026-10-05T09:00:00-05:00') },
      standingStartedAt: at('2026-10-05T09:00:00-05:00'),
      lastPhoneCheckAt: at('2026-10-05T09:00:00-05:00'),
    };
    expect(plan({ now: '2026-10-05T09:00:00-05:00', on: [], triggers })).toEqual([]);
  });
});

describe('quiet hours', () => {
  it('moves a reminder inside quiet hours to the moment they end', () => {
    const entries = plan({
      now: '2026-10-05T05:00:00-05:00',
      on: ['daily'],
      dailyTime: { hour: 6, minute: 30 },
    });
    expect(entries[0]?.fireAt).toBe('2026-10-05T07:00:00-05:00');
  });

  it('wraps past midnight: a late reminder moves to the next morning', () => {
    const entries = plan({
      now: '2026-10-05T12:00:00-05:00',
      on: ['daily'],
      dailyTime: { hour: 22, minute: 0 },
    });
    expect(fireTimes(entries).slice(0, 2)).toEqual([
      '2026-10-06T07:00:00-05:00',
      '2026-10-07T07:00:00-05:00',
    ]);
  });

  it('treats the end time as outside quiet hours and the start time as inside', () => {
    const entries = (hour: number) =>
      plan({ now: '2026-10-05T00:00:00-05:00', on: ['daily'], dailyTime: { hour, minute: 0 } })[0]?.fireAt;
    expect(entries(7)).toBe('2026-10-05T07:00:00-05:00');
    expect(entries(21)).toBe('2026-10-06T07:00:00-05:00');
    expect(entries(20)).toBe('2026-10-05T20:00:00-05:00');
  });

  it('handles quiet hours that do not cross midnight', () => {
    const entries = plan({
      now: '2026-10-05T09:00:00-05:00',
      on: ['daily'],
      dailyTime: { hour: 14, minute: 0 },
      quietHours: { start: { hour: 13, minute: 0 }, end: { hour: 15, minute: 30 } },
    });
    expect(entries[0]?.fireAt).toBe('2026-10-05T15:30:00-05:00');
  });

  it('has no quiet hours when the start equals the end', () => {
    const entries = plan({
      now: '2026-10-05T00:00:00-05:00',
      on: ['daily'],
      dailyTime: { hour: 23, minute: 0 },
      quietHours: NO_QUIET_HOURS,
    });
    expect(entries[0]?.fireAt).toBe('2026-10-05T23:00:00-05:00');
  });

  it('does not hold back standing-test alerts, by owner decision', () => {
    const entries = plan({
      now: '2026-10-05T22:00:00-05:00',
      on: ['standing'],
      triggers: { standingStartedAt: at('2026-10-05T22:00:00-05:00') },
    });
    expect(entries[0]?.fireAt).toBe('2026-10-05T22:06:00-05:00');
  });
});

describe('3 per day', () => {
  // On 2026-10-12 a doctor follow-up, a same-day confirmation, a re-test and the daily check all fall due.
  const crowdedDay = {
    confirmationFor: { readingId: 'reading-c', takenAt: at('2026-10-12T06:30:00-05:00') },
    doctorFollowupFor: { readingId: 'reading-d', takenAt: at('2026-10-05T16:00:00-05:00') },
    lastPhoneCheckAt: at('2026-09-12T17:00:00-05:00'),
  };

  it('drops the daily check first when four reminders land on one day', () => {
    const entries = plan({
      now: '2026-10-12T06:31:00-05:00',
      on: ['daily', 'confirmation', 'doctor-followup', 'retest'],
      triggers: crowdedDay,
    });
    const onCrowdedDay = entries.filter(({ fireAt }) => fireAt.startsWith('2026-10-12'));
    expect(onCrowdedDay.map(({ type }) => type)).toEqual(['confirmation', 'doctor-followup', 'retest']);
    expect(entries.filter(({ fireAt }) => fireAt.startsWith('2026-10-13')).map(({ type }) => type)).toEqual([
      'confirmation',
      'daily',
    ]);
  });

  const ALL_CAPPED: readonly NotificationType[] = ['daily', 'confirmation', 'doctor-followup', 'retest'];

  it('keeps what an earlier sync scheduled when it syncs again later the same day', () => {
    const { planned, record } = syncInTurn(
      { now: '2026-10-12T06:31:00-05:00', on: ALL_CAPPED, triggers: crowdedDay },
      { now: '2026-10-12T09:00:00-05:00', on: ALL_CAPPED, triggers: crowdedDay },
    );
    expect(typesOn('2026-10-12', planned)).toEqual(['confirmation', 'doctor-followup', 'retest']);
    expect(typesOn('2026-10-12', record)).toEqual(['confirmation', 'doctor-followup', 'retest']);
  });

  it('counts a reminder that fired earlier today, then keeps doctor follow-up and confirmation', () => {
    const { planned } = syncInTurn(
      { now: '2026-10-12T07:00:00-05:00', on: ['daily'] },
      { now: '2026-10-12T09:00:00-05:00', on: ALL_CAPPED, triggers: crowdedDay },
    );
    expect(typesOn('2026-10-12', planned)).toEqual(['confirmation', 'doctor-followup']);
  });

  it('does not send the daily check twice when its time moves later after it fired', () => {
    const { planned } = syncInTurn(
      { now: '2026-10-05T07:00:00-05:00', on: ['daily'] },
      { now: '2026-10-05T09:00:00-05:00', on: ['daily'], dailyTime: { hour: 20, minute: 0 } },
    );
    expect(planned[0]?.fireAt).toBe('2026-10-06T20:00:00-05:00');
  });

  it('keeps a crowded day at 3 when the daily time moves after the daily check fired', () => {
    const { record } = syncInTurn(
      { now: '2026-10-12T07:00:00-05:00', on: ['daily'] },
      {
        now: '2026-10-12T09:00:00-05:00',
        on: ALL_CAPPED,
        triggers: crowdedDay,
        dailyTime: { hour: 20, minute: 0 },
      },
    );
    expect(typesOn('2026-10-12', record)).toEqual(['daily', 'confirmation', 'doctor-followup']);
  });

  it('still counts a same-day confirmation that fired before its trigger was cleared', () => {
    const evening = { hour: 20, minute: 0 };
    const { record } = syncInTurn(
      { now: '2026-10-12T06:31:00-05:00', on: ALL_CAPPED, triggers: crowdedDay, dailyTime: evening },
      {
        now: '2026-10-12T11:00:00-05:00',
        on: ALL_CAPPED,
        triggers: { ...crowdedDay, confirmationFor: null },
        dailyTime: evening,
      },
    );
    expect(typesOn('2026-10-12', record)).toEqual(['confirmation', 'doctor-followup', 'retest']);
  });

  it('does not count standing-test alerts that fired earlier today', () => {
    const { planned } = syncInTurn(
      {
        now: '2026-10-12T06:00:00-05:00',
        on: ['standing'],
        triggers: { standingStartedAt: at('2026-10-12T06:00:00-05:00') },
      },
      { now: '2026-10-12T06:31:00-05:00', on: ALL_CAPPED, triggers: crowdedDay },
    );
    expect(typesOn('2026-10-12', planned)).toEqual(['confirmation', 'doctor-followup', 'retest']);
  });

  it('never puts more than 3 reminders on one local day', () => {
    const entries = plan({
      now: '2026-10-12T06:31:00-05:00',
      on: ['daily', 'confirmation', 'doctor-followup', 'retest'],
      triggers: crowdedDay,
    });
    const perDay = new Map<string, number>();
    for (const { fireAt } of entries)
      perDay.set(fireAt.slice(0, 10), (perDay.get(fireAt.slice(0, 10)) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(3);
  });

  it('does not count standing-test alerts, by owner decision', () => {
    const entries = plan({
      now: '2026-10-12T06:31:00-05:00',
      on: ['daily', 'confirmation', 'doctor-followup', 'retest', 'standing'],
      triggers: { ...crowdedDay, standingStartedAt: at('2026-10-12T10:00:00-05:00') },
    });
    const onCrowdedDay = entries.filter(({ fireAt }) => fireAt.startsWith('2026-10-12'));
    expect(onCrowdedDay.filter(({ type }) => type === 'standing')).toHaveLength(4);
    expect(onCrowdedDay.filter(({ type }) => type !== 'standing')).toHaveLength(3);
  });
});

describe('schedule record', () => {
  const entry = (type: NotificationType, fireAt: string): PlannedNotification => ({
    id: `${type}-${fireAt.slice(0, 16)}`,
    type,
    fireAt,
    route: '/follow-up',
    createdFor: 'reading-1',
  });

  it('keeps the last two days of fired reminders and replaces pending ones with the new plan', () => {
    const now = at('2026-10-12T09:00:00-05:00');
    const previous = [
      entry('doctor-followup', '2026-10-10T08:59:00-05:00'),
      entry('daily', '2026-10-10T09:01:00-05:00'),
      entry('daily', '2026-10-12T09:00:00-05:00'),
      entry('retest', '2026-10-12T17:00:00-05:00'),
    ];
    const planned = [entry('retest', '2026-10-13T17:00:00-05:00')];
    expect(scheduleRecord(previous, planned, now).map(({ fireAt }) => fireAt)).toEqual([
      '2026-10-10T09:01:00-05:00',
      '2026-10-12T09:00:00-05:00',
      '2026-10-13T17:00:00-05:00',
    ]);
  });
});

describe('30-day horizon', () => {
  it('keeps a re-test due exactly 30 days ahead and drops one quiet hours push past it', () => {
    const now = '2026-10-05T12:00:00-05:00';
    expect(plan({ now, on: ['retest'], triggers: { lastPhoneCheckAt: at(now) } })).toHaveLength(1);
    const lateCheck = '2026-10-05T22:00:00-05:00';
    expect(plan({ now: lateCheck, on: ['retest'], triggers: { lastPhoneCheckAt: at(lateCheck) } })).toEqual(
      [],
    );
  });

  it('schedules nothing more than 30 days ahead', () => {
    const now = at('2026-10-05T12:00:00-05:00');
    const entries = plan({
      now: '2026-10-05T12:00:00-05:00',
      on: ['daily', 'confirmation', 'doctor-followup', 'retest'],
      triggers: {
        confirmationFor: { readingId: 'reading-1', takenAt: now },
        doctorFollowupFor: { readingId: 'reading-1', takenAt: now },
        lastPhoneCheckAt: now,
      },
    });
    const limit = at('2026-11-04T12:00:00-06:00');
    expect(entries.every(({ fireAt }) => at(fireAt) > now && at(fireAt) <= limit)).toBe(true);
  });
});

describe('local time', () => {
  it('keeps the daily check at 8:00 local across the November daylight-saving change', () => {
    const entries = plan({ now: '2026-10-30T12:00:00-05:00', on: ['daily'] });
    expect(fireTimes(entries).slice(0, 3)).toEqual([
      '2026-10-31T08:00:00-05:00',
      '2026-11-01T08:00:00-06:00',
      '2026-11-02T08:00:00-06:00',
    ]);
  });

  it('keeps the daily check at 8:00 local across the March daylight-saving change', () => {
    const entries = plan({ now: '2027-03-13T12:00:00-06:00', on: ['daily'] });
    expect(fireTimes(entries).slice(0, 2)).toEqual([
      '2027-03-14T08:00:00-05:00',
      '2027-03-15T08:00:00-05:00',
    ]);
  });

  it('keeps the doctor follow-up at the same local time when daylight saving ends in between', () => {
    const entries = plan({
      now: '2026-10-28T15:31:00-05:00',
      on: ['doctor-followup'],
      triggers: { doctorFollowupFor: { readingId: 'reading-2', takenAt: at('2026-10-28T15:30:00-05:00') } },
    });
    expect(fireTimes(entries)).toEqual(['2026-11-04T15:30:00-06:00']);
  });

  it('moves a time skipped when clocks go forward to the hour after', () => {
    const entries = plan({
      now: '2027-03-13T12:00:00-06:00',
      on: ['daily'],
      dailyTime: { hour: 2, minute: 30 },
      quietHours: NO_QUIET_HOURS,
    });
    expect(fireTimes(entries).slice(0, 2)).toEqual([
      '2027-03-14T03:30:00-05:00',
      '2027-03-15T02:30:00-05:00',
    ]);
  });

  it('uses the first of the two 1:30s when clocks go back', () => {
    const entries = plan({
      now: '2026-10-31T12:00:00-05:00',
      on: ['daily'],
      dailyTime: { hour: 1, minute: 30 },
      quietHours: NO_QUIET_HOURS,
    });
    expect(fireTimes(entries).slice(0, 2)).toEqual([
      '2026-11-01T01:30:00-05:00',
      '2026-11-02T01:30:00-06:00',
    ]);
  });

  it('writes half-hour offsets and other zones correctly', () => {
    const entries = plan({ now: '2026-10-05T09:00:00+05:30', on: ['daily'], timeZone: 'Asia/Kolkata' });
    expect(entries[0]?.fireAt).toBe('2026-10-06T08:00:00+05:30');
    const london = plan({ now: '2026-10-24T12:00:00+01:00', on: ['daily'], timeZone: 'Europe/London' });
    expect(fireTimes(london).slice(0, 2)).toEqual(['2026-10-25T08:00:00+00:00', '2026-10-26T08:00:00+00:00']);
  });
});
