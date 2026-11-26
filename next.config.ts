import type { NextConfig } from "next";

// Static export: the same `out/` folder is served on the web and bundled into the
// Capacitor shell. Everything dynamic runs in the browser against Supabase + Modal.
const nextConfig: NextConfig = {
  // O indicador do next dev cobre a aba Biblioteca no celular.
  devIndicators: false,
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  experimental: {
    agentFeedback: true,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
