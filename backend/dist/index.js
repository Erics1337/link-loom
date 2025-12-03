"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const server = (0, fastify_1.default)({
    logger: true
});
const sync_1 = require("./routes/sync");
const organize_1 = require("./routes/organize");
const status_1 = require("./routes/status");
server.register(cors_1.default, {
    origin: '*' // Allow all for now, lock down later
});
server.register(sync_1.syncRoutes);
server.register(organize_1.organizeRoutes);
server.register(status_1.statusRoutes);
server.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
});
server.get('/', async (request, reply) => {
    return { message: 'LinkLoom API is running', endpoints: ['/sync', '/organize', '/status', '/health'] };
});
const start = async () => {
    try {
        const port = parseInt(process.env.PORT || '3000');
        await server.listen({ port, host: '0.0.0.0' });
        console.log(`Server listening on port ${port}`);
    }
    catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};
start();
