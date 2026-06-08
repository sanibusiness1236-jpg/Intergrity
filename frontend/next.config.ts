import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Compress all responses (text, JSON, HTML) — big win for slow connections
  compress: true,

  // Image optimisation — allow local /public images and the Supabase CDN
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
    formats: ["image/avif", "image/webp"],
  },

  // Turbopack-compatible: split heavy libs into their own chunks
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

  // Custom headers for Service Worker and PWA files
  async headers() {
    return [
      {
        // Service Worker must be served with no-cache so updates propagate immediately
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            // Allow the SW to control all paths under /
            key: "Service-Worker-Allowed",
            value: "/",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
        ],
      },
      {
        // Manifest — short TTL so installs pick up icon/name changes quickly
        source: "/manifest.json",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=300",
          },
        ],
      },
      {
        // Offline fallback page
        source: "/offline.html",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
