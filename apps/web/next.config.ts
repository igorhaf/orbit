import type { NextConfig } from 'next';

const apiProxy = process.env.ORBIT_API_PROXY_URL || 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiProxy}/:path*`,
      },
      {
        source: '/socket.io/:path*',
        destination: `${apiProxy}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
