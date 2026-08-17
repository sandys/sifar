/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  webpack: (config, { dev }) => {
    if (dev) {
      config.devtool = 'source-map';
    }
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      crypto: false,
      usb: false,
      dgram: false
    };
    return config;
  },
  async redirects() {
    // The camera-QR flow that used to live at / was removed; /trezor-usb is the
    // only flow. Redirect rather than 404 so existing links still land.
    return [
      {
        source: '/',
        destination: '/trezor-usb',
        permanent: false
      }
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "connect-src 'self' wss://relay.walletconnect.com wss://relay.walletconnect.org https://verify.walletconnect.org https://verify.walletconnect.com https://pulse.walletconnect.org https://api.mainnet-beta.solana.com https://*.helius-rpc.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: https:",
              // WalletConnect's attestation iframe. Without this default-src
              // blocks it and every proposal degrades to unverified, losing the
              // anti-phishing signal.
              "frame-src 'self' https://verify.walletconnect.org https://verify.walletconnect.com",
              // Session approval needs no hardware confirmation, so an embedded
              // copy of this page would be trivially clickjackable.
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'"
            ].join('; ')
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          },
          {
            key: 'Referrer-Policy',
            value: 'no-referrer'
          }
        ]
      }
    ];
  }
};

module.exports = nextConfig;
