import {
  changeValue,
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

// After every screen change and every input the picture holds still this long, so the editor can stretch
// or cut there.
export const HOLD_S = 1.5;
const DEFAULT_GRACE_S = 6;
const SCROLL_FRAME_MS = 33;

const shown = (pressed: Pressed | null) => {
  if (pressed === null) return false;
  showTap(pressed.layout);
  return true;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Script {
  readonly steps: Step[] = [];
  private cursor = 0;

  get now(): number {
    return this.cursor;
  }

  hold(seconds = HOLD_S): this {
    this.cursor += seconds;
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
    return this.step(`switch ${describeTarget(target)}`, async () => shown(await setSwitch(target, on))).hold(1);
  }

  // Letters appear one by one over `seconds`, the same length on both phones whatever the word.
  type(target: Target, text: string, seconds = 1.2): this {
    return this.step(
      `type ${describeTarget(target)}`,
      async () => {
        const first = await setText(target, text.slice(0, 1));
        if (first === null) return false;
        showTap(first.layout);
        const gapMs = (seconds * 1000) / Math.max(1, text.length);
        for (let typed = 2; typed <= text.length; typed += 1) {
          await sleep(gapMs);
          await setText(target, text.slice(0, typed));
        }
        return true;
      },
      seconds,
    ).hold(0.8);
  }

  pick(target: Target, ...values: unknown[]): this {
    return this.step(
      `pick ${describeTarget(target)}`,
      async () => (await changeValue(target, ...values)) !== null,
    ).hold(1);
  }

  // Scrolls the screen top to bottom at an even speed, then holds at the bottom; a screen that does not
  // scroll just holds.
  scrollThrough(seconds: number, holdAtEndS = 2): this {
    return this.step(
      'scroll',
      async () => {
        const range = await scrollRange();
        const frames = Math.max(1, Math.round((seconds * 1000) / SCROLL_FRAME_MS));
        for (let frame = 1; frame <= frames; frame += 1) {
          const progress = frame / frames;
          // Ease in and out so the start and end of the scroll don't jolt.
          const eased = progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;
          scrollTo(range * eased);
          await sleep(SCROLL_FRAME_MS);
        }
        return true;
      },
      seconds,
    ).hold(holdAtEndS);
  }

  scrollToTop(): this {
    return this.step('scroll to top', async () => scrollTo(0)).hold(0.6);
  }

  call(label: string, run: () => Promise<boolean> | boolean, takesS = 0, graceS?: number): this {
    return this.step(label, async () => run(), takesS, graceS);
  }
}
