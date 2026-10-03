import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as react from 'react';

import * as sqlite from '../../__mocks__/expo-sqlite';
import { profileValue } from '@/store/profile';

import { isValidPhone, useDoctorPhone } from './doctorPhone';

describe('isValidPhone', () => {
  it.each(['+1 (555) 123-4567', '5551234567', '+34 91 123 45 67'])('accepts %s', (text) => {
    expect(isValidPhone(text)).toBe(true);
  });

  it.each(['call me', '555-CALL', '555#1234', '()', '', ' '])('rejects "%s"', (text) => {
    expect(isValidPhone(text)).toBe(false);
  });
});

// A relaunch starts with empty module state but the same database file, so the module is loaded again in
// isolation while React and the database stay the ones this test file already uses.
function relaunch() {
  let reloaded!: typeof import('./doctorPhone');
  jest.isolateModules(() => {
    jest.doMock('react', () => react);
    jest.doMock('expo-sqlite', () => sqlite);
    reloaded = jest.requireActual('./doctorPhone');
  });
  return reloaded;
}

describe('useDoctorPhone', () => {
  beforeEach(sqlite.emptyMockDatabases);
  afterEach(() => jest.restoreAllMocks());

  it('starts with no number and no problem', async () => {
    const hook = relaunch();
    const { result: doctorPhone } = renderHook(() => hook.useDoctorPhone());
    await waitFor(() => expect(doctorPhone.current.problem).toBeNull());
    expect(doctorPhone.current.phone).toBeNull();
  });

  it('shares a saved number with every reader and clears it again', async () => {
    const { result: writer } = renderHook(() => useDoctorPhone());
    const { result: reader } = renderHook(() => useDoctorPhone());
    act(() => writer.current.setPhone('+1 555 0100'));
    expect(reader.current.phone).toBe('+1 555 0100');
    await waitFor(async () => expect(await profileValue('doctorPhone')).toBe('+1 555 0100'));
    act(() => writer.current.setPhone(null));
    expect(reader.current.phone).toBeNull();
    await waitFor(async () => expect(await profileValue('doctorPhone')).toBe(''));
  });

  it('keeps the saved number after the app is closed and opened again', async () => {
    const first = relaunch();
    const { result: before } = renderHook(() => first.useDoctorPhone());
    act(() => before.current.setPhone('+1 555 0100'));
    await waitFor(async () => expect(await profileValue('doctorPhone')).toBe('+1 555 0100'));

    const second = relaunch();
    const { result: after } = renderHook(() => second.useDoctorPhone());
    expect(after.current.phone).toBeNull();
    await waitFor(() => expect(after.current.phone).toBe('+1 555 0100'));
    expect(after.current.problem).toBeNull();
  });

  it('stays cleared after a relaunch', async () => {
    const first = relaunch();
    const { result: before } = renderHook(() => first.useDoctorPhone());
    act(() => before.current.setPhone('+1 555 0100'));
    act(() => before.current.setPhone(null));
    await waitFor(async () => expect(await profileValue('doctorPhone')).toBe(''));

    const second = relaunch();
    const { result: after } = renderHook(() => second.useDoctorPhone());
    await waitFor(() => expect(after.current.problem).toBeNull());
    expect(after.current.phone).toBeNull();
  });

  it('reports a number that could not be read', async () => {
    const database = await sqlite.openDatabaseAsync('lumen.db');
    jest.spyOn(database, 'getFirstAsync').mockRejectedValue(new Error('unreadable'));
    const hook = relaunch();
    const { result: doctorPhone } = renderHook(() => hook.useDoctorPhone());
    await waitFor(() => expect(doctorPhone.current.problem).toBe('load'));
    expect(doctorPhone.current.phone).toBeNull();
  });

  it('reports a change that could not be saved and keeps showing the number', async () => {
    const database = await sqlite.openDatabaseAsync('lumen.db');
    jest.spyOn(database, 'runAsync').mockRejectedValue(new Error('disk full'));
    const hook = relaunch();
    const { result: doctorPhone } = renderHook(() => hook.useDoctorPhone());
    act(() => doctorPhone.current.setPhone('+1 555 0100'));
    await waitFor(() => expect(doctorPhone.current.problem).toBe('save'));
    expect(doctorPhone.current.phone).toBe('+1 555 0100');
  });
});
