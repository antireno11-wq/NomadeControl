/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true
  },
  output: "standalone",
  images: {
    // El optimizador de imágenes de Next necesita `sharp` en modo standalone
    // y, al no tenerlo, fallaba en cada carga —y de paso intentaba llamarse a
    // sí mismo en un puerto que no existe, que es el ECONNREFUSED del log—.
    //
    // No se instala sharp porque aquí no compensa: `next/image` se usa solo
    // para el logo, un PNG pequeño y estático. Todo lo demás —documentos,
    // fotos de checklist, miniaturas de Drive— va por <img> y nunca pasó por
    // el optimizador. Agregar una dependencia nativa de ~30 MB al build para
    // redimensionar un logo es peor negocio que servirlo tal cual.
    unoptimized: true
  },
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
