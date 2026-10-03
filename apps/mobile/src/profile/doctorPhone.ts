import { useEffect, useSyncExternalStore } from 'react';

import { profileValue, setProfileValue } from '@/store/profile';

// Digits, spaces and + - ( ) only, with at least one digit so "()" cannot be saved as a number.
const PHONE_PATTERN = /^[0-9 +\-()]+$/;

export function isValidPhone(text: string): boolean {
  return PHONE_PATTERN.test(text) && /\d/.test(text);
}

const DOCTOR_PHONE_KEY = 'doctorPhone';

type Problem = 'load' | 'save' | null;
type DoctorPhoneState = { phone: string | null; problem: Problem };

let current: DoctorPhoneState = { phone: null, problem: null };
// A number typed before the stored one arrives is newer than it, so the late load must not overwrite it.
let changedBeforeLoad = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: DoctorPhoneState) {
  current = next;
  listeners.forEach((listener) => listener());
}

// An empty string is how a cleared number is stored: the profile table keeps text values only.
function loadOnce() {
  loading ??= profileValue(DOCTOR_PHONE_KEY).then(
    (saved) => {
      if (!changedBeforeLoad) publish({ phone: saved === '' ? null : saved, problem: null });
    },
    () => {
      loading = null;
      publish({ ...current, problem: 'load' });
    },
  );
}

function setPhone(phone: string | null) {
  changedBeforeLoad = true;
  publish({ phone, problem: null });
  setProfileValue(DOCTOR_PHONE_KEY, phone ?? '').catch(() => publish({ ...current, problem: 'save' }));
}

// `problem` is set when the stored number could not be read or the latest change could not be saved.
export function useDoctorPhone(): {
  phone: string | null;
  problem: Problem;
  setPhone(phone: string | null): void;
} {
  const { phone, problem } = useSyncExternalStore(subscribe, () => current);
  useEffect(loadOnce, []);
  return { phone, problem, setPhone };
}
