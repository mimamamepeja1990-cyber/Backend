'use strict';

const {
  HybridProductClassifier,
  clasificarProducto,
  getDefaultClassifier,
  CATEGORIES,
} = require('./autocategorizer/classifier');
const { cosineSimilarity } = require('./autocategorizer/embeddingsService');

module.exports = {
  HybridProductClassifier,
  clasificarProducto,
  getDefaultClassifier,
  CATEGORIES,
  cosineSimilarity,
};

if (require.main === module) {
  const demoInputs = [
    'ravioles de jyq',
    'jamon cocido',
    'queso cremoso',
    'mayonesa hellmanns',
    'salsa de tomate',
    'queso rallado para pasta',
    'salsa para ravioles',
    'ravioles de pollo',
  ];

  (async () => {
    const classifier = getDefaultClassifier();
    const output = [];
    for (const input of demoInputs) {
      // eslint-disable-next-line no-await-in-loop
      const result = await classifier.clasificarProducto(input);
      output.push({
        input,
        categoria: result.categoria,
        confianza: result.confianza,
        metodo: result.metodo,
      });
    }
    // eslint-disable-next-line no-console
    console.table(output);
  })().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('autocategorizer demo failed:', err);
    process.exitCode = 1;
  });
}

