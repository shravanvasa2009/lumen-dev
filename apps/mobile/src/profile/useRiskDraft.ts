import { useCallback, useEffect, useRef, useState } from 'react';

import { loadRiskDraft, type RiskScope, saveRiskDraft } from '@/store/profile';

import { EMPTY_RISK_DRAFT, type RiskDraft, storableDraft } from './diabetesRisk';

// A question save must not act on a sex that is not stored yet: only a save that writes the basics may
// remove the pregnancy answer because of it (Done applies the sex-based removal).
function storableForScope(draft: RiskDraft, only: RiskScope): RiskDraft {
  const storable = storableDraft(draft);
  return only === 'questions' ? { ...storable, gestationalDiabetes: draft.gestationalDiabetes } : storable;
}

export type RiskDraftState = {
  draft: RiskDraft;
  // False until the stored answers have been read, so a field is never filled in over what was typed.
  loaded: boolean;
  loadFailed: boolean;
  saveFailed: boolean;
  change: <Field extends keyof RiskDraft>(field: Field, value: RiskDraft[Field]) => void;
  // Resolves true when the draft is stored.
  persist: (only?: RiskScope) => Promise<boolean>;
};

// scope is the part of the profile persist writes by default, so a screen that edits only part saves only
// that part; persist(only) overrides it for one save.
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

  const persist = useCallback(
    (only: RiskScope = scope) => {
      const saving = lastSave.current.then(() => saveRiskDraft(storableForScope(latest.current, only), only));
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
    },
    [scope],
  );

  return { draft, loaded, loadFailed, saveFailed, change, persist };
}
