/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export', // For Cloudflare Pages static deployment
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  trailingSlash: true, // Required for static export
};

module.exports = nextConfig;
