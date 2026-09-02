import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Codex's local preview forwards dev resources through a loopback origin.
  // Keep this development-only allowlist narrow so Turbopack chunks and HMR
  // are not rejected with 403 when the page itself is opened on 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    return [
      {
        source: "/demo-assets/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; form-action 'none'; connect-src 'none'; base-uri 'none'",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
