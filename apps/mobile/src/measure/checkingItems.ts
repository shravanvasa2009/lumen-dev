import { CHECK_IDS, type CheckId, checkCell, type PlanPhone } from '@/checks/checkPlan';

import type { MeasureMode } from './mode';

// 'off' is a check this mode never runs, shown as "Not in this scan".
type CheckState = 'ready' | 'checking' | 'unavailable' | 'off';
export type CheckingItem = { id: CheckId; state: CheckState };

// Which checks run, which the phone locks and how many clean seconds each needs all come from checkCell, the
// same table the pre-check and Processing screens read. A check lights once the session's clean seconds reach
// its threshold.
export function checkingItems(
  mode: MeasureMode,
  cleanSeconds: number | null,
  phone: PlanPhone,
): CheckingItem[] {
  return CHECK_IDS.map((id): CheckingItem => {
    const cell = checkCell(mode, id, phone);
    if (cell.state === 'notInScan') return { id, state: 'off' };
    if (cell.state === 'locked') return { id, state: 'unavailable' };
    const ready = cell.cleanSeconds !== null && cleanSeconds !== null && cleanSeconds >= cell.cleanSeconds;
    return { id, state: ready ? 'ready' : 'checking' };
  });
}
