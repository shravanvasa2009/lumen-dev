import { act, renderHook } from '@testing-library/react-native';

import { isValidPhone, useDoctorPhone } from './doctorPhone';

describe('isValidPhone', () => {
  it.each(['+1 (555) 123-4567', '5551234567', '+34 91 123 45 67'])('accepts %s', (text) => {
    expect(isValidPhone(text)).toBe(true);
  });

  it.each(['call me', '555-CALL', '555#1234', '()', '', ' '])('rejects "%s"', (text) => {
    expect(isValidPhone(text)).toBe(false);
  });
});

describe('useDoctorPhone', () => {
  afterEach(() => {
    const { result: doctorPhone } = renderHook(() => useDoctorPhone());
    act(() => doctorPhone.current.setPhone(null));
  });

  it('starts with no number', () => {
    const { result: doctorPhone } = renderHook(() => useDoctorPhone());
    expect(doctorPhone.current.phone).toBeNull();
  });

  it('shares a saved number with every reader and clears it again', () => {
    const { result: writer } = renderHook(() => useDoctorPhone());
    const { result: reader } = renderHook(() => useDoctorPhone());
    act(() => writer.current.setPhone('+1 555 0100'));
    expect(reader.current.phone).toBe('+1 555 0100');
    act(() => writer.current.setPhone(null));
    expect(reader.current.phone).toBeNull();
  });
});
