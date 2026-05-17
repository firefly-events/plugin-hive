'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const server = require('../hive/lib/openai-image-mcp-server.js');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'openai-image-mcp-'));
}

test('tool list exposes the declared tool names and schemas', () => {
  const result = server.toolListResult();
  const names = result.tools.map((tool) => tool.name);
  assert.deepEqual(names, [server.GENERATE_TOOL, server.EDIT_TOOL]);
  const generateTool = result.tools.find((tool) => tool.name === server.GENERATE_TOOL);
  const editTool = result.tools.find((tool) => tool.name === server.EDIT_TOOL);
  assert.equal(generateTool.inputSchema.required.includes('brand_brief'), true);
  assert.equal(generateTool.inputSchema.required.includes('concept_direction'), true);
  assert.equal(editTool.inputSchema.required.includes('source_images'), true);
  assert.equal(editTool.inputSchema.required.includes('edit_instruction'), true);
});

test('missing OPENAI_API_KEY returns a clear error before client creation', async () => {
  await assert.rejects(
    () => server.generateLogoConcepts(
      { brand_brief: 'A crisp B2B analytics brand', concept_direction: 'Geometric compass' },
      { env: {} }
    ),
    /missing OPENAI_API_KEY/
  );

  await assert.rejects(
    () => server.editLogoConcept(
      { source_images: ['logo.png'], edit_instruction: 'Reduce detail and thicken strokes' },
      { env: {} }
    ),
    /missing OPENAI_API_KEY/
  );
});

test('prompt templates substitute the provided brief and direction', () => {
  const generatePrompt = server.buildGeneratePrompt({
    brand_brief: 'Orbit Ledger helps finance teams close the books faster.',
    concept_direction: 'A minimal orbital ring around a sturdy monogram.',
  });
  assert.match(generatePrompt, /Orbit Ledger helps finance teams close the books faster/);
  assert.match(generatePrompt, /minimal orbital ring around a sturdy monogram/);
  assert.match(generatePrompt, /Produce four materially different logo candidates/);

  const editPrompt = server.buildEditPrompt({
    edit_instruction: 'Keep the symbol but remove gradients and simplify the outer ring.',
  });
  assert.match(editPrompt, /remove gradients and simplify the outer ring/);
  assert.match(editPrompt, /Return 2-3 edited logo variants/);
});

test('generate tool returns 4 normalized file outputs when OpenAI responds with base64 payloads', async () => {
  const outputDir = makeTempDir();
  const pngPayload = Buffer.from('png-binary').toString('base64');
  const client = {
    images: {
      generate: async (request) => {
        assert.equal(request.model, 'gpt-image-2');
        assert.equal(request.n, 4);
        return {
          data: [
            { b64_json: pngPayload },
            { b64_json: pngPayload },
            { b64_json: pngPayload },
            { b64_json: pngPayload },
          ],
        };
      },
    },
  };

  const result = await server.generateLogoConcepts(
    {
      brand_brief: 'Northstar makes fleet planning software.',
      concept_direction: 'A sturdy star + roadway abstraction.',
      output_dir: outputDir,
    },
    { env: { OPENAI_API_KEY: 'test-key' }, client }
  );

  assert.equal(result.tool, server.GENERATE_TOOL);
  assert.equal(result.count, 4);
  assert.equal(result.images.length, 4);
  for (const image of result.images) {
    assert.equal(image.kind, 'file');
    assert.equal(fs.existsSync(image.value), true);
  }
});

test('edit tool returns 2-3 normalized url outputs when OpenAI responds with urls', async () => {
  const client = {
    images: {
      edit: async (request) => {
        assert.equal(request.model, 'gpt-image-2');
        assert.equal(request.n, 3);
        assert.equal(Array.isArray(request.image), true);
        return {
          data: [
            { url: 'https://example.com/edit-1.png' },
            { url: 'https://example.com/edit-2.png' },
            { url: 'https://example.com/edit-3.png' },
          ],
        };
      },
    },
  };

  const result = await server.editLogoConcept(
    {
      source_images: ['concept.png'],
      edit_instruction: 'Tighten spacing and remove the secondary outline.',
    },
    {
      env: { OPENAI_API_KEY: 'test-key' },
      client,
      fileConverter: async (filePath) => ({ converted: filePath }),
    }
  );

  assert.equal(result.tool, server.EDIT_TOOL);
  assert.equal(result.count, 3);
  assert.deepEqual(
    result.images.map((image) => image.value),
    [
      'https://example.com/edit-1.png',
      'https://example.com/edit-2.png',
      'https://example.com/edit-3.png',
    ]
  );
});

test('callTool wraps structured content in MCP tool response format', async () => {
  const response = await server.callTool(
    server.GENERATE_TOOL,
    {
      brand_brief: 'Signal Forge is an industrial IoT platform.',
      concept_direction: 'A forged spark integrated into a hexagon.',
    },
    {
      env: { OPENAI_API_KEY: 'test-key' },
      client: {
        images: {
          generate: async () => ({
            data: [
              { url: 'https://example.com/concept-1.png' },
              { url: 'https://example.com/concept-2.png' },
              { url: 'https://example.com/concept-3.png' },
              { url: 'https://example.com/concept-4.png' },
            ],
          }),
        },
      },
    }
  );

  assert.equal(Array.isArray(response.content), true);
  assert.equal(response.structuredContent.count, 4);
  assert.match(response.content[0].text, /Signal Forge/);
});
