// Metro config — resolves @protein-outfitters/shared from the repo root.
//
// Layout (protein-outfitters-design):
//   <root>/mobile            ← this app (projectRoot)
//   <root>/packages/shared   ← shared package
//   <root>/node_modules      ← hoisted workspace deps
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..'); // was '../..' in the app repo

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

// 4. The static site + serverless API live next door. Keep Metro from crawling
//    them (deploy/ has its own node_modules on Vercel, and *.html is noise).
config.resolver.blockList = [
  new RegExp(`${path.resolve(workspaceRoot, 'deploy').replace(/[/\\]/g, '[/\\\\]')}[/\\\\].*`),
  new RegExp(`${path.resolve(workspaceRoot, 'supabase').replace(/[/\\]/g, '[/\\\\]')}[/\\\\].*`),
  new RegExp(`${path.resolve(workspaceRoot, 'test').replace(/[/\\]/g, '[/\\\\]')}[/\\\\].*`),
];

module.exports = config;
