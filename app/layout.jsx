import '@fontsource-variable/inter';
import '@fontsource/inter-tight/600.css';
import '@fontsource/inter-tight/700.css';
import '@fontsource/inter-tight/800.css';
import './globals.css';

export const metadata = {
  title: 'Dipper — know the moment it dips',
  description: "Track prices from Amazon, Walmart, Target, Home Depot, Best Buy, Lowe's, Costco and eBay — with up to two years of price history and drop alerts.",
  manifest: '/manifest.webmanifest',
  applicationName: 'Dipper',
  appleWebApp: { capable: true, title: 'Dipper', statusBarStyle: 'default' },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  formatDetection: { telephone: false },
};

export const viewport = {
  themeColor: '#F5F5F7',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
