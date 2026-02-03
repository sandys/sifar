import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        ink: '#0a0a0a',
        sand: '#f6f1e8',
        ember: '#ff5a3d',
        moss: '#1f6f4a',
        steel: '#2b2f36'
      },
      fontFamily: {
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui'],
        body: ['var(--font-body)', 'ui-sans-serif', 'system-ui'],
        jomhuria: ['var(--font-jomhuria)', 'serif'],
        rakkas: ['var(--font-rakkas)', 'serif'],
        aref: ['var(--font-aref)', 'serif']
      }
    }
  },
  plugins: []
};

export default config;
