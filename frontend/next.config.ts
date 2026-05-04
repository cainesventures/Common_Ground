import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: '/legislation',              destination: '/philadelphia/legislation',              permanent: true },
      { source: '/legislation/:id',          destination: '/philadelphia/legislation/:id',          permanent: true },
      { source: '/insights',                 destination: '/philadelphia/insights',                 permanent: true },
      { source: '/councilmembers',           destination: '/philadelphia/councilmembers',           permanent: true },
      { source: '/councilmembers/:id',       destination: '/philadelphia/councilmembers/:id',       permanent: true },
      { source: '/my-bills',                 destination: '/philadelphia/my-bills',                 permanent: true },
    ]
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
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

const hasSentry = !!process.env.NEXT_PUBLIC_SENTRY_DSN || !!process.env.SENTRY_DSN

export default hasSentry
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: true,
      widenClientFileUpload: true,
      disableLogger: true,
    })
  : nextConfig;
