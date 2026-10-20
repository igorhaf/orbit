import type { NextConfig } from 'next';
import { networkInterfaces } from 'node:os';

const apiProxy = process.env.ORBIT_API_PROXY_URL || 'http://127.0.0.1:4000';
const forcedTheme = process.env.THEME === 'dark' ? 'dark' : '';
const orbitEnvironment = process.env.THEME === 'dark' ? 'development' : '';
const localAddresses = Object.values(networkInterfaces()).flatMap(devices => devices?.filter(device => device.family === 'IPv4').map(device => device.address) || []);
const privateNetworkOrigins = ['10.*.*.*', '192.168.*.*', ...Array.from({length: 16}, (_, index) => `172.${index + 16}.*.*`)];
const nextDistDir = process.env.ORBIT_NEXT_DIST_DIR || (process.env.NODE_ENV === 'development' ? '.next-dev' : '.next');

const nextConfig: NextConfig = {
  distDir: nextDistDir,
  allowedDevOrigins: ['localhost', '127.0.0.1', 'orbit.meadadigital.com', ...localAddresses, ...privateNetworkOrigins],
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
        source: '/integrations/alexa/orbit',
        destination: `${apiProxy}/integrations/alexa/orbit`,
      },
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
