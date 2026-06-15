import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

const getManifest = (mode: string) => {
    if (mode !== 'development') return manifest;

    return {
        ...manifest,
        externally_connectable: {
            ...manifest.externally_connectable,
            matches: [
                ...manifest.externally_connectable.matches,
                'http://localhost:3000/*',
                'http://127.0.0.1:3000/*',
            ],
        },
    };
};

export default defineConfig(({ mode }) => ({
    plugins: [
        react(),
        crx({ manifest: getManifest(mode) }),
    ],
    server: {
        port: 5173,
        strictPort: true,
        hmr: {
            port: 5173,
        },
        cors: true, // Fix CORS issues for extension
    },
}));
