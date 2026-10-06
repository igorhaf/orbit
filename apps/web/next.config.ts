import type { NextConfig } from 'next';
import { networkInterfaces } from 'node:os';

const apiProxy = process.env.ORBIT_API_PROXY_URL || 'http://127.0.0.1:4000';
const forcedTheme = process.env.THEME === 'dark' ? 'dark' : '';
const orbitEnvironment = process.env.THEME === 'dark' ? 'development' : '';
const localAddresses = Object.values(networkInterfaces()).flatMap(devices => devices?.filter(device => device.family === 'IPv4').map(device => device.address) || []);

const nextConfig: NextConfig = {
  distDir: process.env.ORBIT_NEXT_DIST_DIR || '.next',
  allowedDevOrigins: ['localhost', '127.0.0.1', ...localAddresses],
  env: { NEXT_PUBLIC_ORBIT_THEME: forcedTheme, NEXT_PUBLIC_ORBIT_ENV: orbitEnvironment },
  skipTrailingSlashRedirect: true,
  experimental: { useTypeScriptCli: false },
  async headers() {
    return [{
      source: '/:path*',
      headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0, must-revalidate' }],
    }];
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiProxy}/:path*`,
      },
      {
        source: '/socket.io',
        destination: `${apiProxy}/socket.io/`,
      },
      {
        source: '/socket.io/:path*',
        destination: `${apiProxy}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
