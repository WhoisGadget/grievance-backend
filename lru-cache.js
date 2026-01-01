// COST-FREE PERFORMANCE OPTIMIZATION: LRU Cache using built-in Map()
// Least Recently Used cache implementation for high-performance AI response caching

class LRUCache {
  constructor(maxSize = 100, defaultTTL = 300000) { // 5 minutes default TTL
    this.cache = new Map();
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;

    // Automatic cleanup of expired entries
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // Clean up every minute
  }

  get(key) {
    if (!this.cache.has(key)) {
      return null;
    }

    const item = this.cache.get(key);

    // Check if expired
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }

  set(key, value, ttl = this.defaultTTL) {
    const expiry = Date.now() + ttl;

    // If key exists, remove it first
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // If at max capacity, remove least recently used
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    // Add new item
    this.cache.set(key, { value, expiry });
  }

  has(key) {
    if (!this.cache.has(key)) {
      return false;
    }

    const item = this.cache.get(key);

    // Check if expired
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    // Clean expired entries before returning size
    this.cleanup();
    return this.cache.size;
  }

  cleanup() {
    const now = Date.now();
    for (const [key, item] of this.cache) {
      if (now > item.expiry) {
        this.cache.delete(key);
      }
    }
  }

  getStats() {
    this.cleanup(); // Clean before stats

    let totalHits = 0;
    let expiredCount = 0;
    const now = Date.now();

    for (const [key, item] of this.cache) {
      if (now > item.expiry) {
        expiredCount++;
      } else {
        totalHits++;
      }
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: totalHits > 0 ? (totalHits / (totalHits + expiredCount)) * 100 : 0,
      expiredEntries: expiredCount,
      utilizationPercent: (this.cache.size / this.maxSize) * 100
    };
  }

  // Destroy cleanup interval
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Semantic cache for AI responses with similarity matching
class SemanticCache {
  constructor(maxSize = 200, defaultTTL = 1800000) { // 30 minutes default
    this.cache = new LRUCache(maxSize, defaultTTL);
    this.embeddings = new Map();
  }

  // Generate cache key from query and similarity threshold
  generateKey(query, similarityThreshold = 0.85) {
    // Simple hash of query for cache key
    let hash = 0;
    for (let i = 0; i < query.length; i++) {
      const char = query.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `query_${Math.abs(hash)}_${similarityThreshold}`;
  }

  async findSimilarResponse(queryEmbedding, similarityThreshold = 0.85) {
    // Search through cached embeddings for similar queries
    for (const [cachedKey, cachedEmbedding] of this.embeddings) {
      if (cachedEmbedding && cachedEmbedding.length === queryEmbedding.length) {
        const similarity = this.cosineSimilarity(queryEmbedding, cachedEmbedding);

        if (similarity >= similarityThreshold) {
          const cachedResponse = this.cache.get(cachedKey);
          if (cachedResponse) {
            return {
              response: cachedResponse,
              similarity: similarity,
              cached: true
            };
          }
        }
      }
    }

    return null;
  }

  async setWithEmbedding(key, response, embedding, ttl = 1800000) {
    this.cache.set(key, response, ttl);
    this.embeddings.set(key, embedding);
  }

  cosineSimilarity(vecA, vecB) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  getStats() {
    return {
      ...this.cache.getStats(),
      embeddingsCount: this.embeddings.size,
      cacheType: 'semantic'
    };
  }

  destroy() {
    this.cache.destroy();
    this.embeddings.clear();
  }
}

// Global cache instances for the application
const aiResponseCache = new LRUCache(500, 1800000);      // AI responses: 30 min TTL
const embeddingCache = new LRUCache(200, 3600000);       // Embeddings: 1 hour TTL
const similarityCache = new LRUCache(1000, 900000);      // Similarities: 15 min TTL
const semanticCache = new SemanticCache(200, 1800000);   // Semantic cache: 30 min TTL

// Performance tracking
let cacheHits = 0;
let cacheMisses = 0;

function trackCacheAccess(hit = true) {
  if (hit) {
    cacheHits++;
  } else {
    cacheMisses++;
  }
}

function getCachePerformance() {
  const total = cacheHits + cacheMisses;
  return {
    hits: cacheHits,
    misses: cacheMisses,
    total: total,
    hitRate: total > 0 ? (cacheHits / total) * 100 : 0,
    aiResponseCache: aiResponseCache.getStats(),
    embeddingCache: embeddingCache.getStats(),
    similarityCache: similarityCache.getStats(),
    semanticCache: semanticCache.getStats()
  };
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down LRU caches...');
  aiResponseCache.destroy();
  embeddingCache.destroy();
  similarityCache.destroy();
  semanticCache.destroy();
  console.log('LRU caches shut down successfully');
});

module.exports = {
  LRUCache,
  SemanticCache,
  aiResponseCache,
  embeddingCache,
  similarityCache,
  semanticCache,
  trackCacheAccess,
  getCachePerformance
};