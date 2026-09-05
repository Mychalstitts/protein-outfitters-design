// Metro config — extended to resolve the shared package from the monorepo root.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the workspace root so Metro sees changes in packages/shared
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from both project and workspace node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Workspace packages aren't symlinked the way we'd want by default
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
