export class KMeans {
    constructor(k, maxIterations = 20) {
        this.k = k;
        this.maxIterations = maxIterations;
        this.centroids = [];
        this.clusters = [];
    }

    /**
     * Runs K-Means clustering on the provided vectors.
     * @param {number[][]} vectors - Array of embedding vectors.
     * @returns {Object} - { clusters: number[][], centroids: number[][] }
     * clusters is an array of arrays, where each inner array contains indices of vectors in that cluster.
     */
    run(vectors) {
        if (vectors.length === 0) return { clusters: [], centroids: [] };
        if (vectors.length <= this.k) {
            // Fewer points than clusters, each point is a cluster
            return {
                clusters: vectors.map((_, i) => [i]),
                centroids: vectors
            };
        }

        // 1. Initialize Centroids (K-Means++ style)
        this.centroids = this._initializeCentroids(vectors);

        for (let i = 0; i < this.maxIterations; i++) {
            // 2. Assign points to nearest centroid
            const newClusters = Array.from({ length: this.k }, () => []);

            vectors.forEach((vector, index) => {
                const centroidIndex = this._findNearestCentroid(vector);
                newClusters[centroidIndex].push(index);
            });

            // 3. Update Centroids
            const newCentroids = newClusters.map((clusterIndices) => {
                if (clusterIndices.length === 0) {
                    // Handle empty cluster: Re-initialize to a random point (or keep old)
                    // For simplicity, we pick a random point from the dataset
                    return vectors[Math.floor(Math.random() * vectors.length)];
                }
                return this._calculateMean(clusterIndices.map(idx => vectors[idx]));
            });

            // Check convergence (simple check: if centroids didn't change much)
            if (this._hasConverged(this.centroids, newCentroids)) {
                this.clusters = newClusters;
                this.centroids = newCentroids;
                break;
            }

            this.clusters = newClusters;
            this.centroids = newCentroids;
        }

        return { clusters: this.clusters, centroids: this.centroids };
    }

    _initializeCentroids(vectors) {
        // K-Means++ Initialization
        const centroids = [vectors[Math.floor(Math.random() * vectors.length)]];

        while (centroids.length < this.k) {
            const distances = vectors.map(vec => {
                return Math.min(...centroids.map(c => 1 - this._cosineSimilarity(vec, c)));
            });

            // Weighted random selection based on distance^2
            const sum = distances.reduce((a, b) => a + b, 0);
            let r = Math.random() * sum;

            let nextCentroidIndex = 0;
            for (let i = 0; i < distances.length; i++) {
                r -= distances[i];
                if (r <= 0) {
                    nextCentroidIndex = i;
                    break;
                }
            }
            centroids.push(vectors[nextCentroidIndex]);
        }
        return centroids;
    }

    _findNearestCentroid(vector) {
        let maxSim = -Infinity;
        let index = 0;
        this.centroids.forEach((centroid, i) => {
            const sim = this._cosineSimilarity(vector, centroid);
            if (sim > maxSim) {
                maxSim = sim;
                index = i;
            }
        });
        return index;
    }

    _calculateMean(vectors) {
        const dim = vectors[0].length;
        const mean = new Array(dim).fill(0);
        for (const vec of vectors) {
            for (let i = 0; i < dim; i++) {
                mean[i] += vec[i];
            }
        }
        // Normalize to keep it on the unit sphere (for cosine similarity)
        return this._normalize(mean);
    }

    _hasConverged(oldCentroids, newCentroids) {
        if (!oldCentroids.length) return false;
        const threshold = 0.0001;
        for (let i = 0; i < this.k; i++) {
            if (1 - this._cosineSimilarity(oldCentroids[i], newCentroids[i]) > threshold) {
                return false;
            }
        }
        return true;
    }

    _cosineSimilarity(a, b) {
        // Assumes vectors are normalized? If not, we should normalize.
        // OpenAI embeddings are usually normalized, but let's be safe or assume they are.
        // Dot product
        let dot = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
        }
        return dot; // If normalized, dot product IS cosine similarity
    }

    _normalize(vector) {
        const mag = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        return vector.map(val => val / (mag || 1));
    }
}
