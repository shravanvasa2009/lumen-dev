import { useCallback, useEffect, useRef, useState } from 'react';

import { loadRiskDraft, type RiskScope, saveRiskDraft } from '@/store/profile';

import { EMPTY_RISK_DRAFT, type RiskDraft, storableDraft } from './diabetesRisk';

export type RiskDraftState = {
  draft: RiskDraft;
  // False until the stored answers have been read, so a field is never filled in over what was typed.
  loaded: boolean;
  loadFailed: boolean;
  saveFailed: boolean;
  change: <Field extends keyof RiskDraft>(field: Field, value: RiskDraft[Field]) => void;
  // Resolves true when the draft is stored.
  persist: () => Promise<boolean>;
};

// scope is what persist writes: a screen that edits only part of the profile saves only that part.
export function useRiskDraft(scope: RiskScope = 'all'): RiskDraftState {
  const [draft, setDraft] = useState<RiskDraft>(EMPTY_RISK_DRAFT);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const latest = useRef(EMPTY_RISK_DRAFT);
  // Saves run one after another: two transactions on one connection must not overlap.
  const lastSave = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    loadRiskDraft().then(
      (stored) => {
        if (!active) return;
        latest.current = stored;
        setDraft(stored);
        setLoaded(true);
      },
      () => {
        if (!active) return;
        setLoadFailed(true);
        setLoaded(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const change = useCallback(<Field extends keyof RiskDraft>(field: Field, value: RiskDraft[Field]) => {
    latest.current = { ...latest.current, [field]: value };
    setDraft(latest.current);
  }, []);

  const persist = useCallback(() => {
    const saving = lastSave.current.then(() => saveRiskDraft(storableDraft(latest.current), scope));
    lastSave.current = saving.catch(() => undefined);
    return saving.then(
      () => {
        setSaveFailed(false);
        return true;
      },
      () => {
        setSaveFailed(true);
        return false;
      },
    );
  }, [scope]);

  return { draft, loaded, loadFailed, saveFailed, change, persist };
}
