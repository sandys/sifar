import type { Metadata } from 'next';
import { Space_Grotesk, Source_Sans_3, Jomhuria, Rakkas, Aref_Ruqaa } from 'next/font/google';
import './globals.css';
import { AppProviders } from './providers';

const display = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap'
});

const body = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap'
});

const jomhuria = Jomhuria({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-jomhuria',
  display: 'swap'
});

const rakkas = Rakkas({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-rakkas',
  display: 'swap'
});

const arefRuqaa = Aref_Ruqaa({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-aref',
  display: 'swap'
});

export const metadata: Metadata = {
  title: 'Sifar',
  description: 'Zero-trust WalletConnect bridge. This code does nothing — Trezor does everything.'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${jomhuria.variable} ${rakkas.variable} ${arefRuqaa.variable}`}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
