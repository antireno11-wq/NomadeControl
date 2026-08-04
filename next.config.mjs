/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true
  },
  output: "standalone",
  experimental: {
    outputFileTracingIncludes: {
      "/**": ["./node_modules/.prisma/**/*"]
    },
    serverActions: {
      // Los PDFs de acreditación llegan a 3-4 MB y viajan en base64
      // (~33% más). El default de 1 MB los rechaza.
      bodySizeLimit: "25mb"
    }
  }
};

export default nextConfig;
