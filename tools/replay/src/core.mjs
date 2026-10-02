import { registerHooks } from 'node:module';

// @lumen/core is TypeScript source with extensionless relative imports (bundler resolution), so plain Node
// cannot load it. Node strips types itself (default from 22.18; https://nodejs.org/api/typescript.html);
// this hook only adds the ".ts" those imports leave out and marks core files as TypeScript modules
// (https://nodejs.org/api/module.html#moduleregisterhooksoptions). No build step and no new dependency.
const CORE_URL = new URL('../../../packages/core/src/index.ts', import.meta.url);
const RELATIVE = /^\.\.?\//;
const HAS_EXTENSION = /\.[cm]?[jt]s$|\.json$/;

let hooked = false;

// Loads @lumen/core from source: the same functions the app runs.
export async function loadCore() {
  if (!process.features.typescript)
    throw new Error(`Node ${process.version} cannot strip TypeScript types; use Node 22.18 or later`);
  if (!hooked) {
    registerHooks({
      resolve(specifier, context, nextResolve) {
        const fromTs = context.parentURL?.endsWith('.ts') ?? false;
        if (fromTs && RELATIVE.test(specifier) && !HAS_EXTENSION.test(specifier))
          return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
      },
      load(url, context, nextLoad) {
        return nextLoad(url, url.endsWith('.ts') ? { ...context, format: 'module-typescript' } : context);
      },
    });
    hooked = true;
  }
  return import(CORE_URL.href);
}
