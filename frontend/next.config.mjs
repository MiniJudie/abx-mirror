import path from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../.env") });

const artifactsDir = path.resolve(__dirname, "../artifacts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  // Flat `.html` files (e.g. `/auction.html`) work on S3 without CloudFront rewrites.
  trailingSlash: false,
  transpilePackages: ["@alephium/web3-react", "@alephium/web3"],
  images: {
    unoptimized: true,
  },
  experimental: {
    // Allow webpack to process TypeScript files imported from outside this
    // project directory (the shared artifacts/ package at the monorepo root).
    externalDir: true,
  },
  webpack: (config, { defaultLoaders }) => {
    // pino (via @walletconnect/logger) optionally requires pino-pretty at build time.
    config.resolve.alias = {
      ...config.resolve.alias,
      "pino-pretty": false,
    };

    // Ensure SWC/Babel transpiles TypeScript in the artifacts directory.
    config.module.rules.push({
      test: /\.[jt]sx?$/,
      include: [artifactsDir],
      use: [defaultLoaders.babel],
    });
    return config;
  },
};

export default nextConfig;
