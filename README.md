# link-loom 🕸️

link-loom is an AI-powered Chrome extension that organizes your messy bookmarks into a clean, structured hierarchy. It uses vector embeddings and clustering to automatically categorize your links.

## Features
- **AI Categorization**: Automatically groups bookmarks using semantic similarity.
- **Smart Structure**: Generates a proposed folder structure based on your content.
- **Duplicate Detection**: Identifies and helps remove duplicate bookmarks.
- **Broken Link Checker**: Finds dead links (404s, etc.).
- **Free vs Premium**: Free plan limits sorting to 500 bookmarks; Premium unlocks unlimited sorting.

## Tech Stack
- **Frontend**: Chrome Extension (Vanilla JS, HTML, CSS)
- **Backend**: Node.js, Fastify, TypeScript
- **Database**: PostgreSQL with `pgvector` extension
- **Queue**: BullMQ with Redis
- **AI**: OpenAI Embeddings (or compatible API)
- **Infrastructure**: Kubernetes, Docker

## Prerequisites
- Node.js (v18+)
- Docker & Kubernetes (OrbStack, Docker Desktop, or Minikube)
- OpenAI API Key

---

## 🚀 Development Workflows

### Option 1: Local Development (Recommended for Backend Logic)
Use this method to iterate quickly on the backend code without rebuilding Docker images.

1.  **Start Infrastructure (DB & Redis)**
    Run the database and Redis using Docker Compose. This keeps your state isolated but accessible.
    ```bash
    cd backend
    docker-compose up -d
    ```

2.  **Configure Environment**
    Ensure your `backend/.env` file points to localhost:
    ```env
    DATABASE_URL=postgres://postgres:postgres@localhost:5432/link-loom
    REDIS_HOST=localhost
    REDIS_PORT=6379
    OPENAI_API_KEY=your_key_here
    PORT=3000
    ```

3.  **Run Backend Locally**
    Start the backend in watch mode. It will auto-reload when you save files.
    ```bash
    cd backend
    npm install
    npm run dev
    ```
    The server will start at `http://localhost:3000`.

4.  **Load Extension**
    - Open Chrome and go to `chrome://extensions`.
    - Enable "Developer mode".
    - Click "Load unpacked" and select the `chrome-extension` folder.

### Option 2: Kubernetes Development (Recommended for Deployment Testing)
Use this method to verify the full deployment stack.

1.  **Build Backend Image**
    If you change backend code, you must rebuild the image.
    ```bash
    # From project root
    docker build -t link-loom-backend:latest ./backend
    ```

2.  **Deploy/Restart**
    Apply the K8s manifests or restart the deployment to pick up the new image.
    ```bash
    # Apply all configs
    kubectl apply -f k8s/

    # OR just restart if configs haven't changed
    kubectl rollout restart deployment backend
    ```

3.  **Port Forwarding (if not using LoadBalancer)**
    If your K8s service isn't exposed via localhost automatically (OrbStack usually does this for LoadBalancers), you might need to port-forward:
    ```bash
    kubectl port-forward svc/backend 3000:3000
    ```

## 📂 Project Structure

- `chrome-extension/`: Frontend code (popup, background script, content scripts).
- `backend/`: API server and worker logic.
    - `src/services/`: Core business logic.
    - `src/workers/`: Background job processors (clustering, enrichment).
    - `src/db/`: Database schema and client.
- `k8s/`: Kubernetes manifests.

## Troubleshooting

### "Sync failed: Internal Server Error"
This usually means the backend encountered an error. Check the backend logs:
- **Local**: Check your terminal running `npm run dev`.
- **Kubernetes**: Run `kubectl logs -l app=backend`.

### Database Schema Updates
If you change `schema.sql`, you might need to reset the database:
1.  Stop the backend.
2.  Drop the tables or volume (for dev).
3.  Restart.
