import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { playwrightStubs } from './src/vite-plugin/index.ts'

export default defineConfig({
  // Exercise optional npm-package interception in the integration suite.
  plugins: [react(), playwrightStubs({ includeNodeModules: true })],
  build: {
    rollupOptions: {
      input: path.resolve(__dirname, 'playwright/gallery/index.html'),
    },
  },
  resolve: {
    alias: {
      '@demo': path.resolve(__dirname, 'src/demo'),
    },
  },
})
