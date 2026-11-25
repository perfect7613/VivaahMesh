import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    const privatePage = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "private, no-store" },
      { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'" },
    ];
    return [
      { source: "/:path*", headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'; form-action 'self'" },
      ] },
      { source: "/call-consent/:path*", headers: privatePage },
      { source: "/makeup-reply/:path*", headers: privatePage },
      { source: "/rsvp/:path*", headers: privatePage },
      { source: "/vendor/:path*", headers: privatePage },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
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
