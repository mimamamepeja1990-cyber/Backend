# Autocategorizador Híbrido (Node.js)

## Módulos
- `normalizer.js`: normalización y utilidades de texto.
- `rulesEngine.js`: clasificación por reglas con scoring y thresholds.
- `embeddingsService.js`: embeddings + similitud coseno + cache + control de concurrencia.
- `classifier.js`: orquestador híbrido (`reglas -> embeddings -> ia`) + memoria de ejemplos.
- `examples.memory.json`: memoria inicial de ejemplos de negocio.
- `tests.js`: pruebas rápidas con casos reales.

## Uso básico
```js
const { clasificarProducto } = require('../product-autocategorizer');

const r = await clasificarProducto('ravioles de jamon y queso');
// { categoria, confianza, metodo, debug }
```

## Aprendizaje por corrección
```js
const { getDefaultClassifier } = require('../product-autocategorizer');
const classifier = getDefaultClassifier();

await classifier.registrarCorreccion('mortadela premium', 'fiambres');
```

## Variables de entorno opcionales
- `OPENAI_API_KEY`
- `OPENAI_EMBEDDING_MODEL` (default: `text-embedding-3-small`)
- `OPENAI_CLASSIFIER_MODEL` (default: `gpt-4.1-mini`)
- `AUTOCAT_EXAMPLES_FILE` (ruta de memoria JSON)
- `AUTOCAT_EMBEDDINGS_THRESHOLD` (default: `0.85`)

## Ejecutar tests
```bash
node backend/scripts/autocategorizer/tests.js
```

