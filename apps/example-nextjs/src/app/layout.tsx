import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';

import './globals.css';

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'RawDash',
  description: 'Open-source headless dashboard',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${plusJakartaSans.variable} font-sans antialiased`}>
        <header className="flex h-12 items-center justify-between border-b border-gray-100 bg-white px-5">
          <span className="text-sm font-bold tracking-tight text-gray-900">
            rawdash
          </span>
          <a
            href="https://rawdash.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-700"
          >
            rawdash.dev ↗
          </a>
        </header>
        <main className="min-h-[calc(100vh-3rem)] bg-gray-50">{children}</main>
      </body>
    </html>
  );
}
