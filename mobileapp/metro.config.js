const fs = require('node:fs');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = withNativeWind(getDefaultConfig(__dirname), { input: './global.css' });

/**
 * Resolve `zustand` to its CommonJS build on WEB.
 *
 * Zustand ships both, and its exports map offers a `react-native` condition
 * (CJS), an `import` condition (ESM) and a `default` (CJS). Native matches
 * `react-native` and is fine. Web does not, and ends up on `esm/react.mjs` and
 * `esm/middleware.mjs` — the latter reads `import.meta.env.MODE` to decide
 * whether to wire up the Redux devtools extension.
 *
 * Metro serves the web bundle as a CLASSIC script, where `import.meta` is a
 * syntax error, so the WHOLE bundle fails to execute with
 * `Cannot use 'import.meta' outside a module`. `npm run web` then renders a
 * blank page with nothing on screen to explain it. We never use the `devtools`
 * middleware; importing `persist` is enough to drag that code in, because both
 * live in the same module.
 *
 * The mapping is explicit rather than a tweak to `unstable_conditionNames`:
 * Expo already sets web's conditions to `['browser']` and the ESM build is
 * chosen anyway, so naming the file is the version that actually holds. It also
 * keeps the change to one package on one platform, instead of altering module
 * resolution everywhere to fix one dependency.
 *
 * ⚠ This must wrap the config AFTER `withNativeWind`, which installs a
 * `resolveRequest` of its own and would otherwise replace this one.
 */
const ZUSTAND_CJS = path.join(__dirname, 'node_modules', 'zustand');

const previousResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = previousResolveRequest ?? context.resolveRequest;

  if (platform === 'web' && (moduleName === 'zustand' || moduleName.startsWith('zustand/'))) {
    const subpath = moduleName === 'zustand' ? 'index' : moduleName.slice('zustand/'.length);
    const filePath = path.join(ZUSTAND_CJS, `${subpath}.js`);
    // Fall through to the normal resolver for anything we have not mapped —
    // a missing file here should not become a resolution failure.
    if (fs.existsSync(filePath)) return { type: 'sourceFile', filePath };
  }

  return resolve(context, moduleName, platform);
};

module.exports = config;
