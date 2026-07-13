import './globals.css';
import { Toaster } from 'sonner';

export const metadata = {
  title: 'UNIBATCH — Transparent Trading Fund',
  description: "Fund a Trader's Dream — Just $250 to Start. A transparent, on-chain fundraising site for Chintu Kumar's trading capital goal.",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1' y1='0' y2='1'%3E%3Cstop offset='0' stop-color='%2338bdf8'/%3E%3Cstop offset='1' stop-color='%23facc15'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='14' fill='%23050b1f'/%3E%3Cpath d='M20 14v24a12 12 0 0 0 24 0V14' stroke='url(%23g)' stroke-width='5' fill='none' stroke-linecap='round'/%3E%3Crect x='29' y='40' width='6' height='12' fill='%23facc15' rx='1.5'/%3E%3C/svg%3E",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body>
        {children}
        <Toaster theme="dark" position="top-center" richColors />
      </body>
    </html>
  );
}
