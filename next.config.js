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
    return [
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
