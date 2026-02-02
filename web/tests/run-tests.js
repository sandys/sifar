const { spawnSync } = require('child_process');

const result = spawnSync('npx', ['playwright', 'test'], {
  stdio: 'inherit',
  env: process.env
});

if (result.status !== 0) {
  process.exitCode = result.status || 1;
}
