import { defineConfig } from 'vite';

export default defineConfig({
    root: '.',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            input: 'index.html'
        }
    },
    server: {
        port: 3000,
        proxy: {
            '/spada': {
                target: 'https://spada.upnyk.ac.id',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/spada/, ''),
                secure: false,
                cookieDomainRewrite: 'localhost'
            }
        }
    }
});
