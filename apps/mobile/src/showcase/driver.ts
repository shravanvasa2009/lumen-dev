import { committedRoots } from './fiberHook';

// The showcase presses the same handlers a finger would, found in the mounted React tree by the words on
// screen. React's fiber fields are not public API; this is pinned to react 19.2.3 / react-native 0.86.3
// (ReactFabric-prod.js) and only runs in a showcase build.
type Fiber = {
  tag: number;
  type: unknown;
  memoizedProps: Record<string, unknown> | string | null;
  stateNode: { node?: unknown } | null;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
};

type Layout = { x: number; y: number; width: number; height: number };

type FabricUIManager = {
  measureInWindow: (node: unknown, done: (x: number, y: number, width: number, height: number) => void) => void;
  measure: (
    node: unknown,
    done: (x: number, y: number, width: number, height: number, pageX: number, pageY: number) => void,
  ) => void;
  dispatchCommand: (node: unknown, command: string, args: unknown[]) => void;
};

const HOST_COMPONENT = 5;
const HOST_TEXT = 6;
// react-native-screens: 0 is a screen below the top of its stack or an unfocused tab.
const INACTIVE_SCREEN = 0;

const fabric = (globalThis as { nativeFabricUIManager?: FabricUIManager }).nativeFabricUIManager;

function propsOf(fiber: Fiber): Record<string, unknown> {
  const props = fiber.memoizedProps;
  return props !== null && typeof props === 'object' ? props : {};
}

function isInactiveScreen(fiber: Fiber): boolean {
  if (fiber.tag !== HOST_COMPONENT || fiber.type !== 'RNSScreen') return false;
  const props = propsOf(fiber);
  return props.activityState === INACTIVE_SCREEN;
}

// Depth-first over what is on screen: the subtrees of covered stack screens and unfocused tabs are skipped.
function visit(fiber: Fiber | null, see: (fiber: Fiber) => void): void {
  let current = fiber;
  while (current !== null) {
    if (!isInactiveScreen(current)) {
      see(current);
      visit(current.child, see);
    }
    current = current.sibling;
  }
}

function eachVisibleFiber(see: (fiber: Fiber) => void): void {
  for (const root of committedRoots()) visit(root.current as Fiber, see);
}

function textOf(fiber: Fiber): string {
  const parts: string[] = [];
  const collect = (node: Fiber | null) => {
    let current = node;
    while (current !== null) {
      if (current.tag === HOST_TEXT && typeof current.memoizedProps === 'string') parts.push(current.memoizedProps);
      collect(current.child);
      current = current.sibling;
    }
  };
  collect(fiber.child);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

// Text on the control, or one of its props for controls that show none (the time picker).
export type Target = string | RegExp | { prop: string; equals: unknown };

function matches(fiber: Fiber, target: Target): boolean {
  const props = propsOf(fiber);
  if (typeof target === 'object' && !(target instanceof RegExp)) return props[target.prop] === target.equals;
  const names = [props.testID, props.accessibilityLabel, props['aria-label'], props.placeholder, textOf(fiber)];
  return names.some(
    (name) =>
      typeof name === 'string' && (typeof target === 'string' ? name.trim() === target : target.test(name)),
  );
}

const describe = (target: Target) =>
  typeof target === 'object' && !(target instanceof RegExp) ? `${target.prop}=${String(target.equals)}` : String(target);
export { describe as describeTarget };

export type Scope = { within?: string | RegExp };

function containsText(fiber: Fiber, text: string | RegExp): boolean {
  const shown = textOf(fiber);
  return typeof text === 'string' ? shown.includes(text) : text.test(shown);
}

// Steps up from a control to the nearest ancestor showing `within`; Infinity when none does.
function distanceTo(fiber: Fiber, within: string | RegExp): number {
  let steps = 0;
  for (let current = fiber.return; current !== null; current = current.return) {
    steps += 1;
    if (containsText(current, within)) return steps;
  }
  return Number.POSITIVE_INFINITY;
}

// The last match is the newest screen: a pushed screen renders after the one it covers. With `within`, the
// match nearest that text wins (the Yes under one question, not under the next).
function findWith(target: Target, prop: string, { within }: Scope = {}): Fiber | null {
  const found: Fiber[] = [];
  eachVisibleFiber((fiber) => {
    if (fiber.tag === HOST_COMPONENT || fiber.tag === HOST_TEXT) return;
    const props = propsOf(fiber);
    if (typeof props[prop] === 'function' && props.disabled !== true && matches(fiber, target)) found.push(fiber);
  });
  if (within === undefined) return found.at(-1) ?? null;
  let best: Fiber | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const fiber of found) {
    const distance = distanceTo(fiber, within);
    if (distance <= bestDistance) {
      best = fiber;
      bestDistance = distance;
    }
  }
  return bestDistance === Number.POSITIVE_INFINITY ? null : best;
}

function firstHostNode(fiber: Fiber): unknown {
  let found: unknown = null;
  const search = (node: Fiber | null) => {
    let current = node;
    while (current !== null && found === null) {
      if (current.tag === HOST_COMPONENT && current.stateNode?.node !== undefined) {
        found = current.stateNode.node;
        return;
      }
      search(current.child);
      current = current.sibling;
    }
  };
  if (fiber.tag === HOST_COMPONENT && fiber.stateNode?.node !== undefined) return fiber.stateNode.node;
  search(fiber.child);
  return found;
}

function windowLayout(fiber: Fiber): Promise<Layout | null> {
  const node = firstHostNode(fiber);
  if (fabric === undefined || node === null) return Promise.resolve(null);
  return new Promise((resolve) =>
    fabric.measureInWindow(node, (x, y, width, height) => resolve({ x, y, width, height })),
  );
}

const pressEvent = () => ({ nativeEvent: {}, persist: () => undefined, preventDefault: () => undefined });

export type Pressed = { layout: Layout | null };

/** Calls the onPress of the visible control showing `target`; null while no such control is on screen. */
export async function press(target: Target, scope?: Scope): Promise<Pressed | null> {
  const fiber = findWith(target, 'onPress', scope);
  if (fiber === null) return null;
  const layout = await windowLayout(fiber);
  (propsOf(fiber).onPress as (event: unknown) => void)(pressEvent());
  return { layout };
}

/** Turns the visible switch labelled `target` to `on`, pressing it only when it is the other way. */
export async function setSwitch(target: Target, on: boolean): Promise<Pressed | null> {
  const fiber = findWith(target, 'onPress');
  if (fiber === null) return null;
  const props = propsOf(fiber);
  const state = props.accessibilityState as { checked?: boolean } | undefined;
  const layout = await windowLayout(fiber);
  if (state?.checked !== on) (props.onPress as (event: unknown) => void)(pressEvent());
  return { layout };
}

/** Calls onValueChange of the visible control `target` with `value` (a time picker, a segmented picker). */
export async function changeValue(target: Target, ...args: unknown[]): Promise<Pressed | null> {
  const fiber = findWith(target, 'onValueChange');
  if (fiber === null) return null;
  const layout = await windowLayout(fiber);
  (propsOf(fiber).onValueChange as (...values: unknown[]) => void)(...args);
  return { layout };
}

/** The text input found by `target` (its placeholder or label) gets `text`; null while it is not on screen. */
export async function setText(target: Target, text: string): Promise<Pressed | null> {
  const fiber = findWith(target, 'onChangeText');
  if (fiber === null) return null;
  const layout = await windowLayout(fiber);
  (propsOf(fiber).onChangeText as (value: string) => void)(text);
  return { layout };
}

/** True while some visible text equals or matches `target`. */
export function isShowing(target: string | RegExp): boolean {
  let seen = false;
  eachVisibleFiber((fiber) => {
    if (seen || fiber.tag !== HOST_TEXT || typeof fiber.memoizedProps !== 'string') return;
    const text = fiber.memoizedProps.trim();
    seen = typeof target === 'string' ? text === target : target.test(text);
  });
  return seen;
}

type ScrollView = { node: unknown; content: unknown };

// The deepest visible vertical scroll view is the screen's own body (the stack and tabs wrap it).
function activeScrollView(): ScrollView | null {
  let found: ScrollView | null = null;
  eachVisibleFiber((fiber) => {
    if (fiber.tag !== HOST_COMPONENT || fiber.type !== 'RCTScrollView') return;
    if (propsOf(fiber).horizontal === true) return;
    const content = fiber.child === null ? null : firstHostNode(fiber.child);
    if (fiber.stateNode?.node !== undefined && content !== null) found = { node: fiber.stateNode.node, content };
  });
  return found;
}

function sizeOf(node: unknown): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => fabric!.measure(node, (_x, _y, width, height) => resolve({ width, height })));
}

/** How far the screen's scroll view can move, in points; 0 when the screen does not scroll. */
export async function scrollRange(): Promise<number> {
  const view = activeScrollView();
  if (view === null || fabric === undefined) return 0;
  const [frame, content] = await Promise.all([sizeOf(view.node), sizeOf(view.content)]);
  return Math.max(0, content.height - frame.height);
}

export function scrollTo(y: number): boolean {
  const view = activeScrollView();
  if (view === null || fabric === undefined) return false;
  fabric.dispatchCommand(view.node, 'scrollTo', [0, y, false]);
  return true;
}

/** Every visible label, for the showcase log when a target is not found. */
export function visibleTexts(): string[] {
  const texts: string[] = [];
  eachVisibleFiber((fiber) => {
    if (fiber.tag === HOST_TEXT && typeof fiber.memoizedProps === 'string' && fiber.memoizedProps.trim() !== '')
      texts.push(fiber.memoizedProps.trim());
  });
  return texts;
}
