'use strict';

const fs = require('fs/promises');
const path = require('path');
const { normalizeText } = require('./normalizer');
const { evaluateRules } = require('./rulesEngine');
const { EmbeddingsService, cosineSimilarity } = require('./embeddingsService');

const CATEGORIES = Object.freeze(['pastas', 'fiambres', 'lacteos', 'aderezos', 'otros']);
const DEFAULT_AI_MODEL = process.env.OPENAI_CLASSIFIER_MODEL || 'gpt-4.1-mini';
const DEFAULT_AI_ENDPOINT = process.env.OPENAI_CHAT_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
const DEFAULT_EXAMPLES_PATH = process.env.AUTOCAT_EXAMPLES_FILE
  ? path.resolve(process.env.AUTOCAT_EXAMPLES_FILE)
  : path.join(__dirname, 'examples.memory.json');

function clamp01(value) {
  const n = Number(value) || 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

class ExampleStore {
  constructor(filePath = DEFAULT_EXAMPLES_PATH) {
    this.filePath = path.resolve(filePath);
    this.writeQueue = Promise.resolve();
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((row) => row && typeof row === 'object');
    } catch (err) {
      if (err && err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async save(rows) {
    const normalizedRows = Array.isArray(rows) ? rows : [];
    const dir = path.dirname(this.filePath);
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(normalizedRows, null, 2), 'utf-8');
    });
    return this.writeQueue;
  }

  async addOrUpdateExample({ texto, categoria, embedding = null, source = 'manual' }) {
    const textNorm = normalizeText(texto);
    const categoryNorm = normalizeText(categoria);
    if (!textNorm) throw new Error('texto_requerido');
    if (!CATEGORIES.includes(categoryNorm)) throw new Error('categoria_invalida');

    const rows = await this.load();
    const idx = rows.findIndex((row) => normalizeText(row?.texto) === textNorm);
    const payload = {
      texto: textNorm,
      categoria: categoryNorm,
      embedding: Array.isArray(embedding) ? embedding : (rows[idx]?.embedding || null),
      source: String(source || 'manual'),
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) rows[idx] = payload;
    else rows.push(payload);
    await this.save(rows);
    return payload;
  }
}

async function classifyWithIA({
  originalText,
  normalizedText,
  apiKey = process.env.OPENAI_API_KEY || '',
  model = DEFAULT_AI_MODEL,
  endpoint = DEFAULT_AI_ENDPOINT,
  timeoutMs = Number(process.env.AI_CLASSIFIER_TIMEOUT_MS || 12000),
}) {
  const key = String(apiKey || '').trim();
  if (!key) return null;

  const categoriesText = CATEGORIES.filter((c) => c !== 'otros').join(', ');
  const systemPrompt = [
    'Eres un clasificador estricto de productos para ecommerce.',
    'Solo puedes responder una categoria exacta del set permitido.',
    `Set permitido: ${categoriesText}, otros`,
    'Si no estas seguro, responde: otros',
    'No agregues explicaciones.',
  ].join(' ');

  const userPrompt = [
    `Producto: "${originalText}"`,
    `Texto normalizado: "${normalizedText}"`,
    'Clasifica este producto. Responde solo la categoria.',
  ].join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const payload = await resp.json().catch(() => null);
    const answerRaw = payload?.choices?.[0]?.message?.content || '';
    const answer = normalizeText(answerRaw);
    if (!CATEGORIES.includes(answer)) return null;
    return answer;
  } finally {
    clearTimeout(timeout);
  }
}

class HybridProductClassifier {
  constructor({
    examplesPath = DEFAULT_EXAMPLES_PATH,
    embeddingsService = null,
    useEmbeddings = true,
    useIAFallback = true,
    embeddingsThreshold = Number(process.env.AUTOCAT_EMBEDDINGS_THRESHOLD || 0.85),
    topK = Number(process.env.AUTOCAT_EMBEDDINGS_TOP_K || 5),
    rulesOptions = {},
  } = {}) {
    this.exampleStore = new ExampleStore(examplesPath);
    this.embeddings = embeddingsService || new EmbeddingsService();
    this.useEmbeddings = !!useEmbeddings;
    this.useIAFallback = !!useIAFallback;
    this.embeddingsThreshold = Number.isFinite(embeddingsThreshold) ? embeddingsThreshold : 0.85;
    this.topK = Number.isFinite(topK) ? Math.max(1, Math.floor(topK)) : 5;
    this.rulesOptions = { ...(rulesOptions || {}) };
  }

  async _ensureExampleEmbeddings(rows) {
    if (!this.useEmbeddings || !this.embeddings.hasProvider()) return rows;
    if (!Array.isArray(rows) || !rows.length) return rows;

    let changed = false;
    const nextRows = [];
    for (const row of rows) {
      const current = { ...(row || {}) };
      if (!Array.isArray(current.embedding) || !current.embedding.length) {
        const embedding = await this.embeddings.getEmbedding(current.texto || '');
        if (Array.isArray(embedding) && embedding.length) {
          current.embedding = embedding;
          changed = true;
        }
      }
      nextRows.push(current);
    }
    if (changed) await this.exampleStore.save(nextRows);
    return nextRows;
  }

  async _classifyWithEmbeddings(normalizedText) {
    if (!this.useEmbeddings || !this.embeddings.hasProvider()) return null;
    if (!normalizedText) return null;

    const queryEmbedding = await this.embeddings.getEmbedding(normalizedText);
    if (!Array.isArray(queryEmbedding) || !queryEmbedding.length) return null;

    let examples = await this.exampleStore.load();
    examples = await this._ensureExampleEmbeddings(examples);
    const candidates = examples
      .filter((row) => CATEGORIES.includes(normalizeText(row?.categoria)) && Array.isArray(row?.embedding) && row.embedding.length)
      .map((row) => {
        const sim = cosineSimilarity(queryEmbedding, row.embedding);
        return {
          texto: row.texto,
          categoria: normalizeText(row.categoria),
          similitud: sim,
          source: row.source || 'memory',
        };
      })
      .sort((a, b) => b.similitud - a.similitud);

    if (!candidates.length) return null;
    const top = candidates[0];
    const accepted = Number(top.similitud || 0) >= this.embeddingsThreshold;
    return {
      accepted,
      top,
      topSimilarities: candidates.slice(0, this.topK),
    };
  }

  async clasificarProducto(input) {
    const raw = String(input == null ? '' : input).trim();
    const normalizedText = normalizeText(raw);
    const rules = evaluateRules(normalizedText, this.rulesOptions);

    const debug = {
      normalizedText,
      reglas: {
        accepted: rules.accepted,
        categoria: rules.categoria,
        confianza: rules.confianza,
        scores: rules.scores,
        ranking: rules.ranking,
        detectedWords: rules.detectedWords,
        meta: rules.debug,
      },
      embeddings: null,
      ia: null,
    };

    if (rules.accepted && rules.categoria) {
      return {
        categoria: rules.categoria,
        confianza: clamp01(rules.confianza),
        metodo: 'reglas',
        debug,
      };
    }

    const embeddingResult = await this._classifyWithEmbeddings(normalizedText);
    if (embeddingResult) {
      debug.embeddings = {
        accepted: embeddingResult.accepted,
        threshold: this.embeddingsThreshold,
        top: embeddingResult.top,
        topSimilarities: embeddingResult.topSimilarities,
      };
      if (embeddingResult.accepted && embeddingResult.top?.categoria) {
        return {
          categoria: embeddingResult.top.categoria,
          confianza: clamp01(embeddingResult.top.similitud),
          metodo: 'embeddings',
          debug,
        };
      }
    }

    if (this.useIAFallback) {
      const aiCategory = await classifyWithIA({
        originalText: raw,
        normalizedText,
      });
      debug.ia = {
        used: true,
        category: aiCategory,
      };
      if (aiCategory && CATEGORIES.includes(aiCategory)) {
        return {
          categoria: aiCategory,
          confianza: 0.7,
          metodo: 'ia',
          debug,
        };
      }
    }

    return {
      categoria: rules.ranking?.[0]?.categoria || 'otros',
      confianza: clamp01(rules.confianza || 0.45),
      metodo: 'reglas',
      debug,
    };
  }

  async agregarEjemploManual(texto, categoria, { source = 'manual' } = {}) {
    const normalizedText = normalizeText(texto);
    const normalizedCategory = normalizeText(categoria);
    if (!normalizedText) throw new Error('texto_requerido');
    if (!CATEGORIES.includes(normalizedCategory)) throw new Error('categoria_invalida');

    const embedding = this.useEmbeddings && this.embeddings.hasProvider()
      ? await this.embeddings.getEmbedding(normalizedText)
      : null;

    return this.exampleStore.addOrUpdateExample({
      texto: normalizedText,
      categoria: normalizedCategory,
      embedding,
      source,
    });
  }

  async registrarCorreccion(texto, categoria) {
    return this.agregarEjemploManual(texto, categoria, { source: 'correccion_usuario' });
  }
}

let defaultClassifier = null;
function getDefaultClassifier() {
  if (!defaultClassifier) defaultClassifier = new HybridProductClassifier();
  return defaultClassifier;
}

async function clasificarProducto(input) {
  return getDefaultClassifier().clasificarProducto(input);
}

module.exports = {
  CATEGORIES,
  ExampleStore,
  HybridProductClassifier,
  clasificarProducto,
  getDefaultClassifier,
};

