import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Self-contained server for the Docker image (`node server.js`). Plain `npm start` uses the regular build.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Native addon + long-lived socket client: load with plain Node require, don't bundle.
  serverExternalPackages: ["better-sqlite3", "mqtt"],
  // Migrations are read from disk at startup.
  outputFileTracingIncludes: { "/*": ["./drizzle/**/*"] },
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
