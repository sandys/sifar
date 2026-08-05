const { spawnSync } = require('child_process');
const path = require('path');

const lint = spawnSync('node', [path.join(__dirname, 'lint-tests.js')], {
  stdio: 'inherit',
  env: process.env
});

if (lint.status !== 0) {
  process.exitCode = lint.status || 1;
  process.exit(process.exitCode);
}

const unit = spawnSync('npx', ['vitest', 'run'], {
  stdio: 'inherit',
  env: process.env
});

if (unit.status !== 0) {
  process.exitCode = unit.status || 1;
  process.exit(process.exitCode);
}

const result = spawnSync(
  'npx',
  ['playwright', 'test', '--output=/tmp/sifar-playwright-results'],
  {
  stdio: 'inherit',
  env: process.env
  }
);

if (result.status !== 0) {
  process.exitCode = result.status || 1;
}
