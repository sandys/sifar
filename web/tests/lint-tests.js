const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Detect if running in Docker (volume mounted at /app)
const IS_DOCKER = ROOT === '/app' || process.env.DOCKER === '1';
// In Docker, repo root files are not accessible; use ROOT for web-relative paths
const REPO_ROOT = IS_DOCKER ? null : path.join(ROOT, '..');
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
  // In Docker, resolve web/ paths to ROOT, skip repo-level paths
  if (IS_DOCKER) {
    if (relPath.startsWith('web/')) {
      return fs.existsSync(path.join(ROOT, relPath.slice(4)));
    }
    // Repo-level files not accessible in Docker
    return false;
  }
  return fs.existsSync(path.join(REPO_ROOT, relPath));
}

function readRepoFile(relPath) {
  // In Docker, resolve web/ paths to ROOT
  if (IS_DOCKER) {
    if (relPath.startsWith('web/')) {
      return fs.readFileSync(path.join(ROOT, relPath.slice(4)), 'utf8');
    }
    throw new Error(`Cannot read repo-level file in Docker: ${relPath}`);
  }
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

// Ensure Docker dev flow reinstalls deps when new packages are added.
// Skip repo-level checks in Docker (docker-compose.yml not accessible)
if (!IS_DOCKER) {
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
  // Ensure appReady state exists for global loading state
  if (!storeFile.includes('appReady:')) {
    addError(
      'web/lib/store.ts',
      'Store must have appReady state for global loading overlay.'
    );
  }
  if (!storeFile.includes('setAppReady')) {
    addError(
      'web/lib/store.ts',
      'Store must have setAppReady action to control loading state.'
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

// ============================================
// Global Loading State - Block UI Until Initialized
// ============================================
// BUG HISTORY: Page rendered before async initializations complete.
// User clicks buttons (WC pairing, etc.) and nothing happens because services aren't ready.
// FIX: Show a full-page loading overlay until critical services are initialized.

// Ensure LoadingOverlay component exists and uses proper selector
if (!fileExists('web/components/LoadingOverlay.tsx')) {
  addError(
    'web/components/LoadingOverlay.tsx',
    'Missing LoadingOverlay component for global loading state.'
  );
} else {
  try {
    const loadingOverlay = readRepoFile('web/components/LoadingOverlay.tsx');
    if (!loadingOverlay.includes('appReady')) {
      addError(
        'web/components/LoadingOverlay.tsx',
        'LoadingOverlay must use appReady state from store.'
      );
    }
    // Must use selector pattern
    if (loadingOverlay.includes('useAppStore()') && !loadingOverlay.includes('useAppStore((')) {
      addError(
        'web/components/LoadingOverlay.tsx',
        'LoadingOverlay must use useAppStore with selector, not useAppStore().'
      );
    }
  } catch (error) {
    addError('web/components/LoadingOverlay.tsx', 'Failed to read LoadingOverlay component.');
  }
}

// Ensure providers.tsx properly sets appReady
try {
  const providersFile = readRepoFile('web/app/providers.tsx');
  if (!providersFile.includes('setAppReady')) {
    addError(
      'web/app/providers.tsx',
      'providers.tsx must call setAppReady to control loading state.'
    );
  }
  if (!providersFile.includes('setAppReady(true)')) {
    addError(
      'web/app/providers.tsx',
      'providers.tsx must set appReady to true after initialization.'
    );
  }
  // Must have timeout to prevent infinite loading
  if (!providersFile.includes('Init timeout') && !providersFile.includes('setTimeout')) {
    addError(
      'web/app/providers.tsx',
      'providers.tsx must have timeout to prevent infinite loading spinner.'
    );
  }
} catch (error) {
  addError('web/app/providers.tsx', 'Failed to read providers for loading state lint.');
}

// Ensure main page includes LoadingOverlay
try {
  const trezorUsbPage = readRepoFile('web/app/trezor-usb/page.tsx');
  if (!trezorUsbPage.includes('LoadingOverlay')) {
    addError(
      'web/app/trezor-usb/page.tsx',
      'trezor-usb page must include LoadingOverlay to block UI until initialized.'
    );
  }
} catch (error) {
  addError('web/app/trezor-usb/page.tsx', 'Failed to read trezor-usb page for loading state lint.');
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

// Ensure trezorConnect.ts uses signature directly from protobuf (already hex).
// @trezor/protobuf decode.ts converts bytes fields to hex strings automatically.
try {
  const trezorConnectFile = readRepoFile('web/lib/trezorConnect.ts');
  // Ensure signature is used directly (no double conversion)
  if (!trezorConnectFile.includes('signatureHex')) {
    addError(
      'web/lib/trezorConnect.ts',
      'solanaSignTransaction must use signatureHex variable for signature'
    );
  }
  // Ensure we're NOT double-encoding the signature
  if (trezorConnectFile.includes("Buffer.from(response.message.signature)")) {
    addError(
      'web/lib/trezorConnect.ts',
      'Do not use Buffer.from on signature - @trezor/protobuf already returns hex string'
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

// ============================================
// CRITICAL: Signing Account Mismatch Prevention
// ============================================
// BUG HISTORY: Signing used store.solanaDerivationPath which could be a DIFFERENT
// account than the transaction's signer. This caused signature verification failures
// because Trezor signed with key A but transaction expected signature from key B.
//
// FIX: Extract signer address from transaction, find matching account, use its path.
//
// NEVER use store.solanaDerivationPath directly for signing - always derive from transaction signer.
try {
  const signingFile = readRepoFile('web/lib/signing.ts');

  // MUST extract signer from transaction before signing
  if (!signingFile.includes('staticAccountKeys[0]') && !signingFile.includes('feePayer')) {
    addError(
      'web/lib/signing.ts',
      'CRITICAL: Must extract signer address from transaction (staticAccountKeys[0] or feePayer)'
    );
  }

  // MUST find matching account by address
  if (!signingFile.includes('solanaAccounts.find')) {
    addError(
      'web/lib/signing.ts',
      'CRITICAL: Must find matching account by signer address, not use store.solanaDerivationPath directly'
    );
  }

  // MUST NOT use store.solanaDerivationPath directly in signSolanaTransaction call
  if (signingFile.includes('signSolanaTransaction') &&
      signingFile.includes('store.solanaDerivationPath') &&
      !signingFile.includes('matchingAccount')) {
    addError(
      'web/lib/signing.ts',
      'CRITICAL: Do not use store.solanaDerivationPath for signing. ' +
      'Extract signer from transaction and find matching account derivation path.'
    );
  }

  // Should verify signature locally before sending
  if (!signingFile.includes('nacl.sign.detached.verify') && !signingFile.includes('signature verification')) {
    addError(
      'web/lib/signing.ts',
      'Should verify signature locally before sending to catch mismatches early'
    );
  }
} catch (error) {
  addError('web/lib/signing.ts', 'Missing signing.ts for account mismatch lint.');
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

// Mistake: Signature handling without logging
// trezorConnect should log signature length for debugging
function checkSignatureLogging(file, content) {
  if (file === 'lib/trezorConnect.ts') {
    if (content.includes('SolanaTxSignature')) {
      // Should log signature hex length for debugging
      if (!content.includes('Signature hex length') && !content.includes('signatureHex.length')) {
        addError(file, 'Signature handling should log hex length for debugging.');
      }
    }
  }
}

// Mistake: Double-encoding Trezor signature (128 hex chars became 256)
// @trezor/protobuf decode.ts already converts bytes fields to hex strings.
// Using Buffer.from(sig).toString('hex') on an already-hex string doubles the length.
function checkTrezorSignatureEncoding(file, content) {
  if (file === 'lib/trezorConnect.ts') {
    // The signature from protobuf is ALREADY hex - do not re-encode
    if (content.includes("Buffer.from(response.message.signature).toString('hex')") ||
        content.includes('Buffer.from(sig).toString(\'hex\')')) {
      addError(file,
        'CRITICAL: Do not double-encode Trezor signature. ' +
        '@trezor/protobuf already returns hex string. ' +
        'Use response.message.signature directly.'
      );
    }
  }
}

// Mistake: Using store.solanaDerivationPath instead of transaction signer's path
// WalletConnect sessions can be connected with different accounts than the active UI account.
// MUST extract signer from transaction and find matching account derivation path.
function checkSigningAccountMismatch(file, content) {
  if (file === 'lib/signing.ts') {
    // If signing and using store.solanaDerivationPath without finding matching account
    if (content.includes('signSolanaTransaction') &&
        content.includes('store.solanaDerivationPath') &&
        !content.includes('matchingAccount')) {
      addError(file,
        'CRITICAL: Signing must use derivation path from transaction signer, not store. ' +
        'Extract signer from tx, find matching account, use that path.'
      );
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
  checkTrezorSignatureEncoding(file, content);
  checkSigningAccountMismatch(file, content);
  checkNoRedundantDisplays(file, content);
  checkFilterUIClarity(file, content);
}

// ============================================
// Session Key Delegation Safeguards
// ============================================
// Session keys allow temporary message signing without Trezor.
// MUST have expiration and revocation to limit risk.

// Ensure session key has expiration
try {
  const sessionKeyFile = readRepoFile('web/lib/sessionKey.ts');
  if (!sessionKeyFile.includes('expiresAt')) {
    addError(
      'web/lib/sessionKey.ts',
      'Session keys must have expiration time (expiresAt).'
    );
  }
  if (!sessionKeyFile.includes('isSessionKeyValid')) {
    addError(
      'web/lib/sessionKey.ts',
      'Must validate session key expiration before use (isSessionKeyValid).'
    );
  }
} catch (error) {
  // File may not exist yet
}

// Ensure session key UI allows revocation
try {
  const sessionKeyStatusFile = readRepoFile('web/components/SessionKeyStatus.tsx');
  if (!sessionKeyStatusFile.includes('clearSessionKey')) {
    addError(
      'web/components/SessionKeyStatus.tsx',
      'Session key UI must allow revocation (clearSessionKey).'
    );
  }
} catch (error) {
  // File may not exist yet
}

// Ensure session key setup modal warns about limitations
try {
  const sessionKeySetupFile = readRepoFile('web/components/SessionKeySetupModal.tsx');
  if (!sessionKeySetupFile.includes('pump.fun') && !sessionKeySetupFile.includes('will reject')) {
    addError(
      'web/components/SessionKeySetupModal.tsx',
      'Session key setup must warn that most dApps will reject delegated signatures.'
    );
  }
} catch (error) {
  // File may not exist yet
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
