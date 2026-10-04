import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { adaRisk, type AdaAnswers, type AdaRisk } from '@lumen/core';

import { loadRiskDraft } from '@/store/profile';

import { assessRisk, type RiskDraft } from './diabetesRisk';

export type RiskScore =
  | { kind: 'notReady' }
  | { kind: 'under20' }
  | {
      kind: 'scored';
      risk: AdaRisk;
      answers: AdaAnswers;
      sexNotGiven: boolean;
      // The pregnancy question is asked of Female only and never scored; the card lists it when answered.
      pregnancyAnswered: boolean;
    };

// adaRisk is called only for a ready assessment: untyped or half-filled answers would give NaN points.
export function scoreDraft(draft: RiskDraft): RiskScore {
  const assessment = assessRisk(draft);
  if (assessment.status !== 'ready') return { kind: 'notReady' };
  const risk = adaRisk(assessment.answers);
  if (risk === null) return { kind: 'under20' };
  return {
    kind: 'scored',
    risk,
    answers: assessment.answers,
    sexNotGiven: assessment.sexNotGiven,
    pregnancyAnswered: draft.sex === 'female' && draft.gestationalDiabetes !== null,
  };
}

// Null until the stored answers have been read. Reads again whenever the screen regains focus, so a score
// edited in Settings > Profile is current on return.
export function useStoredRiskScore(): RiskScore | null {
  const [score, setScore] = useState<RiskScore | null>(null);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadRiskDraft().then(
        (stored) => {
          if (active) setScore(scoreDraft(stored));
        },
        // Unreadable answers cannot give a score, so the card asks for them again.
        () => {
          if (active) setScore({ kind: 'notReady' });
        },
      );
      return () => {
        active = false;
      };
    }, []),
  );
  return score;
}
