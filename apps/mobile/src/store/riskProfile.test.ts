import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import { enterDemo, exitDemo } from '@/demo/demoSession';
import { assessRisk, EMPTY_RISK_DRAFT, type RiskDraft } from '@/profile/diabetesRisk';

import { lumenDatabase } from './database';
import { loadRiskDraft, profileValue, saveRiskDraft } from './profile';

const answered: RiskDraft = {
  ageYears: 52,
  sex: 'preferNot',
  heightCm: 168.5,
  weightKg: 82,
  familyHistory: true,
  hypertension: false,
  physicallyActive: false,
  gestationalDiabetes: null,
};

const rawComplete: Record<string, string> = {
  age: '52',
  sex: 'male',
  heightCm: '168',
  weightKg: '82',
  familyHistory: 'true',
  hypertension: 'false',
  physicallyActive: 'true',
};

beforeEach(emptyMockDatabases);
afterEach(exitDemo);

describe('risk answers in the profile table', () => {
  it('loads nothing as unanswered, never as No', async () => {
    expect(await loadRiskDraft()).toEqual(EMPTY_RISK_DRAFT);
  });

  it('round-trips every answer and stores no body mass index', async () => {
    await saveRiskDraft(answered);
    expect(await loadRiskDraft()).toEqual(answered);
    expect(await profileValue('heightCm')).toBe('168.5');
    expect(await profileValue('hypertension')).toBe('false');
    expect(await profileValue('gestationalDiabetes')).toBeNull();
    const database = await lumenDatabase();
    const keys = await database.getAllAsync<{ key: string }>('SELECT key FROM profile ORDER BY key');
    expect(keys.map(({ key }) => key)).toEqual([
      'age',
      'familyHistory',
      'heightCm',
      'hypertension',
      'physicallyActive',
      'sex',
      'weightKg',
    ]);
  });

  it('removes an answer that is cleared', async () => {
    await saveRiskDraft(answered);
    await saveRiskDraft({ ...answered, heightCm: null, familyHistory: null });
    expect(await profileValue('heightCm')).toBeNull();
    expect(await profileValue('familyHistory')).toBeNull();
    expect((await loadRiskDraft()).weightKg).toBe(82);
  });

  it('saves only its own scope, so an older copy of the other part cannot overwrite it', async () => {
    await saveRiskDraft(answered);
    await saveRiskDraft({ ...EMPTY_RISK_DRAFT, ageYears: 60 }, 'basics');
    expect(await loadRiskDraft()).toMatchObject({
      ageYears: 60,
      sex: null,
      familyHistory: true,
      hypertension: false,
    });
    await saveRiskDraft({ ...EMPTY_RISK_DRAFT, familyHistory: false }, 'questions');
    expect(await loadRiskDraft()).toMatchObject({ ageYears: 60, familyHistory: false, hypertension: null });
  });

  it('writes nothing in Demo mode', async () => {
    enterDemo();
    await saveRiskDraft(answered);
    exitDemo();
    expect(await loadRiskDraft()).toEqual(EMPTY_RISK_DRAFT);
  });

  it('ignores a stored value it cannot read', async () => {
    const database = await lumenDatabase();
    await database.runAsync("INSERT INTO profile (key, value) VALUES ('sex', 'robot'), ('age', 'abc')");
    expect(await loadRiskDraft()).toEqual(EMPTY_RISK_DRAFT);
  });

  async function storeRaw(entries: Record<string, string>) {
    const database = await lumenDatabase();
    for (const [key, value] of Object.entries({ ...rawComplete, ...entries }))
      await database.runAsync('INSERT OR REPLACE INTO profile (key, value) VALUES (?, ?)', [key, value]);
  }

  it('reads a complete set of stored strings as ready, with real numbers and booleans', async () => {
    await storeRaw({});
    const assessment = assessRisk(await loadRiskDraft());
    expect(assessment).toMatchObject({
      status: 'ready',
      answers: { ageYears: 52, male: true, familyHistory: true, hypertension: false, physicallyActive: true },
    });
  });

  it.each(['', 'abc', 'NaN', 'Infinity', '-5', ' 52', '5e1', '0x34', '52 '])(
    'treats the stored number %j as missing, never ready',
    async (corrupt) => {
      for (const key of ['age', 'heightCm', 'weightKg']) {
        emptyMockDatabases();
        await storeRaw({ [key]: corrupt });
        const draft = await loadRiskDraft();
        expect(assessRisk(draft).status).not.toBe('ready');
      }
    },
  );

  it.each(['yes', '1', ' true', 'true ', 'TRUE', 'NaN', ''])(
    'treats the stored answer %j as missing, never as Yes',
    async (corrupt) => {
      for (const key of ['familyHistory', 'hypertension', 'physicallyActive']) {
        emptyMockDatabases();
        await storeRaw({ [key]: corrupt });
        const draft = await loadRiskDraft();
        expect(draft[key as 'familyHistory']).toBeNull();
        expect(assessRisk(draft)).toEqual({ status: 'incomplete' });
      }
    },
  );

  it('is incomplete for each missing key', async () => {
    for (const key of Object.keys(rawComplete)) {
      emptyMockDatabases();
      await storeRaw({});
      const database = await lumenDatabase();
      await database.runAsync('DELETE FROM profile WHERE key = ?', [key]);
      expect(assessRisk(await loadRiskDraft())).toEqual({ status: 'incomplete' });
    }
  });
});
