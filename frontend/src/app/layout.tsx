import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "INTEGRITY — Academic Integrity Platform",
  description: "Secure Examination Management & AI-Powered Integrity Detection",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "INTEGRITY",
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    title: "INTEGRITY",
    description: "Secure Examination Management",
  },
};

export const viewport: Viewport = {
  themeColor: "#6366f1",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* PWA: link to manifest */}
        <link rel="manifest" href="/manifest.json" />
        {/* iOS home screen icons — replace with real 192/512 px PNGs */}
        <link rel="apple-touch-icon" href="/icon-192.png" />
        {/* Disable phone-number detection on iOS */}
        <meta name="format-detection" content="telephone=no" />
        {/* iOS standalone mode */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="INTEGRITY" />
        {/* MS Tiles */}
        <meta name="msapplication-TileColor" content="#0f0f23" />
        <meta name="msapplication-tap-highlight" content="no" />
      </head>
      <body className={inter.className}>
        {children}
        {/* Service Worker registration — runs only in the browser */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function () {
                  navigator.serviceWorker
                    .register('/sw.js', { scope: '/' })
                    .then(function (reg) {
                      console.log('[SW] registered, scope:', reg.scope);
                    })
                    .catch(function (err) {
                      console.warn('[SW] registration failed:', err);
                    });
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
