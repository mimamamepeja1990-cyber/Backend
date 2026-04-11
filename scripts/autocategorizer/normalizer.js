'use strict';

const DEFAULT_STOPWORDS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los',
  'para', 'con', 'y', 'en', 'a', 'al',
  'x', 'por', 'tipo', 'sabor',
]);

const MAIN_SEGMENT_BREAKERS = Object.freeze([
  ' de ',
  ' con ',
  ' para ',
  ' sabor ',
  ' relleno ',
  ' rellena ',
  ' rellenos ',
  ' rellenas ',
  ' tipo ',
  ' estilo ',
]);

function normalizeText(value, { removeStopwords = false, stopwords = DEFAULT_STOPWORDS } = {}) {
  const raw = String(value == null ? '' : value).toLowerCase().trim();
  if (!raw) return '';

  let text = raw
    .replace(/\bjyq\b/g, 'jamon y queso')
    .replace(/\bj y q\b/g, 'jamon y queso')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text || !removeStopwords) return text;

  const filtered = text
    .split(' ')
    .filter((token) => token && !stopwords.has(token))
    .join(' ')
    .trim();
  return filtered || text;
}

function tokenize(normalizedText) {
  if (!normalizedText) return [];
  return String(normalizedText).split(' ').filter(Boolean);
}

function extractMainSegment(normalizedText) {
  if (!normalizedText) return '';
  const text = String(normalizedText);
  let cut = text.length;
  for (const breaker of MAIN_SEGMENT_BREAKERS) {
    const pos = text.indexOf(breaker);
    if (pos >= 0 && pos < cut) cut = pos;
  }
  const segment = (cut < text.length ? text.slice(0, cut) : text).trim();
  if (segment) return segment;
  return tokenize(text).slice(0, 4).join(' ');
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsTerm(text, term) {
  if (!text || !term) return false;
  const normalizedText = String(text);
  const normalizedTerm = String(term).trim();
  if (!normalizedTerm) return false;
  const re = new RegExp(`(?:^|\\s)${escapeRegex(normalizedTerm)}(?=\\s|$)`, 'i');
  return re.test(normalizedText);
}

module.exports = {
  DEFAULT_STOPWORDS,
  normalizeText,
  tokenize,
  extractMainSegment,
  containsTerm,
};

