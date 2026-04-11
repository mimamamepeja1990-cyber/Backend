'use strict';

const assert = require('assert/strict');
const path = require('path');
const fs = require('fs/promises');
const { HybridProductClassifier } = require('./classifier');

async function run() {
  const tmpExamplesPath = path.join(__dirname, 'examples.test.memory.json');
  await fs.writeFile(tmpExamplesPath, '[]', 'utf-8');

  const classifier = new HybridProductClassifier({
    examplesPath: tmpExamplesPath,
    useEmbeddings: false,
    useIAFallback: false,
  });

  const cases = [
    { input: 'ravioles de jyq', expected: 'pastas' },
    { input: 'jamon cocido', expected: 'fiambres' },
    { input: 'queso cremoso', expected: 'lacteos' },
    { input: 'mayonesa hellmanns', expected: 'aderezos' },
    { input: 'salsa de tomate', expected: 'aderezos' },
    { input: 'queso rallado para pasta', expected: 'lacteos' },
    { input: 'salsa para ravioles', expected: 'aderezos' },
    { input: 'ravioles de pollo', expected: 'pastas' },
  ];

  for (const testCase of cases) {
    // eslint-disable-next-line no-await-in-loop
    const result = await classifier.clasificarProducto(testCase.input);
    assert.equal(
      result.categoria,
      testCase.expected,
      `input="${testCase.input}" esperado=${testCase.expected} recibido=${result.categoria}`
    );
  }

  await classifier.registrarCorreccion('mortadela premium', 'fiambres');
  const learned = await classifier.clasificarProducto('mortadela premium');
  assert.equal(learned.categoria, 'fiambres');

  await fs.unlink(tmpExamplesPath).catch(() => null);
  // eslint-disable-next-line no-console
  console.log('OK autocategorizer tests passed');
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('autocategorizer tests failed:', err);
  process.exitCode = 1;
});

