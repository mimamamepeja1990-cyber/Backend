'use strict';

const { normalizeText } = require('./normalizer');

function dot(a, b) {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) sum += (Number(a[i]) || 0) * (Number(b[i]) || 0);
  return sum;
}

function magnitude(v) {
  let sum = 0;
  for (let i = 0; i < v.length; i += 1) {
    const n = Number(v[i]) || 0;
    sum += n * n;
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(vec1, vec2) {
  if (!Array.isArray(vec1) || !Array.isArray(vec2) || !vec1.length || !vec2.length) return 0;
  const denom = magnitude(vec1) * magnitude(vec2);
  if (!denom) return 0;
  return Number((dot(vec1, vec2) / denom).toFixed(6));
}

class EmbeddingsService {
  constructor({
    apiKey = process.env.OPENAI_API_KEY || '',
    model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    endpoint = process.env.OPENAI_EMBEDDINGS_ENDPOINT || 'https://api.openai.com/v1/embeddings',
    timeoutMs = Number(process.env.EMBEDDINGS_TIMEOUT_MS || 12000),
    maxCache = Number(process.env.EMBEDDINGS_CACHE_MAX || 5000),
  } = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.model = String(model || 'text-embedding-3-small').trim();
    this.endpoint = String(endpoint || 'https://api.openai.com/v1/embeddings').trim();
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 1000 ? timeoutMs : 12000;
    this.maxCache = Number.isFinite(maxCache) && maxCache > 100 ? Math.floor(maxCache) : 5000;
    this.cache = new Map();
    this.inflight = new Map();
  }

  hasProvider() {
    return !!this.apiKey;
  }

  _remember(key, vector) {
    if (!key || !Array.isArray(vector)) return;
    this.cache.set(key, vector);
    if (this.cache.size <= this.maxCache) return;
    const oldest = this.cache.keys().next();
    if (!oldest.done) this.cache.delete(oldest.value);
  }

  async getEmbedding(text) {
    const normalized = normalizeText(text);
    if (!normalized) return null;
    if (this.cache.has(normalized)) return this.cache.get(normalized);
    if (this.inflight.has(normalized)) return this.inflight.get(normalized);

    if (!this.hasProvider()) return null;

    const promise = this._fetchEmbedding(normalized)
      .then((vector) => {
        if (Array.isArray(vector) && vector.length) this._remember(normalized, vector);
        return vector;
      })
      .finally(() => {
        this.inflight.delete(normalized);
      });

    this.inflight.set(normalized, promise);
    return promise;
  }

  async _fetchEmbedding(text) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input: text,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`embeddings_http_${resp.status}:${body.slice(0, 180)}`);
      }

      const json = await resp.json();
      const vector = json?.data?.[0]?.embedding;
      if (!Array.isArray(vector) || !vector.length) {
        throw new Error('embeddings_empty_vector');
      }
      return vector.map((n) => Number(n) || 0);
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = {
  EmbeddingsService,
  cosineSimilarity,
};

