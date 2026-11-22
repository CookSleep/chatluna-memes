import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    manifest: true,
    target: 'es2022',
    lib: {
      entry: fileURLToPath(new URL('./index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'client.js',
    },
    rollupOptions: {
      external: ['react', '@chatluna/ui-client/client'],
      output: { assetFileNames: 'client.[ext]', chunkFileNames: 'memes-[hash].js' },
    },
  },
})
