import { requireOptionalNativeModule } from 'expo';
import * as Location from 'expo-location';
import { render } from '@testing-library/react-native';
import { act, fireEvent, renderHook, renderRouter, screen, within } from 'expo-router/testing-library';
import { Dimensions, Keyboard, Linking, Platform, StyleSheet } from 'react-native';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { useDoctorPhone } from '@/profile/doctorPhone';
import tokens from '@/theme/tokens.json';

import { ClinicCard } from './ClinicCard';
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

const originalPlatform = Platform.OS;
const originalWindow = Dimensions.get('window');

afterAll(() => {
  Platform.OS = originalPlatform;
});

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
  renderRouter(appDirectory, { initialUrl: '/care' });
  await act(async () => {});
}

function captureKeyboardListeners() {
  const listeners = new Map<string, () => void>();
  jest.spyOn(Keyboard, 'addListener').mockImplementation((event, listener) => {
    listeners.set(event, listener as () => void);
    return { remove: jest.fn() } as unknown as ReturnType<typeof Keyboard.addListener>;
  });
  return listeners;
}

const frameHeight = () => StyleSheet.flatten(screen.getByTestId('care-map-frame').props.style).height;
const mapCentre = () => JSON.parse(screen.getByTestId('care-map-camera').props.accessibilityLabel);

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
  jest.mocked(requireOptionalNativeModule).mockReturnValue(null);
  act(() => Dimensions.set({ window: originalWindow }));
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

  it('lists the nearest 10 low-cost clinics first, then the nearest 10 regular ones, each by distance', () => {
    const nearby = nearestClinics(HOUSTON);
    const lowCost = nearby.slice(0, 10);
    const regular = nearby.slice(10);
    expect(nearby).toHaveLength(20);
    expect(lowCost.every((clinic) => clinic.kind === 'lowCost')).toBe(true);
    expect(regular.every((clinic) => clinic.kind === 'regular')).toBe(true);
    for (const group of [lowCost, regular]) {
      const miles = group.map((clinic) => clinic.miles);
      expect(miles).toEqual([...miles].sort((a, b) => a - b));
      expect(miles[0]).toBeLessThan(5);
    }
  });

  // The OSM file behind #197 held only part of Texas (nothing north of Houston), so the owner's area showed no
  // regular clinics. These places sit where that file had none.
  it.each(['78626', '78664', '76501', '76541', '78701', '75201'])(
    'has a regular clinic within 10 miles of %s',
    (zip) => {
      const regular = nearestClinics(findPlace(zip)!).filter((clinic) => clinic.kind === 'regular');
      expect(regular[0]!.miles).toBeLessThan(10);
    },
  );

  it('keeps the two kinds apart by id', () => {
    const ids = nearestClinics(HOUSTON).map((clinic) => clinic.id);
    expect(new Set(ids).size).toBe(ids.length);
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
    expect(screen.getByRole('header', { name: en['careMap.title'] })).toBeOnTheScreen();
    expect(screen.getByTestId('care-map-view')).toBeOnTheScreen();
    const legend = within(screen.getByTestId('care-map-legend'));
    expect(legend.getByText(en['careMap.legendClinic'])).toBeOnTheScreen();
    expect(legend.getByText(en['careMap.legendRegular'])).toBeOnTheScreen();
    expect(legend.getByText(en['careMap.legendYou'])).toBeOnTheScreen();
    expect(screen.getByText(en['careMap.privacy'])).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: en['careMap.call'] }).length).toBeGreaterThan(5);
  });

  it('uses the liberty style in light', async () => {
    mockScheme = 'light';
    await openCareMap();
    expect(screen.getByTestId('care-map-view').props.accessibilityLabel).toBe(
      'https://tiles.openfreemap.org/styles/liberty',
    );
  });

  it('uses the same liberty style in the dark theme, where the dark style was unreadable', async () => {
    await openCareMap();
    expect(screen.getByTestId('care-map-view').props.accessibilityLabel).toBe(
      'https://tiles.openfreemap.org/styles/liberty',
    );
  });

  it('shows a loading placeholder until the map has rendered', async () => {
    await openCareMap();
    expect(screen.getByTestId('care-map-loading')).toBeOnTheScreen();
    expect(screen.getByText(en['careMap.loadingMap'])).toBeOnTheScreen();
    expect(screen.getByTestId('care-map-legend')).toBeOnTheScreen();
    fireEvent(screen.getByTestId('care-map-view'), 'didFinishRenderingMap');
    expect(screen.queryByTestId('care-map-loading')).toBeNull();
  });

  it('also clears the placeholder on a full render, which is sent instead of the partial one', async () => {
    await openCareMap();
    fireEvent(screen.getByTestId('care-map-view'), 'didFinishRenderingMapFully');
    expect(screen.queryByTestId('care-map-loading')).toBeNull();
  });

  it('keeps a working map when a failure event arrives after it rendered', async () => {
    await openCareMap();
    fireEvent(screen.getByTestId('care-map-view'), 'didFinishRenderingMapFully');
    fireEvent(screen.getByTestId('care-map-view'), 'didFailLoadingMap');
    expect(screen.queryByText(en['careMap.mapFailed'])).toBeNull();
  });

  it('keeps the legend under the loading and failure overlays, and out of touch handling', async () => {
    await openCareMap();
    const frame = screen.getByTestId('care-map-frame');
    const order = (testID: string) =>
      frame.children.findIndex((child) => typeof child !== 'string' && child.props.testID === testID);
    expect(screen.getByTestId('care-map-legend').props.pointerEvents).toBe('none');
    expect(order('care-map-legend')).toBeLessThan(order('care-map-loading'));
    fireEvent(screen.getByTestId('care-map-view'), 'didFailLoadingMap');
    expect(order('care-map-legend')).toBeLessThan(order('care-map-failed'));
  });

  it('shows a failure message with Retry, and Retry remounts the map', async () => {
    await openCareMap();
    const firstMap = screen.getByTestId('care-map-view');
    fireEvent(firstMap, 'didFailLoadingMap');
    expect(screen.getByText(en['careMap.mapFailed'])).toBeOnTheScreen();
    expect(screen.queryByTestId('care-map-loading')).toBeNull();
    expect(screen.getAllByRole('button', { name: en['careMap.call'] }).length).toBeGreaterThan(5);

    fireEvent.press(screen.getByRole('button', { name: en['careMap.retry'] }));
    expect(screen.queryByText(en['careMap.mapFailed'])).toBeNull();
    expect(screen.getByTestId('care-map-loading')).toBeOnTheScreen();
    expect(screen.getByTestId('care-map-view')).not.toBe(firstMap);
  });

  it('lists clinic and you in the legend, and the doctor once doctors are shown', async () => {
    Platform.OS = 'ios';
    jest.mocked(requireOptionalNativeModule).mockReturnValue({
      searchNearbyCare: jest.fn(async () => [
        { name: 'Dr. Rivera', phone: '713-555-0111', lat: 29.77, lon: -95.36, address: '1 Main St' },
      ]),
    });
    await openCareMap();
    const legend = within(screen.getByTestId('care-map-legend'));
    expect(legend.getByText(en['careMap.legendClinic'])).toBeOnTheScreen();
    expect(legend.getByText(en['careMap.legendYou'])).toBeOnTheScreen();
    expect(legend.queryByText(en['careMap.legendDoctor'])).toBeNull();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: en['careMap.showDoctors'] })));
    expect(legend.getByText(en['careMap.legendDoctor'])).toBeOnTheScreen();
  });

  it('draws regular clinics with a different pin shape and color from low-cost ones', async () => {
    await openCareMap();
    const nearby = nearestClinics(HOUSTON);
    const pinStyle = (id: string) => {
      const pin = screen.getByTestId(`pin-clinic-${id}`);
      return StyleSheet.flatten(within(pin).getAllByTestId(/^care-pin-/)[0]!.props.style);
    };
    const lowCost = pinStyle(nearby[0]!.id);
    const regular = pinStyle(nearby[10]!.id);
    expect(lowCost.borderRadius).toBe(15);
    expect(regular.borderRadius).toBeLessThan(lowCost.borderRadius);
    expect(regular.backgroundColor).not.toBe(lowCost.backgroundColor);
  });

  it('labels each clinic card with its kind', async () => {
    await openCareMap();
    const nearby = nearestClinics(HOUSTON);
    expect(screen.getByTestId(`clinic-kind-${nearby[0]!.id}`)).toHaveTextContent(en['careMap.legendClinic']);
    expect(screen.getByTestId(`clinic-kind-${nearby[10]!.id}`)).toHaveTextContent(
      en['careMap.legendRegular'],
    );
  });

  it('credits OpenStreetMap and opens its copyright page', async () => {
    await openCareMap();
    await act(async () => fireEvent.press(screen.getByRole('link', { name: en['careMap.sourceOsm'] })));
    expect(Linking.openURL).toHaveBeenCalledWith('https://www.openstreetmap.org/copyright');
  });

  it('turns the map attribution on', async () => {
    await openCareMap();
    expect(screen.getByTestId('care-map-view').props.accessibilityHint).toBe('attribution:true');
  });

  it('selects a clinic on a pin tap, moving it to the top of the list without clearing it', async () => {
    await openCareMap();
    const clinics = nearestClinics(HOUSTON);
    const dialled = (index: number) => `tel:${clinics[index]!.phone.replace(/[^\d+]/g, '')}`;
    // Phones can repeat across sites, so the test picks a clinic whose number is unique in the list.
    const picked = clinics.findIndex(
      (clinic, index) =>
        index > 0 &&
        clinic.phone !== '' &&
        clinics.every((other, at) => at === index || other.phone !== clinic.phone),
    );
    expect(picked).toBeGreaterThan(0);

    const stopPropagation = jest.fn();
    fireEvent.press(screen.getByTestId(`pin-clinic-${clinics[picked]!.id}`), { stopPropagation });
    expect(stopPropagation).toHaveBeenCalledTimes(1);

    await act(async () => fireEvent.press(screen.getAllByRole('button', { name: en['careMap.call'] })[0]!));
    expect(Linking.openURL).toHaveBeenCalledWith(dialled(picked));
  });

  it('does not clear the clinic pick when a doctor pin is tapped', async () => {
    Platform.OS = 'ios';
    jest.mocked(requireOptionalNativeModule).mockReturnValue({
      searchNearbyCare: jest.fn(async () => [
        { name: 'Dr. Rivera', phone: '713-555-0111', lat: 29.77, lon: -95.36, address: '1 Main St' },
      ]),
    });
    await openCareMap();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: en['careMap.showDoctors'] })));
    const stopPropagation = jest.fn();
    fireEvent.press(screen.getByTestId('pin-doctor-0'), { stopPropagation });
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('shrinks the map while the keyboard is up, and never hides it', async () => {
    const keyboard = captureKeyboardListeners();
    act(() => Dimensions.set({ window: { ...originalWindow, width: 360, height: 640 } }));
    saveDoctorPhone('(713) 555-0100');
    await openCareMap();
    const fullHeight = frameHeight();
    expect(fullHeight).toBeLessThanOrEqual(640 * 0.3);
    expect(screen.getByRole('button', { name: en['careMap.callMyDoctor'] })).toBeOnTheScreen();
    fireEvent(screen.getByLabelText(en['careMap.zipLabel']), 'focus');
    expect(frameHeight()).toBe(fullHeight);
    act(() => keyboard.get('keyboardDidShow')?.());
    expect(frameHeight()).toBeGreaterThan(0);
    expect(frameHeight()).toBeLessThan(fullHeight);
    act(() => keyboard.get('keyboardDidHide')?.());
    expect(frameHeight()).toBe(fullHeight);
  });

  // Android hides the keyboard without blurring the field; the map must still grow back.
  it('grows the map back after a search, even though the ZIP field keeps focus', async () => {
    const keyboard = captureKeyboardListeners();
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    await openCareMap();
    const fullHeight = frameHeight();
    const zip = screen.getByLabelText(en['careMap.zipLabel']);
    fireEvent(zip, 'focus');
    act(() => keyboard.get('keyboardDidShow')?.());
    fireEvent.changeText(zip, 'Houston');
    expect(frameHeight()).toBeLessThan(fullHeight);
    fireEvent.press(screen.getByRole('button', { name: en['careMap.search'] }));
    expect(dismiss).toHaveBeenCalled();
    expect(frameHeight()).toBe(fullHeight);
  });

  it('moves the map as soon as a whole ZIP code is typed', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    await openCareMap();
    const zip = screen.getByLabelText(en['careMap.zipLabel']);
    fireEvent.changeText(zip, '1000');
    expect(dismiss).not.toHaveBeenCalled();
    expect(mapCentre()).toEqual([HOUSTON.lon, HOUSTON.lat]);
    fireEvent.changeText(zip, '10001');
    expect(dismiss).toHaveBeenCalled();
    const newYork = findPlace('10001')!;
    expect(mapCentre()).toEqual([newYork.lon, newYork.lat]);
    expect(screen.getByTestId('care-map-place')).toHaveTextContent('Showing clinics near 10001');
  });
  it('puts Call my doctor first as the filled primary button when a number is saved', async () => {
    saveDoctorPhone('(713) 555-0100');
    await openCareMap();
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toBe(screen.getByRole('button', { name: en['careMap.callMyDoctor'] }));
    expect(StyleSheet.flatten(buttons[0]!.props.style)).toMatchObject({
      backgroundColor: tokens.dark.accentFill,
    });
    expect(
      StyleSheet.flatten(screen.getByRole('button', { name: en['careMap.search'] }).props.style),
    ).toMatchObject({
      backgroundColor: 'transparent',
    });
  });

  it('dials the clinic with a tel: link', async () => {
    await openCareMap();
    const [first] = nearestClinics(HOUSTON);
    await act(async () => fireEvent.press(screen.getAllByRole('button', { name: en['careMap.call'] })[0]!));
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
    await act(async () =>
      fireEvent.press(screen.getAllByRole('button', { name: en['careMap.directions'] })[0]!),
    );
    expect(Linking.openURL).toHaveBeenCalledWith(
      `geo:0,0?q=${first!.lat},${first!.lon}(${encodeURIComponent(first!.name)})`,
    );
  });

  it('shows the failure on the clinic card whose directions were tapped', async () => {
    Platform.OS = 'android';
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('none'));
    await openCareMap();
    await act(async () =>
      fireEvent.press(screen.getAllByRole('button', { name: en['careMap.directions'] })[1]!),
    );
    const second = nearestClinics(HOUSTON)[1]!;
    expect(screen.getAllByText(en['careMap.mapsFailed'])).toHaveLength(1);
    expect(
      within(screen.getByTestId(`clinic-card-${second.id}`)).getByText(en['careMap.mapsFailed']),
    ).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: en['careMap.directions'] })).toHaveLength(20);
  });

  it('opens Maps with a doctor search on Android', async () => {
    Platform.OS = 'android';
    await openCareMap();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: en['careMap.searchDoctors'] })));
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
    await act(async () => fireEvent.press(screen.getByRole('button', { name: en['careMap.callMyDoctor'] })));
    expect(Linking.openURL).toHaveBeenCalledWith('tel:7135550100');
  });
});

describe('Care map on iPhone', () => {
  beforeEach(() => {
    allowLocation();
    Platform.OS = 'ios';
  });
  afterEach(() => {
    Platform.OS = originalPlatform;
  });

  it('falls back to the Maps-app button when the native search is absent', async () => {
    await openCareMap();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: en['careMap.searchDoctors'] })));
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
    expect(
      within(screen.getByTestId('care-map-legend')).getByText(en['careMap.legendClinic']),
    ).toBeOnTheScreen();
  });

  it('keeps the last searched place, labelled, while the field is edited or cleared', async () => {
    await openCareMap();
    const zip = screen.getByLabelText(en['careMap.zipLabel']);
    fireEvent.changeText(zip, '77002');
    const houston = mapCentre();
    for (const typed of ['7700', '', '9']) {
      fireEvent.changeText(zip, typed);
      expect(screen.getByTestId('care-map-frame')).toBeOnTheScreen();
      expect(frameHeight()).toBeGreaterThan(0);
      expect(mapCentre()).toEqual(houston);
      expect(screen.getByTestId('care-map-place')).toHaveTextContent('Showing clinics near 77002');
    }
  });

  it('keeps the last place when a new search finds nothing', async () => {
    await openCareMap();
    const zip = screen.getByLabelText(en['careMap.zipLabel']);
    fireEvent.changeText(zip, '77002');
    const houston = mapCentre();
    fireEvent.changeText(zip, 'zzzzzz');
    fireEvent.press(screen.getByRole('button', { name: en['careMap.search'] }));
    expect(screen.getByText(en['careMap.notFound'])).toBeOnTheScreen();
    expect(mapCentre()).toEqual(houston);
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

describe('Care map loading timeout', () => {
  beforeEach(allowLocation);

  it('offers Retry after 20 seconds without a render or a failure event, and a late render still shows the map', async () => {
    await openCareMap();
    fireEvent(screen.getByTestId('care-map-view'), 'didFailLoadingMap');
    // A faked clock stalled the router and left Jest unable to exit on CI, so the timer that Retry
    // starts is caught and fired by hand instead.
    const timers = jest.spyOn(global, 'setTimeout');
    fireEvent.press(screen.getByRole('button', { name: en['careMap.retry'] }));
    const loadingTimeout = timers.mock.calls.find(([, delay]) => delay === 20_000);
    expect(loadingTimeout).toBeDefined();
    expect(screen.getByTestId('care-map-loading')).toBeOnTheScreen();
    act(() => (loadingTimeout![0] as () => void)());
    expect(screen.queryByTestId('care-map-loading')).toBeNull();
    expect(screen.getByText(en['careMap.mapFailed'])).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en['careMap.retry'] })).toBeOnTheScreen();
    fireEvent(screen.getByTestId('care-map-view'), 'didFinishRenderingMap');
    expect(screen.queryByTestId('care-map-failed')).toBeNull();
  });
});

describe('clinic card', () => {
  // OpenStreetMap sites often lack a street, city or ZIP.
  it('shows only the address parts a clinic has', () => {
    const clinic = {
      ...nearestClinics(HOUSTON)[10]!,
      street: '',
      city: '',
      state: 'TX',
      zip: '77002',
      miles: 1.25,
    };
    render(
      <ClinicCard
        clinic={clinic}
        selected={false}
        callFailed={false}
        directionsFailed={false}
        onCall={jest.fn()}
        onDirections={jest.fn()}
      />,
    );
    expect(screen.getByText('TX 77002 · 1.3 mi')).toBeOnTheScreen();
  });
});

describe('copy', () => {
  // Owner request 2026-10-03: "Low-cost clinic" and "Clinic" (ADR 0078).
  it('has both legend entries in both languages', () => {
    expect(en['careMap.legendClinic']).toBe('Low-cost clinic');
    expect(es['careMap.legendClinic']).toBe('Clínica de bajo costo');
    expect(en['careMap.legendRegular']).toBe('Clinic');
    expect(es['careMap.legendRegular']).toBe('Clínica');
  });
});
