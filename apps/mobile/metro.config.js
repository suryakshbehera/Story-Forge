// pnpm's isolated node-linker puts real packages in <root>/node_modules/.pnpm
// and symlinks into apps/mobile/node_modules. Metro watches only the project
// root by default and can't resolve through those symlinks to files outside
// it — without this, importing `contract` (or any other workspace package)
// fails to resolve. See docs/product/mobile-technical-plan-2026-09.md §7.2.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Deliberately NOT disableHierarchicalLookup: true (the mobile-technical-
// plan's suggested starting point). Verified live that it breaks — pnpm's
// isolated node-linker resolves a package's OWN transitive deps (e.g.
// expo's dependency on expo-modules-core) via hierarchical walk-up through
// node_modules/.pnpm/<pkg>/node_modules, not via a flat top-level
// node_modules. Disabling that lookup broke @expo/metro-runtime and
// expo-modules-core one at a time as each was hit. The extra
// nodeModulesPaths entry above (ADDITIVE, not a replacement) is what
// resolves `contract` from the workspace root; hierarchical lookup stays on
// for everything else.

module.exports = config;
