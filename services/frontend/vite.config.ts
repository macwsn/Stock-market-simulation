import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/stocks': 'http://localhost:8080',
      '/wallets': 'http://localhost:8080',
      '/log':     'http://localhost:8080',
      '/chaos':   'http://localhost:8080',
    },
  },
});
