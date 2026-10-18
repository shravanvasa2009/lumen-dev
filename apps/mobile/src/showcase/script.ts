import {
  blurInput,
  changeValue,
  focusInput,
  describeTarget,
  press,
  type Pressed,
  type Scope,
  scrollRange,
  scrollTo,
  setSwitch,
  setText,
  type Target,
} from './driver';
import { showTap } from './TapDots';

// A step runs at a fixed second after the start on both phones, so the two films stay on the same screen
// however fast each phone renders. `attempt` returns false while its control is not on screen yet.
export type Step = { at: number; label: string; attempt: () => Promise<boolean>; graceS: number };

// After every screen change and every input the picture holds still about this long, so the editor can
// stretch or cut there. Each hold is varied a little, as a person's pace is.
export const HOLD_S = 0.9;
const DEFAULT_GRACE_S = 6;
const SCROLL_FRAME_MS = 16;
// A flick moves at most this share of the visible height, then glides to a stop over FLICK_S.
const FLICK_SHARE = 0.75;
const FLICK_S = 0.5;
const BETWEEN_FLICKS_S = 0.25;
// Holds up to this long are a person's pauses and get varied; longer ones are fixed waits.
const MAX_PACED_HOLD_S = 3;
// Flicks cover a screen faster than the old even scroll; the script's scroll lengths are scaled by this.
const SCROLL_PACE = 0.6;

// The same sequence on both phones (a fixed seed, one draw per hold), so the varied holds keep the two films
// on the same timetable: 0.75x to 1.25x.
function paceFactors(): () => number {
  let state = 20261017;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return 0.75 + (state / 2147483648) * 0.5;
  };
}

// Fast at the start, gliding to a stop: a flick's deceleration.
const easeOutCubic = (progress: number) => 1 - (1 - progress) ** 3;

// Draws the touch dot for a press that found its control; false while the control is not on screen.
export const shown = (pressed: Pressed | null) => {
  if (pressed === null) return false;
  showTap(pressed.layout);
  return true;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Script {
  readonly steps: Step[] = [];
  private cursor = 0;
  private readonly pace = paceFactors();

  get now(): number {
    return this.cursor;
  }

  // Only a person's short pauses vary; long fixed waits (the rest, a scan) keep their length.
  hold(seconds = HOLD_S): this {
    this.cursor += seconds <= MAX_PACED_HOLD_S ? seconds * this.pace() : seconds;
    return this;
  }

  // Moves the cursor to an absolute second, for beats that must land on a wall-clock minute.
  holdUntil(second: number): this {
    if (second < this.cursor) throw new Error(`showcase: ${second}s is before the cursor at ${this.cursor}s`);
    this.cursor = second;
    return this;
  }

  step(label: string, attempt: () => Promise<boolean>, takesS = 0, graceS = DEFAULT_GRACE_S): this {
    this.steps.push({ at: this.cursor, label, attempt, graceS });
    this.cursor += takesS;
    return this;
  }

  tap(target: Target, scope?: Scope): this {
    return this.step(`tap ${describeTarget(target)}`, async () => shown(await press(target, scope))).hold();
  }

  switchTo(target: Target, on: boolean): this {
    return this.step(`switch ${describeTarget(target)}`, async () => shown(await setSwitch(target, on))).hold(
      1,
    );
  }

  // The field is focused so the keyboard opens, then letters arrive one by one with uneven gaps over
  // `seconds`, the same on both phones whatever the word, and the keyboard closes.
  type(target: Target, text: string, seconds = 1.2): this {
    return this.step(
      `type ${describeTarget(target)}`,
      async () => {
        const first = await setText(target, '');
        if (first === null) return false;
        showTap(first.layout);
        focusInput(target);
        const gaps = Array.from(text, () => this.pace());
        const total = gaps.reduce((sum, gap) => sum + gap, 0);
        for (const [index, gap] of gaps.entries()) {
          await sleep((seconds * 1000 * gap) / total);
          await setText(target, text.slice(0, index + 1));
        }
        blurInput(target);
        return true;
      },
      seconds,
    ).hold(0.6);
  }

  pick(target: Target, ...values: unknown[]): this {
    return this.step(
      `pick ${describeTarget(target)}`,
      async () => (await changeValue(target, ...values)) !== null,
    ).hold(1);
  }

  // Flicks the screen top to bottom, each flick fast then gliding to a stop, then holds at the bottom; a
  // screen that does not scroll just holds. The timetable gives it SCROLL_PACE of `seconds` on every phone;
  // the flick count follows the screen's height.
  scrollThrough(seconds: number, holdAtEndS = 2): this {
    return this.step(
      'scroll',
      async () => {
        const { range, frame } = await scrollRange();
        if (range === 0) return true;
        // As many flicks as the screen needs, but no more than fit the step's time, so a long list never
        // pushes the next step late; each flick then travels farther.
        const fit = Math.floor((seconds * SCROLL_PACE + BETWEEN_FLICKS_S) / (FLICK_S + BETWEEN_FLICKS_S));
        const flicks = Math.max(1, Math.min(fit, Math.ceil(range / (frame * FLICK_SHARE))));
        let from = 0;
        for (let flick = 1; flick <= flicks; flick += 1) {
          const to = (range * flick) / flicks;
          // Paced by the clock, so a slow frame never stretches a flick.
          const startedMs = Date.now();
          for (;;) {
            const progress = Math.min(1, (Date.now() - startedMs) / (FLICK_S * 1000));
            scrollTo(from + (to - from) * easeOutCubic(progress));
            if (progress >= 1) break;
            await sleep(SCROLL_FRAME_MS);
          }
          from = to;
          if (flick < flicks) await sleep(BETWEEN_FLICKS_S * 1000);
        }
        return true;
      },
      seconds * SCROLL_PACE,
    ).hold(holdAtEndS);
  }

  scrollToTop(): this {
    return this.step('scroll to top', async () => scrollTo(0)).hold(0.6);
  }

  call(label: string, run: () => Promise<boolean> | boolean, takesS = 0, graceS?: number): this {
    return this.step(label, async () => run(), takesS, graceS);
  }
}
