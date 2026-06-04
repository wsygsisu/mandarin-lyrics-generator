import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["music-metadata"],
  // Expose Vercel flag to the browser bundle at build time
  env: {
    NEXT_PUBLIC_IS_VERCEL: process.env.VERCEL === "1" ? "1" : "",
  },
};

export default nextConfig;
