import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma is configured with the default native binary engine (no driver
  // adapters, no wasm engineType), so these wasm bundles for every database
  // Prisma supports are traced into every function but never loaded at
  // runtime. Excluding them cuts each function's bundle by ~65MB.
  outputFileTracingExcludes: {
    "/*": [
      "./node_modules/@prisma/client/runtime/query_engine_bg.*.wasm-base64.*",
      "./node_modules/@prisma/client/runtime/query_compiler_bg.*.wasm-base64.*",
    ],
  },
};

export default nextConfig;
