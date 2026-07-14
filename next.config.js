/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'api.qrserver.com', pathname: '/**' },
    ],
  },
  // Server-only packages — not bundled by Next.js webpack, loaded from node_modules at runtime.
  // bcryptjs and nodemailer are pure-Node modules; mongodb was already here.
  serverExternalPackages: ['mongodb', 'bcryptjs', 'nodemailer'],
  async headers() {
    // CORS for the /api/* routes so external clients (mobile / dashboards) can call them.
    // Note: admin cookie routes (/api/admin/*) are same-origin — CORS headers are irrelevant
    // for same-origin browser requests and do not interfere with SameSite=Strict cookies.
    //
    // Standard security headers applied site-wide: prevent MIME-sniffing,
    // prevent the site (including the admin login/panel) from being framed
    // by another origin (clickjacking), limit referrer leakage, enforce
    // HTTPS on repeat visits, and set a baseline CSP compatible with the
    // existing Next.js app (inline styles/scripts from Next's own runtime
    // and hydration data are allowed; remote images limited to self +
    // api.qrserver.com per next.config.js image remotePatterns).
    const securityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https://api.qrserver.com",
          "connect-src 'self'",
          "font-src 'self' data:",
        ].join('; '),
      },
    ];

    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        source: '/api/(.*)',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: process.env.CORS_ORIGINS || '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, PATCH, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
