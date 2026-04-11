'use strict';

const { normalizeText, extractMainSegment, containsTerm } = require('./normalizer');

const CATEGORY_RULES = Object.freeze({
  pastas: {
    primary: {
      ravioles: 10,
      raviol: 10,
      fideos: 10,
      tallarines: 10,
      spaghetti: 10,
      pasta: 9,
      noquis: 10,
      gnocchi: 10,
    },
    secondary: {
      canelones: 8,
      sorrentinos: 8,
      lasagna: 7,
      lasana: 7,
    },
    penalties: [
      { pattern: /\b(salsa|salsas|aderezo|aderezos)\b[\s\w]{0,25}\b(para|de)\b[\s\w]{0,25}\b(ravioles|fideos|tallarines|spaghetti|pasta|noquis|gnocchi)\b/, points: 12 },
      { pattern: /\bqueso\b[\s\w]{0,20}\bpara\b[\s\w]{0,20}\bpasta\b/, points: 10 },
    ],
  },
  fiambres: {
    primary: {
      jamon: 10,
      paleta: 10,
      salame: 10,
      mortadela: 10,
      feteado: 10,
    },
    secondary: {
      fiambre: 8,
      fiambres: 8,
      jamonada: 7,
      fetas: 6,
    },
    penalties: [],
  },
  lacteos: {
    primary: {
      leche: 10,
      queso: 10,
      yogur: 10,
      yogurt: 10,
      crema: 10,
      manteca: 10,
    },
    secondary: {
      lacteo: 7,
      lacteos: 7,
      cremoso: 7,
      mozzarella: 8,
      muzzarella: 8,
      rallado: 5,
    },
    penalties: [],
  },
  aderezos: {
    primary: {
      mayonesa: 10,
      ketchup: 10,
      mostaza: 10,
      salsa: 10,
    },
    secondary: {
      aderezo: 8,
      aderezos: 8,
      barbacoa: 7,
      bbq: 7,
      chimichurri: 7,
    },
    penalties: [],
  },
});

const RULE_CATEGORY_ORDER = Object.freeze(Object.keys(CATEGORY_RULES));
const DEFAULT_RULE_OPTIONS = Object.freeze({
  scoreThreshold: 8,
  minDiff: 2.5,
  mainBoost: 1.85,
  secondaryMainBoost: 1.35,
});

function uniquePush(list, value) {
  if (!list.includes(value)) list.push(value);
}

function scoreCategory(category, rule, normalizedName, normalizedContext, mainSegment, options) {
  let score = 0;
  let mainHits = 0;
  const detectedMain = [];
  const detectedSecondary = [];

  for (const [termRaw, weightRaw] of Object.entries(rule.primary || {})) {
    const term = normalizeText(termRaw);
    const weight = Number(weightRaw) || 0;
    if (!term || weight <= 0) continue;

    const inMain = containsTerm(mainSegment, term);
    const inFull = inMain || containsTerm(normalizedContext, term);
    if (!inFull) continue;

    if (inMain) {
      score += weight * options.mainBoost;
      mainHits += 1;
    } else {
      score += weight;
    }
    uniquePush(detectedMain, term);
  }

  for (const [termRaw, weightRaw] of Object.entries(rule.secondary || {})) {
    const term = normalizeText(termRaw);
    const weight = Number(weightRaw) || 0;
    if (!term || weight <= 0) continue;

    const inMain = containsTerm(mainSegment, term);
    const inFull = inMain || containsTerm(normalizedContext, term);
    if (!inFull) continue;

    if (inMain) score += weight * options.secondaryMainBoost;
    else score += weight;
    uniquePush(detectedSecondary, term);
  }

  for (const penalty of rule.penalties || []) {
    try {
      if (penalty.pattern && penalty.pattern.test(normalizedContext)) {
        score -= Number(penalty.points || 0);
      }
    } catch (_) {
      // ignore malformed pattern
    }
  }

  if (score < 0) score = 0;
  return {
    category,
    score: Number(score.toFixed(2)),
    mainHits,
    detectedMain,
    detectedSecondary,
  };
}

function computeRulesConfidence(top, second, threshold) {
  const topScore = Number(top?.score || 0);
  const secondScore = Number(second?.score || 0);
  if (topScore <= 0) return 0;

  const margin = Math.max(0, topScore - secondScore);
  const normalizedTop = Math.min(1, topScore / Math.max(12, threshold + 8));
  const normalizedMargin = Math.min(1, margin / 8);
  const confidence = (normalizedTop * 0.65) + (normalizedMargin * 0.35);
  return Number(Math.max(0, Math.min(0.99, confidence)).toFixed(3));
}

function evaluateRules(input, opts = {}) {
  const options = { ...DEFAULT_RULE_OPTIONS, ...(opts || {}) };
  const rawText = String(input == null ? '' : input);
  const normalizedName = normalizeText(rawText);
  const mainSegment = extractMainSegment(normalizedName);
  const normalizedContext = normalizedName;

  const rows = RULE_CATEGORY_ORDER.map((category) =>
    scoreCategory(category, CATEGORY_RULES[category], normalizedName, normalizedContext, mainSegment, options)
  );

  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const top = sorted[0] || { category: 'otros', score: 0 };
  const second = sorted[1] || { category: 'otros', score: 0 };
  const scoreDiff = Number((Number(top.score || 0) - Number(second.score || 0)).toFixed(2));
  const accepted = Number(top.score || 0) >= options.scoreThreshold && scoreDiff >= options.minDiff;
  const confidence = computeRulesConfidence(top, second, options.scoreThreshold);

  const scores = {};
  const detectedWords = {};
  for (const row of rows) {
    scores[row.category] = row.score;
    const words = [...row.detectedMain, ...row.detectedSecondary];
    if (words.length) detectedWords[row.category] = Array.from(new Set(words));
  }

  return {
    categoria: accepted ? top.category : null,
    accepted,
    confianza: accepted ? confidence : Number((confidence * 0.75).toFixed(3)),
    scores,
    detectedWords,
    ranking: sorted.map((row) => ({
      categoria: row.category,
      score: row.score,
      mainHits: row.mainHits,
    })),
    debug: {
      normalizedText: normalizedName,
      mainSegment,
      topScore: Number(top.score || 0),
      secondScore: Number(second.score || 0),
      scoreDiff,
      thresholds: {
        scoreThreshold: options.scoreThreshold,
        minDiff: options.minDiff,
      },
    },
  };
}

module.exports = {
  CATEGORY_RULES,
  RULE_CATEGORY_ORDER,
  DEFAULT_RULE_OPTIONS,
  evaluateRules,
};

