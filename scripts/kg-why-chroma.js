#!/usr/bin/env node
// kg-why-chroma.js
//
// Live Phase B bridge for /hive:why. Invoked from hive/lib/kg_why.py when
// running outside --strict mode and the ChromaDB sidecar is available.
//
// Usage:
//   node scripts/kg-why-chroma.js <topic> [topK]
//
// Output (stdout, one JSON document):
//   {
//     "available": <bool>,
//     "results": [
//       { "id": ..., "document": ..., "distance": ..., "metadata": {...} },
//       ...
//     ]
//   }
//
// Exits 0 even when the sidecar is unavailable — Python caller treats
// available=false as the documented degraded path and continues with
// Phase A results only.

const path = require('path');
const wrapper = require(path.join(__dirname, '..', 'hive', 'lib', 'chromadb-wrapper.js'));

async function main() {
  const topic = process.argv[2];
  const topK = process.argv[3] ? Number.parseInt(process.argv[3], 10) : 10;

  if (!topic) {
    process.stderr.write('Usage: kg-why-chroma.js <topic> [topK]\n');
    process.exit(2);
  }

  const available = await wrapper.isAvailable();
  if (!available) {
    process.stdout.write(JSON.stringify({ available: false, results: [] }));
    process.stdout.write('\n');
    return;
  }

  const results = await wrapper.query('decisions', topic, Number.isFinite(topK) ? topK : 10);
  process.stdout.write(JSON.stringify({ available: true, results }));
  process.stdout.write('\n');
}

main().catch((err) => {
  // Match wrapper's silent-degradation contract — never crash the caller.
  process.stderr.write(`[kg-why-chroma] error: ${err && err.message ? err.message : String(err)}\n`);
  process.stdout.write(JSON.stringify({ available: false, results: [] }));
  process.stdout.write('\n');
});
