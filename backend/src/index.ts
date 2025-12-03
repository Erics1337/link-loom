import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';

dotenv.config();

const server = Fastify({
    logger: true
});

import { syncRoutes } from './routes/sync';
import { organizeRoutes } from './routes/organize';
import { statusRoutes } from './routes/status';

server.register(cors, {
    origin: '*' // Allow all for now, lock down later
});

server.register(syncRoutes);
server.register(organizeRoutes);
server.register(statusRoutes);

server.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
});

server.get('/', async (request, reply) => {
    return { message: 'link-loom API is running', endpoints: ['/sync', '/organize', '/status', '/health'] };
});

const start = async () => {
    try {
        const port = parseInt(process.env.PORT || '3000');
        await server.listen({ port, host: '0.0.0.0' });
        console.log(`Server listening on port ${port}`);
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

start();
