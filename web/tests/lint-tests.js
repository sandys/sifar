const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IGNORE_DIRS = new Set([
  'node_modules',
  '.next',
  'public',
  'certificates',
  'test-results',
  'tests'
]);

const errors = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx|js)$/.test(entry.name)) continue;
    const filePath = path.join(dir, entry.name);
    const relPath = path.relative(ROOT, filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    runChecks(relPath, content);
  }
}

function addError(file, message) {
  errors.push(`${file}: ${message}`);
}

function runChecks(file, content) {
  if (/useAppStore\s*\(\s*\)/.test(content)) {
    addError(
      file,
      'useAppStore() without selector; use useAppStore((s)=>...) to avoid render loops.'
    );
  }

  if (/new Connection\(\s*DEFAULT_SOLANA_RPC/.test(content)) {
    addError(
      file,
      'new Connection(DEFAULT_SOLANA_RPC) without normalization; resolve to absolute URL first.'
    );
  }

  if (content.includes('@trezor/connect-web')) {
    addError(file, 'Do not reintroduce @trezor/connect-web (popup/iframe).');
  }

  if (content.includes('connect.trezor.io')) {
    addError(file, 'No connect.trezor.io references (no hosted UI).');
  }

  if (file === 'app/providers.tsx' && !content.includes('__vaultConsolePatched')) {
    addError(file, 'Console capture patch missing in providers.');
  }

  if (
    file === 'lib/constants.ts' &&
    !content.includes("'/api/solana'") &&
    !content.includes('"/api/solana"')
  ) {
    addError(file, 'DEFAULT_SOLANA_RPC should default to /api/solana proxy.');
  }

  if (file.endsWith('trezor-usb/trezor-usb-client.tsx')) {
    if (/Promise\.all\([^)]*getAllBalances/.test(content)) {
      addError(
        file,
        'Do not parallelize getAllBalances; keep sequential to avoid RPC 429s.'
      );
    }
  }

  if (content.includes("'use client'") || content.includes('"use client"')) {
    const usesWindow = content.includes('window.');
    const usesNavigator = content.includes('navigator.');
    if (usesWindow || usesNavigator) {
      const hasGuard =
        content.includes('typeof window') ||
        content.includes('typeof navigator') ||
        content.includes('useEffect(') ||
        content.includes('useLayoutEffect(');
      if (!hasGuard) {
        addError(
          file,
          'Client file uses window/navigator without guard or effect; risk of hydration mismatch.'
        );
      }
    }
  }
}

walk(ROOT);

if (errors.length) {
  console.error('Lint tests failed:\n' + errors.map((e) => `- ${e}`).join('\n'));
  process.exit(1);
}

console.log('Lint tests passed.');
