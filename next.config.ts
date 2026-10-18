import type { NextConfig } from "next";

// Web privada y 100 % dinámica (cada petición lee la sesión del usuario), así que no se usa
// Cache Components / Partial Prefetching.
const nextConfig: NextConfig = {
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
