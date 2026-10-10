import { useEffect, useSyncExternalStore } from 'react';

import { profileValue, setProfileValue } from '@/store/profile';

const NAME_KEY = 'name';
export const NAME_MAX_LENGTH = 40;

type Problem = 'load' | 'save' | null;
type NameState = { name: string | null; problem: Problem };

let current: NameState = { name: null, problem: null };
// A name typed before the stored one arrives is newer than it, so the late load must not overwrite it.
let changedBeforeLoad = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: NameState) {
  current = next;
  listeners.forEach((listener) => listener());
}

// An empty string is how a cleared name is stored: the profile table keeps text values only.
function loadOnce() {
  loading ??= profileValue(NAME_KEY).then(
    (saved) => {
      if (!changedBeforeLoad) publish({ name: saved === null || saved === '' ? null : saved, problem: null });
    },
    () => {
      loading = null;
      publish({ ...current, problem: 'load' });
    },
  );
}

// After the profile is wiped. A read still in flight may carry the old name, so it must not publish, and the
// next mount reads the (empty) profile again.
export function resetProfileName() {
  changedBeforeLoad = true;
  loading = null;
  publish({ name: null, problem: null });
}

function setName(text: string) {
  const name = text.trim().slice(0, NAME_MAX_LENGTH);
  changedBeforeLoad = true;
  publish({ name: name === '' ? null : name, problem: null });
  setProfileValue(NAME_KEY, name).catch(() => publish({ ...current, problem: 'save' }));
}

// The optional first name from About you, or null when none was given. Home reads `name` for its greeting;
// `problem` is set when the stored name could not be read or the latest change could not be saved.
export function useProfileName(): { name: string | null; problem: Problem; setName(text: string): void } {
  const { name, problem } = useSyncExternalStore(subscribe, () => current);
  useEffect(loadOnce, []);
  return { name, problem, setName };
}
