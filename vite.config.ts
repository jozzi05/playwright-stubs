import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { playwrightStubs } from './src/vite-plugin/index.ts'

export default defineConfig({
  plugins: [react(), playwrightStubs()],
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
