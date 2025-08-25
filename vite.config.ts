import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true, // Allow external connections
    // WebRTC signaling via SSH tunnel
    proxy: {
      '/ws': {
        target: 'ws://localhost:8447',
        ws: true
      },
      '/metrics': {
        target: 'http://localhost:9090'
      }
    }
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    // Optimize for WebGL/WebGPU performance
    rollupOptions: {
      output: {
        manualChunks: {
          'webgl-renderer': ['./src/renderer/webgl2'],
          'webgpu-renderer': ['./src/renderer/webgpu'],
          'cpu-renderer': ['./src/renderer/cpu']
        }
      }
    }
  },
  optimizeDeps: {
    exclude: ['@webgpu/types']
  }
})