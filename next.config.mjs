import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['studio', 'ai-agent', 'workflow-builder', 'design-agent'],
  // Self-contained server for the Docker image (docker/studio/Dockerfile).
  output: 'standalone',
  outputFileTracingRoot: root,
};

export default nextConfig;
