import { LumenCapture, LumenCareSearch, type NearbyPlace } from './index';

// Jest links no native modules, like Expo Go; importing the package must not throw there.
test('the native binding is null, not an import-time error, when the module is not linked', () => {
  expect(LumenCapture).toBeNull();
  expect(LumenCareSearch).toBeNull();
});

// Loads the binding against a stand-in for what requireOptionalNativeModule returns on a phone.
function careSearchWith(native: object): typeof LumenCareSearch {
  let search: typeof LumenCareSearch = null;
  jest.isolateModules(() => {
    jest.doMock('expo', () => ({ ...jest.requireActual('expo'), requireOptionalNativeModule: () => native }));
    ({ LumenCareSearch: search } =
      jest.requireActual<typeof import('./LumenCaptureModule')>('./LumenCaptureModule'));
  });
  jest.dontMock('expo');
  return search;
}

test('care search is null when the linked module has no searchNearbyCare (Android, older iOS builds)', () => {
  expect(careSearchWith({ getCapabilities: jest.fn() })).toBeNull();
});

test('care search forwards to the native function with the module as this', async () => {
  const doctor = { name: 'Clinic', lat: 29.76, lon: -95.37, address: '1 Main St, Houston, TX 77002' };
  const native: { searchNearbyCare: jest.Mock<Promise<NearbyPlace[]>> } = {
    searchNearbyCare: jest.fn(function (this: unknown) {
      return Promise.resolve(this === native ? [doctor] : []);
    }),
  };
  const search = careSearchWith(native);
  await expect(search?.searchNearbyCare(29.76, -95.37, 8000, 'doctor')).resolves.toEqual([doctor]);
  expect(native.searchNearbyCare).toHaveBeenCalledWith(29.76, -95.37, 8000, 'doctor');
});
