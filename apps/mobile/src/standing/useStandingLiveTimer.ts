import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { lockscreenStrings } from '@/i18n/lockscreen';

import { LumenWidgets } from '../../modules/lumen-widgets/src';
import { STEP_COUNT, type TestView } from './protocol';

function reportTimerFailure(error: unknown) {
  const reason = error instanceof Error ? error.message : String(error);
  console.warn(`Standing-test live timer failed: ${reason}`);
}

// Every string comes from lockscreen.json (WID-2). The system draws the countdown itself (Android
// chronometer, iOS timerInterval text), so "Next reading in" is shown without its number.
function timerContent(language: string, step: number, countdownMs: number | null) {
  const lock = lockscreenStrings(language);
  return {
    channelName: lock['channel.standing'],
    actionLabel: lock['live.standing.measureNow'],
    title: lock['live.standing.title'],
    text:
      countdownMs === null
        ? lock['notif.standing']
        : lock['live.standing.next'].replace('{{countdown}}', '').trim(),
    step: lock['live.standing.step']
      .replace('{{step}}', String(step))
      .replace('{{total}}', String(STEP_COUNT)),
    tapHint: lock['live.standing.tap'],
    countdownMs,
  };
}

// LIVE-1: the lock-screen timer runs while a reading is due or still to come. It is started once, updated
// only when the step or the due reading changes (the countdown runs on its own between them), and ended when
// the test finishes, stops, or the screen closes. Without the native module (Jest, iOS before its widget
// target lands) it does nothing.
export function useStandingLiveTimer(view: TestView): void {
  const { i18n } = useTranslation();
  const started = useRef(false);
  const dueMinute = view.dueSlot?.minute ?? null;
  const countdownMs = dueMinute === null ? view.nextReadingInMs : null;
  const live =
    !view.stopped &&
    view.stage !== 'intro' &&
    view.stage !== 'done' &&
    (dueMinute !== null || countdownMs !== null);
  // The countdown changes every tick; the step effect reads the latest one without re-running on each tick.
  const latestCountdown = useRef(countdownMs);
  useEffect(() => {
    latestCountdown.current = countdownMs;
  });

  useEffect(() => {
    if (!LumenWidgets || !live) return;
    const content = timerContent(i18n.language, view.step, latestCountdown.current);
    const shown = started.current
      ? LumenWidgets.updateStandingTimer(content)
      : LumenWidgets.startStandingTimer(content);
    started.current = true;
    shown.catch(reportTimerFailure);
  }, [live, view.step, dueMinute, i18n.language]);

  useEffect(() => {
    if (!LumenWidgets || !live) return undefined;
    const widgets = LumenWidgets;
    return () => {
      started.current = false;
      widgets.endStandingTimer().catch(reportTimerFailure);
    };
  }, [live]);
}
