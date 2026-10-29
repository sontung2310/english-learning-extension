#!/usr/bin/env node
// Point CHROME_DEVTOOLS_AXI_MCP_PATH at this file to test a Chrome extension
// with chrome-devtools-axi. It injects two chrome-devtools-mcp flags axi has
// no env var for:
//   --ignore-default-chrome-arg=--disable-extensions  (Puppeteer disables
//     extensions by default; this un-disables them)
//   --categoryExtensions  (turns on chrome-extension:// navigation and the
//     extensions tool category, off by default outside --viaCli mode)
// See the `e2e-testing` skill (.claude/skills/e2e-testing) for the full setup.
const { spawnSync } = require('child_process');

const args = [
  '-y',
  'chrome-devtools-mcp@latest',
  '--ignore-default-chrome-arg=--disable-extensions',
  '--categoryExtensions',
  ...process.argv.slice(2),
];
const r = spawnSync('npx', args, { stdio: 'inherit' });
process.exit(r.status ?? 1);
