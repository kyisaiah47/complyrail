/** @type {import('next').NextConfig} */
const nextConfig = {
  // The engine runs in Node at run time. It is never bundled into the site.
  serverExternalPackages: ['complyrail'],
};

export default nextConfig;
