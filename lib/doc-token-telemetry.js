// Token-counting probe for planning artifact writes. Non-blocking on failure.
'use strict';

const fs = require('fs');
const path = require('path');

// Try @anthropic-ai/tokenizer; fall back to char_count/4 approximation.
let getTokenCount;
try {
  const { countTokens } = require('@anthropic-ai/tokenizer');
  getTokenCount = (text) => countTokens(text);
} catch (_) {
  getTokenCount = null;
}

const TELEMETRY_DIR = 'state/telemetry';
const TELEMETRY_FILE = path.join(TELEMETRY_DIR, 'doc-tokens.jsonl');

/**
 * Record a token-count telemetry entry for a planning artifact write.
 * Non-blocking: on any failure, logs a warning and returns without throwing.
 * @param {object} opts
 * @param {string} opts.docPath  - path to the written document
 * @param {string} opts.epicId   - epic identifier
 * @param {string} opts.docType  - e.g. 'design-discussion', 'structured-outline'
 * @param {string} opts.format   - e.g. 'md', 'html-embedded'
 * @returns {Promise<void>}
 */
async function recordDocWrite({ docPath, epicId, docType, format }) {
  try {
    const text = fs.readFileSync(path.resolve(docPath), 'utf8');
    const bytes = Buffer.byteLength(text, 'utf8');
    const charCount = text.length;

    let tokenCount;
    let note;
    if (getTokenCount) {
      tokenCount = getTokenCount(text);
    } else {
      tokenCount = Math.round(charCount / 4);
      note = 'approximated: char_count/4 (@anthropic-ai/tokenizer unavailable)';
    }

    if (!fs.existsSync(TELEMETRY_DIR)) {
      fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
    }

    const record = {
      ts: new Date().toISOString(),
      epic_id: epicId,
      doc_type: docType,
      format,
      token_count: tokenCount,
      char_count: charCount,
      bytes,
      ...(note ? { note } : {}),
    };

    fs.appendFileSync(TELEMETRY_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    process.stderr.write(`warning: doc-token-telemetry failed for ${docPath}: ${err.message}\n`);
  }
}

module.exports = { recordDocWrite };

// CLI entry: node lib/doc-token-telemetry.js <docPath> <epicId> <docType> <format>
if (require.main === module) {
  const [, , docPath, epicId, docType, format] = process.argv;
  if (!docPath || !epicId || !docType || !format) {
    process.stderr.write('Usage: doc-token-telemetry <docPath> <epicId> <docType> <format>\n');
    process.exit(1);
  }
  recordDocWrite({ docPath, epicId, docType, format })
    .then(() => process.exit(0))
    .catch(err => {
      process.stderr.write(`warning: telemetry failed: ${err.message}\n`);
      process.exit(0);
    });
}
