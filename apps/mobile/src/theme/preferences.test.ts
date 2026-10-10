import { memoryFiles, mockFileSystem } from '@/testing/memoryFiles';

jest.mock('expo-file-system', () => mockFileSystem);
jest.mock('../../modules/lumen-widgets/src', () => ({ LumenWidgets: null }));

type PreferencesModule = typeof import('./preferences');

// A fresh copy of the module, as at an app launch: it reads the saved file once when it loads.
function launch(): PreferencesModule {
  let loaded: PreferencesModule | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual<PreferencesModule>('./preferences');
  });
  if (!loaded) throw new Error('preferences did not load');
  return loaded;
}

beforeEach(() => memoryFiles.clear());

describe('saved preferences (WID-1)', () => {
  it('keeps "Hide values on widgets" and the appearance across a restart', () => {
    const first = launch();
    first.setPreference('hideWidgetValues', true);
    first.setPreference('appearance', 'dark');
    expect(launch().currentPreferences()).toEqual({ appearance: 'dark', hideWidgetValues: true });
  });

  it('starts from the defaults with no file, a damaged one, or unknown values', () => {
    expect(launch().currentPreferences()).toEqual({ appearance: 'system', hideWidgetValues: false });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    memoryFiles.set('preferences.json', '{not json');
    expect(launch().currentPreferences()).toEqual({ appearance: 'system', hideWidgetValues: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    memoryFiles.set('preferences.json', JSON.stringify({ appearance: 'purple', hideWidgetValues: 'yes' }));
    expect(launch().currentPreferences()).toEqual({ appearance: 'system', hideWidgetValues: false });
  });

  it('forgets them when all data is deleted', () => {
    const first = launch();
    first.setPreference('hideWidgetValues', true);
    first.resetPreferences();
    expect(memoryFiles.has('preferences.json')).toBe(false);
    expect(launch().currentPreferences().hideWidgetValues).toBe(false);
  });
});
