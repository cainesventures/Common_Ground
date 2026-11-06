import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

// Unique per build and inlined into the bundle; see DEPLOY_KEY in lib/backend.ts.
const backendCacheKey = Date.now().toString(36)

const nextConfig: NextConfig = {
  env: {
    BACKEND_CACHE_KEY: backendCacheKey,
  },
  experimental: {
    // ~8,700 bill pages are built from the one Railway instance. A failed
    // backend lookup fails its page (lib/backend.ts); retry before failing
    // the deploy over a blip.
    staticGenerationRetryCount: 2,
    // Build workers default to one per core less one, which on a 24-core dev
    // machine is ~180 pages fetching at once. Pinned to the Hobby build
    // machine's 2 vCPUs so a local build loads the backend the way a deploy does.
    cpus: 2,
  },
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
