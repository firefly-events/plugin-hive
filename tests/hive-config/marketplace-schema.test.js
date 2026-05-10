/**
 * Marketplace schema audit for .claude-plugin/marketplace.json.
 *
 * Run: node tests/hive-config/marketplace-schema.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const MARKETPLACE_PATH = path.join(REPO_ROOT, '.claude-plugin', 'marketplace.json');
const CANONICAL_SOURCE_URL = 'https://code.claude.com/docs/en/plugin-marketplaces';
const LAST_CHECKED = '2026-05-09';

const authorSchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    email: { type: 'string' },
  },
};

const githubSourceSchema = {
  type: 'object',
  required: ['source', 'repo'],
  additionalProperties: false,
  properties: {
    source: { const: 'github' },
    repo: { type: 'string' },
    ref: { type: 'string' },
    sha: { type: 'string', pattern: '^[0-9a-f]{40}$' },
  },
};

const urlSourceSchema = {
  type: 'object',
  required: ['source', 'url'],
  additionalProperties: false,
  properties: {
    source: { const: 'url' },
    url: { type: 'string' },
    ref: { type: 'string' },
    sha: { type: 'string', pattern: '^[0-9a-f]{40}$' },
  },
};

const gitSubdirSourceSchema = {
  type: 'object',
  required: ['source', 'url', 'path'],
  additionalProperties: false,
  properties: {
    source: { const: 'git-subdir' },
    url: { type: 'string' },
    path: { type: 'string' },
    ref: { type: 'string' },
    sha: { type: 'string', pattern: '^[0-9a-f]{40}$' },
  },
};

const npmSourceSchema = {
  type: 'object',
  required: ['source', 'package'],
  additionalProperties: false,
  properties: {
    source: { const: 'npm' },
    package: { type: 'string' },
    version: { type: 'string' },
    registry: { type: 'string' },
  },
};

const sourceSchema = {
  oneOf: [
    {
      type: 'string',
      pattern: '^\\./',
    },
    githubSourceSchema,
    urlSourceSchema,
    gitSubdirSourceSchema,
    npmSourceSchema,
  ],
};

const pluginSchema = {
  type: 'object',
  required: ['name', 'source'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    source: sourceSchema,
    description: { type: 'string' },
    version: { type: 'string' },
    author: authorSchema,
    homepage: { type: 'string' },
    repository: { type: 'string' },
    license: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
    category: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    strict: { type: 'boolean' },
    skills: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
    commands: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
    agents: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
    hooks: { oneOf: [{ type: 'string' }, { type: 'object' }] },
    mcpServers: { oneOf: [{ type: 'string' }, { type: 'object' }] },
    lspServers: { oneOf: [{ type: 'string' }, { type: 'object' }] },
  },
};

const metadataSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pluginRoot: { type: 'string' },
    description: { type: 'string' },
    version: { type: 'string' },
  },
};

const marketplaceSchema = {
  type: 'object',
  required: ['name', 'owner', 'plugins'],
  additionalProperties: false,
  properties: {
    $schema: { type: 'string' },
    name: { type: 'string' },
    owner: authorSchema,
    plugins: { type: 'array', items: pluginSchema },
    description: { type: 'string' },
    version: { type: 'string' },
    metadata: metadataSchema,
    allowCrossMarketplaceDependenciesOn: { type: 'array', items: { type: 'string' } },
  },
};

function readMarketplace() {
  return JSON.parse(fs.readFileSync(MARKETPLACE_PATH, 'utf8'));
}

function valueType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function validate(value, schema, atPath) {
  if (schema.oneOf) {
    const successes = [];
    const failures = [];
    for (const [index, candidate] of schema.oneOf.entries()) {
      const errors = validate(value, candidate, atPath);
      if (errors.length === 0) successes.push(candidate);
      else failures.push({ index, errors });
    }
    return successes.length === 1
      ? []
      : [
          `${atPath}: expected exactly one supported schema variant; ${failures
            .map(({ index, errors }) => `candidate ${index}: ${errors.join('; ')}`)
            .join(' | ')}`,
        ];
  }

  if (schema.const !== undefined && value !== schema.const) {
    return [`${atPath}: expected ${JSON.stringify(schema.const)}`];
  }

  if (schema.type) {
    const actualType = valueType(value);
    if (actualType !== schema.type) {
      return [`${atPath}: expected ${schema.type}, got ${actualType}`];
    }
  }

  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) {
    return [`${atPath}: expected to match ${schema.pattern}`];
  }

  if (schema.required && valueType(value) === 'object') {
    for (const key of schema.required) {
      if (!(key in value)) {
        return [`${atPath}: missing required field "${key}"`];
      }
    }
  }

  if (schema.type === 'array') {
    const errors = [];
    for (const [index, item] of value.entries()) {
      errors.push(...validate(item, schema.items, `${atPath}[${index}]`));
    }
    return errors;
  }

  if (schema.type === 'object') {
    const errors = [];
    const properties = schema.properties || {};
    for (const [key, entry] of Object.entries(value)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        if (schema.additionalProperties === false) {
          errors.push(`${atPath}: field "${key}" is not documented in ${CANONICAL_SOURCE_URL}`);
        }
        continue;
      }
      errors.push(...validate(entry, properties[key], `${atPath}.${key}`));
    }
    return errors;
  }

  return [];
}

test('marketplace.json matches the published Anthropic marketplace schema', () => {
  const marketplace = readMarketplace();
  const errors = validate(marketplace, marketplaceSchema, 'marketplace');
  assert.deepEqual(
    errors,
    [],
    `schema mismatch against ${CANONICAL_SOURCE_URL} (last checked ${LAST_CHECKED}): ${errors.join('; ')}`,
  );
});
