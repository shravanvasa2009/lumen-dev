// Jest has no location service. Tests set the permission and fix they need with mockResolvedValue.
export const Accuracy = { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 };
export const requestForegroundPermissionsAsync = jest.fn(() => Promise.resolve({ granted: false }));
export const getCurrentPositionAsync = jest.fn(() =>
  Promise.resolve({ coords: { latitude: 29.76, longitude: -95.37 } }),
);
