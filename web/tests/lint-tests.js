const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(ROOT, '..');
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

function fileExists(relPath) {
  return fs.existsSync(path.join(REPO_ROOT, relPath));
}

function readRepoFile(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

// Ensure Docker dev flow reinstalls deps when new packages are added.
try {
  const dockerCompose = readRepoFile('docker-compose.yml');
  if (!dockerCompose.includes('./scripts/dev.sh')) {
    addError(
      'docker-compose.yml',
      'Dev container must run ./scripts/dev.sh to auto-install new deps.'
    );
  }
} catch (error) {
  addError('docker-compose.yml', 'Missing docker-compose.yml for dev check.');
}

if (!fileExists('web/scripts/dev.sh')) {
  addError('web/scripts/dev.sh', 'Missing dev.sh script for Docker installs.');
} else {
  const devScript = readRepoFile('web/scripts/dev.sh');
  if (!devScript.includes('npm ci')) {
    addError(
      'web/scripts/dev.sh',
      'dev.sh should run npm ci when node_modules is missing.'
    );
  }
}

// Ensure jsqr dependency stays available for QR paste decoding.
try {
  const pkg = JSON.parse(readRepoFile('web/package.json'));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (!deps.jsqr) {
    addError(
      'web/package.json',
      'Missing jsqr dependency required for QR image decoding.'
    );
  }
} catch (error) {
  addError('web/package.json', 'Failed to parse package.json for deps.');
}

if (!fileExists('web/types/jsqr.d.ts')) {
  addError(
    'web/types/jsqr.d.ts',
    'Missing jsqr type shim for TS builds.'
  );
}

// Ensure CSP includes WalletConnect verify endpoint.
try {
  const nextConfig = readRepoFile('web/next.config.js');
  if (
    !nextConfig.includes('verify.walletconnect.org') ||
    !nextConfig.includes('pulse.walletconnect.org')
  ) {
    addError(
      'web/next.config.js',
      'CSP must allow verify.walletconnect.org and pulse.walletconnect.org for WalletConnect.'
    );
  }
} catch (error) {
  addError('web/next.config.js', 'Missing next.config.js for CSP lint.');
}

// Ensure Trezor UI errors are surfaced instead of closing silently.
try {
  const trezorConnect = readRepoFile('web/lib/trezorConnect.ts');
  if (!trezorConnect.includes('ui-error')) {
    addError(
      'web/lib/trezorConnect.ts',
      'trezorConnect must emit ui-error for prompt visibility.'
    );
  }
  if (!trezorConnect.includes('hadError')) {
    addError(
      'web/lib/trezorConnect.ts',
      'trezorConnect should track errors to avoid closing prompt.'
    );
  }
  if (!trezorConnect.includes('retriedAfterFeatures')) {
    addError(
      'web/lib/trezorConnect.ts',
      'trezorConnect must retry when a Features response interrupts a call.'
    );
  }
} catch (error) {
  addError('web/lib/trezorConnect.ts', 'Missing trezorConnect for UI lint.');
}

try {
  const prompt = readRepoFile('web/components/TrezorPrompt.tsx');
  if (!prompt.includes('ui-error')) {
    addError(
      'web/components/TrezorPrompt.tsx',
      'TrezorPrompt must render ui-error state.'
    );
  }
} catch (error) {
  addError(
    'web/components/TrezorPrompt.tsx',
    'Missing TrezorPrompt for ui-error lint.'
  );
}

if (errors.length) {
  console.error('Lint tests failed:\n' + errors.map((e) => `- ${e}`).join('\n'));
  process.exit(1);
}

console.log('Lint tests passed.');
