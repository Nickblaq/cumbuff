/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: `next build` emits web/out, which the Express gateway serves.
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
