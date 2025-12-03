#!/bin/bash

# Check if .env exists
if [ ! -f "backend/.env" ]; then
    echo "Error: backend/.env file not found!"
    exit 1
fi

echo "Generating k8s/secrets.yaml from backend/.env..."

# Create a temporary env file for K8s
cp backend/.env backend/.env.k8s

# Append/Override DATABASE_URL for K8s service
# We use sed to remove any existing DATABASE_URL and append the K8s one
# Mac sed requires empty string for -i
sed -i '' '/DATABASE_URL/d' backend/.env.k8s
echo 'DATABASE_URL=postgresql://postgres:postgres@postgres:5432/linkloom' >> backend/.env.k8s

# Create secret manifest using kubectl dry-run
kubectl create secret generic linkloom-secrets \
    --from-env-file=backend/.env.k8s \
    --dry-run=client \
    -o yaml > k8s/secrets.yaml

# Cleanup
rm backend/.env.k8s

echo "Done! Created k8s/secrets.yaml"
echo "You can now run: kubectl apply -f k8s/secrets.yaml"
