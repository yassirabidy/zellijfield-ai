import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    // Vendored upstream workspaces and the Electron/Vite desktop app keep their own conventions.
    ignores: [
      'node_modules/**', '.next/**', 'dist/**', 'release/**', 'out/**', 'build/**',
      'packages/**', 'electron/**', 'src/**', 'scripts/**', 'afterPack.js', 'vite.config.mjs',
      'data/**', 'models/**', '.e2e-data/**', 'playwright-report/**', 'test-results/**',
      'next-env.d.ts', 'tests/*.test.js', 'tests/fixtures/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Generated media are served from our own API with Range support; next/image adds nothing.
      '@next/next/no-img-element': 'off',
    },
  },
];

export default config;
