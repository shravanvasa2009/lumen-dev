import { requireOptionalNativeModule } from 'expo';
import * as Location from 'expo-location';
import { act, fireEvent, renderHook, renderRouter, screen } from 'expo-router/testing-library';
import { Linking, Platform } from 'react-native';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { useDoctorPhone } from '@/profile/doctorPhone';
import { expectNavTitle } from '@/testing/navHeader';

import { distanceMiles, findPlace, nearestClinics } from './clinics';
import { SEARCH_THROTTLED_CODE } from './nearbyDoctors';

import '@/i18n';

let mockScheme: 'light' | 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

jest.mock('expo', () => ({
  ...jest.requireActual('expo'),
  requireOptionalNativeModule: jest.fn(() => null),
}));

// The first test pays for loading the 2 MB clinic list and the router.
jest.setTimeout(30_000);

const HOUSTON = { lat: 29.76, lon: -95.37 };
const appDirectory = './app';

const requestPermission = jest.mocked(Location.requestForegroundPermissionsAsync);
const currentPosition = jest.mocked(Location.getCurrentPositionAsync);

function allowLocation() {
  requestPermission.mockResolvedValue({ granted: true } as Location.LocationPermissionResponse);
  currentPosition.mockResolvedValue({
    coords: { latitude: HOUSTON.lat, longitude: HOUSTON.lon },
  } as Location.LocationObject);
}

function denyLocation() {
  requestPermission.mockResolvedValue({ granted: false } as Location.LocationPermissionResponse);
}

async function openCareMap() {
  renderRouter(appDirectory, { initialUrl: '/care-map' });
  await act(async () => {});
}

beforeEach(() => {
  mockScheme = 'dark';
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  requestPermission.mockClear();
  currentPosition.mockClear();
  denyLocation();
});

function saveDoctorPhone(phone: string | null) {
  const { result: doctorPhone } = renderHook(() => useDoctorPhone());
  act(() => doctorPhone.current.setPhone(phone));
}

afterEach(() => {
  jest.restoreAllMocks();
  saveDoctorPhone(null);
});

describe('bundled clinic list', () => {
  it('finds a place by ZIP code, with or without the +4', () => {
    const place = findPlace('77002');
    expect(place).not.toBeNull();
    expect(distanceMiles(HOUSTON, place!)).toBeLessThan(15);
    expect(findPlace('77002-1234')).toEqual(place);
  });

  it('falls back to the ZIP area when the exact ZIP has no clinic', () => {
    expect(findPlace('77001')).not.toBeNull();
  });

  it('finds a place by city, with or without the state', () => {
    const byCity = findPlace('houston');
    expect(byCity).not.toBeNull();
    expect(findPlace('Houston, TX')).not.toBeNull();
    expect(findPlace('Houston CA')).toBeNull();
  });

  it('returns nothing for text that is not a place', () => {
    expect(findPlace('')).toBeNull();
    expect(findPlace('zzzzzz')).toBeNull();
  });

  it('orders the nearest clinics by distance', () => {
    const nearby = nearestClinics(HOUSTON);
    expect(nearby).toHaveLength(20);
    expect(nearby.map((clinic) => clinic.miles)).toEqual(
      [...nearby.map((clinic) => clinic.miles)].sort((a, b) => a - b),
    );
    expect(nearby[0]?.miles).toBeLessThan(5);
  });
});

describe('Care map with location allowed', () => {
  beforeEach(allowLocation);

  it('asks for foreground permission once, at low accuracy', async () => {
    await openCareMap();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(currentPosition).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Low });
  });

  it('shows the map, the legend, the privacy line and nearby clinics', async () => {
    await openCareMap();
    expectNavTitle(en['careMap.title']);
    expect(screen.getByTestId('care-map-view')).toBeOnTheScreen();
    expect(screen.getByText(en['careMap.legendClinic'])).toBeOnTheScreen();
    expect(screen.getByText(en['careMap.legendYou'])).toBeOnTheScreen();
    expect(screen.getByText(en['careMap.privacy'])).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: en['careMap.call'] }).length).toBeGreaterThan(5);
  });

  it('uses the liberty style in light and the dark style in dark, chosen at mount', async () => {
    mockScheme = 'light';
    await openCareMap();
    expect(screen.getByTestId('care-map-view').props.accessibilityLabel).toBe(
      'https://tiles.openfreemap.org/styles/liberty',
    );
  });

  it('uses the dark style in the dark theme', async () => {
    await openCareMap();
    expect(screen.getByTestId('care-map-view').props.accessibilityLabel).toBe(
      'https://tiles.openfreemap.org/styles/dark',
    );
  });

  it('selects a clinic on a pin tap, moving it to the top of the list', async () => {
    await openCareMap();
    const clinics = nearestClinics(HOUSTON);
    const third = clinics[2]!;
    fireEvent.press(screen.getByTestId(`pin-clinic-${third.id}`));
    expect(
      screen.getAllByText(new RegExp(third.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))[0],
    ).toBeOnTheScreen();
  });

  it('dials the clinic with a tel: link', async () => {
    await openCareMap();
    const [first] = nearestClinics(HOUSTON);
    fireEvent.press(screen.getAllByRole('button', { name: en['careMap.call'] })[0]!);
    expect(Linking.openURL).toHaveBeenCalledWith(`tel:${first!.phone.replace(/[^\d+]/g, '')}`);
  });

  it('shows the number as selectable text when the phone cannot dial', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no SIM'));
    await openCareMap();
    const [first] = nearestClinics(HOUSTON);
    await act(async () => fireEvent.press(screen.getAllByRole('button', { name: en['careMap.call'] })[0]!));
    expect(screen.getByText(en['careMap.callFailed'], { exact: false })).toBeOnTheScreen();
    const numbers = screen.getAllByText(first!.phone);
    expect(numbers.length).toBeGreaterThan(1);
    expect(numbers.every((number) => number.props.selectable)).toBe(true);
  });

  it('opens directions in the maps app', async () => {
    Platform.OS = 'android';
    await openCareMap();
    const [first] = nearestClinics(HOUSTON);
    fireEvent.press(screen.getAllByRole('button', { name: en['careMap.directions'] })[0]!);
    expect(Linking.openURL).toHaveBeenCalledWith(
      `geo:0,0?q=${first!.lat},${first!.lon}(${encodeURIComponent(first!.name)})`,
    );
  });

  it('opens Maps with a doctor search on Android', async () => {
    Platform.OS = 'android';
    await openCareMap();
    fireEvent.press(screen.getByRole('button', { name: en['careMap.searchDoctors'] }));
    expect(Linking.openURL).toHaveBeenCalledWith(`geo:${HOUSTON.lat},${HOUSTON.lon}?q=doctor`);
  });

  it('says so when no maps app opens', async () => {
    Platform.OS = 'android';
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('none'));
    await openCareMap();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: en['careMap.searchDoctors'] })));
    expect(screen.getByText(en['careMap.mapsFailed'])).toBeOnTheScreen();
  });

  it('has no Call my doctor button when no number is saved', async () => {
    await openCareMap();
    expect(screen.queryByRole('button', { name: en['careMap.callMyDoctor'] })).toBeNull();
  });

  it('puts Call my doctor at the top when a number is saved', async () => {
    saveDoctorPhone('(713) 555-0100');
    await openCareMap();
    fireEvent.press(screen.getByRole('button', { name: en['careMap.callMyDoctor'] }));
    expect(Linking.openURL).toHaveBeenCalledWith('tel:7135550100');
  });
});

describe('Care map on iPhone', () => {
  beforeEach(() => {
    allowLocation();
    Platform.OS = 'ios';
  });
  afterEach(() => {
    Platform.OS = 'android';
  });

  it('falls back to the Maps-app button when the native search is absent', async () => {
    await openCareMap();
    fireEvent.press(screen.getByRole('button', { name: en['careMap.searchDoctors'] }));
    expect(Linking.openURL).toHaveBeenCalledWith(
      `https://maps.apple.com/?q=doctor&ll=${HOUSTON.lat},${HOUSTON.lon}`,
    );
  });

  it('shows doctors from the native search as their own pins', async () => {
    const searchNearbyCare = jest.fn(async () => [
      { name: 'Dr. Rivera', phone: '713-555-0111', lat: 29.77, lon: -95.36, address: '1 Main St' },
    ]);
    jest.mocked(requireOptionalNativeModule).mockReturnValue({ searchNearbyCare });
    await openCareMap();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: en['careMap.showDoctors'] })));
    expect(searchNearbyCare).toHaveBeenCalledWith(HOUSTON.lat, HOUSTON.lon, 8000, 'doctor');
    expect(screen.getByTestId('pin-doctor-0')).toBeOnTheScreen();
    expect(screen.getByText(en['careMap.legendDoctor'])).toBeOnTheScreen();
  });

  it('says to try again shortly when Apple throttles the search', async () => {
    const throttled = Object.assign(new Error('throttled'), { code: SEARCH_THROTTLED_CODE });
    jest
      .mocked(requireOptionalNativeModule)
      .mockReturnValue({ searchNearbyCare: jest.fn(() => Promise.reject(throttled)) });
    await openCareMap();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: en['careMap.showDoctors'] })));
    expect(screen.getByText(en['careMap.searchBusy'])).toBeOnTheScreen();
    jest.mocked(requireOptionalNativeModule).mockReturnValue(null);
  });
});

describe('Care map with location denied', () => {
  it('shows the ZIP or city search and no map', async () => {
    await openCareMap();
    expect(screen.getByText(en['careMap.denied'])).toBeOnTheScreen();
    expect(screen.getByLabelText(en['careMap.zipLabel'])).toBeOnTheScreen();
    expect(screen.queryByTestId('care-map-view')).toBeNull();
    expect(currentPosition).not.toHaveBeenCalled();
  });

  it('searches the bundled list by ZIP code and shows the map and clinics', async () => {
    await openCareMap();
    fireEvent.changeText(screen.getByLabelText(en['careMap.zipLabel']), '77002');
    fireEvent.press(screen.getByRole('button', { name: en['careMap.search'] }));
    expect(screen.getByTestId('care-map-view')).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: en['careMap.call'] }).length).toBeGreaterThan(5);
    expect(screen.queryByText(en['careMap.legendYou'])).toBeNull();
  });

  it('says so when the place is not in the list', async () => {
    await openCareMap();
    fireEvent.changeText(screen.getByLabelText(en['careMap.zipLabel']), 'zzzzzz');
    fireEvent.press(screen.getByRole('button', { name: en['careMap.search'] }));
    expect(screen.getByText(en['careMap.notFound'])).toBeOnTheScreen();
    expect(screen.queryByTestId('care-map-view')).toBeNull();
  });

  it('asks for a ZIP or city when the position cannot be read', async () => {
    allowLocation();
    currentPosition.mockRejectedValue(new Error('no fix'));
    await openCareMap();
    expect(screen.getByText(en['careMap.locationFailed'])).toBeOnTheScreen();
    expect(screen.queryByTestId('care-map-view')).toBeNull();
  });
});

describe('copy', () => {
  it('has the legend in both languages', () => {
    expect(en['careMap.legendClinic']).toBe('Free or low-cost clinic');
    expect(es['careMap.legendClinic']).toBe('Clínica gratuita o de bajo costo');
  });
});
