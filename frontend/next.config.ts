import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Compress all responses (text, JSON, HTML) — big win for slow connections
  compress: true,

  // Serve pre-built pages from the edge cache as long as possible
  // Individual pages that need fresh data use revalidate in their fetch calls
  // (these are mostly client-rendered anyway, so this is belt-and-braces)

  // Image optimisation — allow local /public images and the Supabase CDN
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
    // Serve WebP / AVIF automatically (smaller than PNG/JPEG)
    formats: ["image/avif", "image/webp"],
  },

  // Turbopack-compatible: split heavy libs into their own chunks so
  // students loading only the exam page don't pull in recharts/leaflet
  experimental: {
    optimizePackageImports: [
      "recharts",
      "lucide-react",
      "leaflet",
      "react-leaflet",
      "prismjs",
      "katex",
    ],
  },
};

export default nextConfig;
