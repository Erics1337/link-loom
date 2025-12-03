# Build Stage
FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production Stage
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src 
# Copy src because some workers/scripts might rely on ts-node or raw files if not fully compiled to single file, 
# but ideally we run from dist. 
# However, package.json scripts use 'ts-node-dev' for dev. 
# We need to ensure 'npm start' runs 'node dist/index.js'.

EXPOSE 3000

CMD ["npm", "start"]
