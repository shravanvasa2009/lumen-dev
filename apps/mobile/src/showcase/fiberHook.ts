// The showcase driver presses the app's own buttons, so it needs the mounted React tree. React reports every
// commit to a DevTools hook if one exists when the renderer loads, in production builds too
// (ReactFabric-prod.js checks __REACT_DEVTOOLS_GLOBAL_HOOK__ at module init), so this file must be imported
// before expo-router/entry. Only the showcase entry imports it.
type FiberRoot = { current: unknown };
type DevToolsHook = {
  supportsFiber: boolean;
  renderers: Map<number, unknown>;
  inject: (renderer: unknown) => number;
  onCommitFiberRoot: (rendererId: number, root: FiberRoot, ...rest: unknown[]) => void;
  onCommitFiberUnmount: (...rest: unknown[]) => void;
  onPostCommitFiberRoot?: (...rest: unknown[]) => void;
  checkDCE?: () => void;
};

const roots = new Set<FiberRoot>();

export function committedRoots(): readonly FiberRoot[] {
  return [...roots];
}

const global = globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHook };
const existing = global.__REACT_DEVTOOLS_GLOBAL_HOOK__;
if (existing === undefined) {
  let nextId = 1;
  global.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) {
      const id = nextId++;
      this.renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot: (_id, root) => {
      roots.add(root);
    },
    onCommitFiberUnmount: () => undefined,
    onPostCommitFiberRoot: () => undefined,
    checkDCE: () => undefined,
  };
} else if (typeof existing.onCommitFiberRoot === 'function') {
  // A development build already has the real DevTools hook; listen alongside it.
  const forward = existing.onCommitFiberRoot.bind(existing);
  existing.onCommitFiberRoot = (id, root, ...rest) => {
    roots.add(root);
    forward(id, root, ...rest);
  };
}
