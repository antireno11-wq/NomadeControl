/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true
  },
  output: "standalone",
  experimental: {
    outputFileTracingIncludes: {
      "/**": ["./node_modules/.prisma/**/*"]
    }
  }
};

export default nextConfig;
