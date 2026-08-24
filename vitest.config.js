import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['@testing-library/jest-dom/vitest'],
      include: ['src/**/*.{test,spec}.{js,jsx}'],
      css: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        include: ['src/**/*.{js,jsx}'],
        exclude: [
          'src/**/*.{test,spec}.{js,jsx}',
          'src/main.jsx',
          'src/test/**',
        ],
      },
    },
  }),
);