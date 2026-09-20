import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.0,
    ignoreErrors: [
      // Scripts injected by in-app browsers (Instagram/Facebook WKWebView on
      // iOS) probe the native bridge and throw in our page's context. Not our
      // code — see Sentry issue OPEN-COMMON-GROUND-FRONTEND-4.
      "window.webkit.messageHandlers",
      "undefined is not an object (evaluating 'window.webkit.messageHandlers')",
    ],
  })
}
