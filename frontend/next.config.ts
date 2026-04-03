import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/api/:path*",
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "phlcouncil.com" },
      { protocol: "https", hostname: "**.phlcouncil.com" },
      { protocol: "https", hostname: "api.dicebear.com" },
      { protocol: "https", hostname: "flagcdn.com" },
      { protocol: "https", hostname: "**.wp.com" },
      { protocol: "https", hostname: "**.wordpress.com" },
      { protocol: "https", hostname: "**.gravatar.com" },
    ],
  },
};

export default nextConfig;
