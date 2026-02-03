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

  // Check for double hex encoding (common mistake with Buffer)
  checkDoubleHexEncoding(file, content);

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

  if (file === 'app/providers.tsx' && !content.includes('__sifarConsolePatched')) {
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

// Ensure WalletConnect approval uses buildApprovedNamespaces (prevents silent mismatch).
try {
  const wcFile = readRepoFile('web/lib/walletconnect.ts');
  if (!wcFile.includes('buildApprovedNamespaces')) {
    addError(
      'web/lib/walletconnect.ts',
      'WalletConnect approvals must use buildApprovedNamespaces.'
    );
  }
} catch (error) {
  addError('web/lib/walletconnect.ts', 'Missing walletconnect approval file.');
}

// Ensure WalletConnect modal shows session approval note and uses env project ID.
try {
  const modal = readRepoFile('web/components/WalletConnectModal.tsx');
  if (!modal.includes('Session approval does not use Trezor')) {
    addError(
      'web/components/WalletConnectModal.tsx',
      'WalletConnect modal must explain that session approval does not use Trezor.'
    );
  }
  if (!modal.includes('Connect WalletConnect')) {
    addError(
      'web/components/WalletConnectModal.tsx',
      'WalletConnect modal must expose a Connect WalletConnect CTA.'
    );
  }
} catch (error) {
  addError(
    'web/components/WalletConnectModal.tsx',
    'Missing WalletConnect modal for lint.'
  );
}

// Ensure env WC project ID is propagated into store.
try {
  const storeFile = readRepoFile('web/lib/store.ts');
  if (!storeFile.includes('NEXT_PUBLIC_WC_PROJECT_ID')) {
    addError(
      'web/lib/store.ts',
      'Store should seed wcProjectId from NEXT_PUBLIC_WC_PROJECT_ID.'
    );
  }
} catch (error) {
  addError('web/lib/store.ts', 'Missing store for WC project ID lint.');
}

// Ensure pages do not use redundant TransactionPreview/SigningFlow (signing is in WalletConnectModal).
const pageFiles = ['web/app/page.tsx', 'web/app/trezor-usb/page.tsx'];
for (const pageFile of pageFiles) {
  try {
    const pageContent = readRepoFile(pageFile);
    if (pageContent.includes('TransactionPreview')) {
      addError(
        pageFile,
        'Do not use TransactionPreview; signing UI is in WalletConnectModal.'
      );
    }
    if (pageContent.includes('SigningFlow')) {
      addError(
        pageFile,
        'Do not use SigningFlow; signing UI is in WalletConnectModal.'
      );
    }
  } catch (error) {
    // Page might not exist, skip
  }
}

// Ensure Trezor signatures are normalized (128 bytes -> 64 bytes).
try {
  const signingFile = readRepoFile('web/lib/signing.ts');
  if (!signingFile.includes('normalizeSignature')) {
    addError(
      'web/lib/signing.ts',
      'signing.ts must use normalizeSignature to handle 128-byte Trezor signatures.'
    );
  }
} catch (error) {
  addError('web/lib/signing.ts', 'Missing signing.ts for signature lint.');
}

// Ensure WalletConnectModal handles unsupported solana_signMessage properly.
try {
  const modalFile = readRepoFile('web/components/WalletConnectModal.tsx');
  if (!modalFile.includes('solana_signMessage')) {
    addError(
      'web/components/WalletConnectModal.tsx',
      'WalletConnectModal must handle unsupported solana_signMessage requests.'
    );
  }
  if (!modalFile.includes('Trezor Hardware Limitation') && !modalFile.includes('Not Supported')) {
    addError(
      'web/components/WalletConnectModal.tsx',
      'WalletConnectModal must show unsupported message for solana_signMessage.'
    );
  }
} catch (error) {
  addError('web/components/WalletConnectModal.tsx', 'Missing modal for signMessage lint.');
}

// Ensure store uses activeSessions (array), not singular activeSession.
try {
  const storeFile = readRepoFile('web/lib/store.ts');
  if (storeFile.includes('activeSession:') && !storeFile.includes('activeSessions:')) {
    addError(
      'web/lib/store.ts',
      'Store should use activeSessions (array), not singular activeSession.'
    );
  }
} catch (error) {
  // Already checked above
}

// Ensure trezorConnect.ts handles signature format detection.
// Trezor may return bytes OR hex string depending on protobuf version.
try {
  const trezorConnectFile = readRepoFile('web/lib/trezorConnect.ts');
  // Ensure signature format is detected and handled
  if (!trezorConnectFile.includes('signatureHex') || !trezorConnectFile.includes('typeof sig')) {
    addError(
      'web/lib/trezorConnect.ts',
      'solanaSignTransaction must detect and handle signature format (bytes or hex string)'
    );
  }
} catch (error) {
  addError('web/lib/trezorConnect.ts', 'Missing trezorConnect for signature lint.');
}

// Ensure signing.ts normalizeSignature expects 128 hex chars (64 bytes), not 256.
try {
  const signingFile = readRepoFile('web/lib/signing.ts');
  if (signingFile.includes('sigBytes.length === 128') && signingFile.includes('.slice(')) {
    addError(
      'web/lib/signing.ts',
      'normalizeSignature should not slice 128-byte signatures. Trezor returns 128 hex chars (64 bytes).'
    );
  }
  // Ensure we're using Buffer.from with 'hex' encoding
  if (signingFile.includes("Buffer.from(hexSig)") && !signingFile.includes("Buffer.from(hexSig, 'hex')")) {
    addError(
      'web/lib/signing.ts',
      'Use Buffer.from(hexSig, "hex") to properly decode hex string to bytes.'
    );
  }
} catch (error) {
  addError('web/lib/signing.ts', 'Missing signing.ts for signature lint.');
}

// Ensure no double Buffer.from().toString('hex') patterns in any file (common mistake).
// EXCEPTION: trezorConnect.ts legitimately converts protobuf BYTES to hex (not hex to hex).
function checkDoubleHexEncoding(file, content) {
  // Skip trezorConnect.ts - it converts protobuf raw bytes to hex, which is correct
  if (file === 'lib/trezorConnect.ts') return;

  // Pattern: Buffer.from(something).toString('hex') where something is likely already hex
  const dangerousPatterns = [
    // Only flag when variable name suggests it's already hex
    /Buffer\.from\(\s*[a-zA-Z_]+Hex\s*\)\.toString\(\s*['"]hex['"]\s*\)/
  ];
  for (const pattern of dangerousPatterns) {
    if (pattern.test(content)) {
      addError(
        file,
        'Potential double hex encoding detected: Buffer.from(hexValue).toString("hex"). Use Buffer.from(x, "hex") for hex strings.'
      );
      break;
    }
  }
}

// ============================================
// INTROSPECTION LINTS - Mistakes I've Made
// ============================================

// Mistake: Used [Trezor] prefix after rebranding to Sifar
// All console logs should use [Sifar] prefix for consistent branding
function checkBrandingConsistency(file, content) {
  if (content.includes("'[Trezor]'") || content.includes('"[Trezor]"')) {
    addError(file, 'Use [Sifar] prefix for console logs, not [Trezor]. Rebranding consistency.');
  }
}

// Mistake: Added actual Arabic script when user wanted Arabic-style fonts for Latin text
// No Arabic/RTL Unicode characters should be in source files (U+0600 to U+06FF)
function checkNoArabicScript(file, content) {
  // Arabic Unicode range: \u0600-\u06FF
  if (/[\u0600-\u06FF]/.test(content)) {
    addError(file, 'Contains Arabic script characters. Use Arabic-style fonts for Latin text only, no actual Arabic.');
  }
}

// Mistake: Ghost/invisible buttons for important actions like Disconnect
// Disconnect buttons should have visible styling (border, bg color)
function checkDisconnectButtonVisibility(file, content) {
  // If file has handleDisconnect and uses variant="ghost" for disconnect
  if (content.includes('handleDisconnect') && content.includes('variant="ghost"')) {
    // Check if it's specifically for disconnect button
    if (/onClick=\{handleDisconnect\}[^>]*variant="ghost"/.test(content) ||
        /variant="ghost"[^>]*onClick=\{handleDisconnect\}/.test(content)) {
      addError(file, 'Disconnect button should not use ghost variant - too subtle. Use visible styling.');
    }
  }
}

// Mistake: Pages had separate header + functional card = redundant UI
// Pages should not have standalone <header> sections - merge branding into functional components
function checkNoStandaloneHeaders(file, content) {
  if (file.startsWith('app/') && file.endsWith('page.tsx')) {
    // Check for <header> followed by functional components
    if (/<header[\s\S]*?<\/header>[\s\S]*?<[A-Z][a-zA-Z]+/.test(content)) {
      // Allow if header is minimal (e.g., just navigation)
      const headerMatch = content.match(/<header[\s\S]*?<\/header>/);
      if (headerMatch && headerMatch[0].length > 500) {
        addError(file, 'Page has large standalone header. Merge branding into the main functional component.');
      }
    }
  }
}

// Mistake: Error displays without actionable buttons
// Error states should always have dismiss or retry options
function checkErrorsHaveActions(file, content) {
  // Check for error display patterns without buttons nearby
  if (content.includes('{error &&') || content.includes('{error ?')) {
    // Should have some button for dismissing/retrying
    const hasErrorDismiss = content.includes('setError(null)') ||
                            content.includes('setError("")') ||
                            content.includes('clearError');
    if (!hasErrorDismiss && file.includes('Modal')) {
      addError(file, 'Error display should have dismiss/retry action. Users need a way to recover from errors.');
    }
  }
}

// Mistake: Signature handling without proper format logging
// trezorConnect must log raw signature format details for debugging
function checkSignatureLogging(file, content) {
  if (file === 'lib/trezorConnect.ts') {
    if (content.includes('SolanaTxSignature')) {
      // Must log signature type and format before conversion
      if (!content.includes('typeof sig') && !content.includes('constructor')) {
        addError(file, 'Signature handling must log format details (typeof, constructor) before conversion.');
      }
    }
  }
}

// Mistake: Redundant data displays (like "Solana Address" when accounts are shown)
// Avoid showing the same data in multiple formats
function checkNoRedundantDisplays(file, content) {
  if (file.includes('WalletDisplay') || file.includes('Display')) {
    // Check for patterns that might be redundant
    if (content.includes('Solana Address') && content.includes('solanaAccounts')) {
      addError(file, 'Showing "Solana Address" separately when accounts are displayed is redundant.');
    }
  }
}

// Mistake: Filter UI was not self-explanatory (just showed "X Connected" badge)
// Toggle/filter UI should clearly show all options
function checkFilterUIClarity(file, content) {
  if (content.includes('filterConnected') || content.includes('setFilter')) {
    // Should have explicit toggle showing both states
    const hasExplicitToggle = content.includes('All (') ||
                              content.includes('Show All') ||
                              content.includes('All |');
    if (!hasExplicitToggle && content.includes('Connected (')) {
      // Only showing "Connected" without "All" option is confusing
      addError(file, 'Filter UI should explicitly show all options (e.g., "All | Connected"), not just one state.');
    }
  }
}

// Run introspection lints on all files
function runIntrospectionLints(file, content) {
  checkBrandingConsistency(file, content);
  checkNoArabicScript(file, content);
  checkDisconnectButtonVisibility(file, content);
  checkNoStandaloneHeaders(file, content);
  checkErrorsHaveActions(file, content);
  checkSignatureLogging(file, content);
  checkNoRedundantDisplays(file, content);
  checkFilterUIClarity(file, content);
}

// Re-walk to run introspection lints
function walkForIntrospection(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      walkForIntrospection(path.join(dir, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx|js)$/.test(entry.name)) continue;
    const filePath = path.join(dir, entry.name);
    const relPath = path.relative(ROOT, filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    runIntrospectionLints(relPath, content);
  }
}

walkForIntrospection(ROOT);

if (errors.length) {
  console.error('Lint tests failed:\n' + errors.map((e) => `- ${e}`).join('\n'));
  process.exit(1);
}

console.log('Lint tests passed.');
