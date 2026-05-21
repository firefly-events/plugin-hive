'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER_NAME = 'openai-image';
const SERVER_VERSION = '1.0.0';
const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), '.pHive', 'brand', 'openai-image');
const DEFAULT_GENERATE_VARIANTS = 4;
const DEFAULT_EDIT_VARIANTS = 3;
const GENERATE_TOOL = 'generate_logo_concepts';
const EDIT_TOOL = 'edit_logo_concept';

const TOOL_DEFINITIONS = [
  {
    name: GENERATE_TOOL,
    description: 'Generate 4 logo concept candidates from a brand brief and concept direction.',
    inputSchema: {
      type: 'object',
      properties: {
        brand_brief: { type: 'string', description: 'Brand brief with positioning, audience, and constraints.' },
        concept_direction: { type: 'string', description: 'Single logo direction to explore.' },
        output_dir: { type: 'string', description: 'Optional directory for decoded PNG outputs.' },
        variants: { type: 'integer', minimum: 4, maximum: 8, description: 'Number of concepts to request. Default 4.' },
        size: { type: 'string', description: 'Optional image size, for example 1024x1024.' },
        background: { type: 'string', description: 'Optional background mode such as transparent.' },
      },
      required: ['brand_brief', 'concept_direction'],
      additionalProperties: false,
    },
  },
  {
    name: EDIT_TOOL,
    description: 'Create 2-3 edited logo variants from an existing image and a delta instruction.',
    inputSchema: {
      type: 'object',
      properties: {
        source_images: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: 'Local image paths to use as the edit source.',
        },
        edit_instruction: { type: 'string', description: 'Specific change request for the next iteration.' },
        output_dir: { type: 'string', description: 'Optional directory for decoded PNG outputs.' },
        variants: { type: 'integer', minimum: 2, maximum: 3, description: 'Number of edits to request. Default 3.' },
        mask_image: { type: 'string', description: 'Optional mask image path.' },
        size: { type: 'string', description: 'Optional image size, for example 1024x1024.' },
        background: { type: 'string', description: 'Optional background mode such as transparent.' },
      },
      required: ['source_images', 'edit_instruction'],
      additionalProperties: false,
    },
  },
];

function buildGeneratePrompt({ brand_brief, concept_direction }) {
  return [
    'You are generating logo exploration concepts for a professional brand-design workflow.',
    'Return distinct raster logo concepts suitable for later human review and vectorization.',
    '',
    'Brand brief:',
    brand_brief.trim(),
    '',
    'Concept direction:',
    concept_direction.trim(),
    '',
    'Output requirements:',
    '- Produce four materially different logo candidates for this single direction.',
    '- Favor clean silhouettes, strong contrast, and legible forms.',
    '- Avoid mockups, devices, signage, or presentation scenes.',
    '- Keep composition centered and suitable for transparent-background extraction.',
    '- Do not add extra text outside the intended mark or wordmark.',
  ].join('\n');
}

function buildEditPrompt({ edit_instruction }) {
  return [
    'You are refining an existing logo concept.',
    'Preserve the original idea while applying the requested delta cleanly.',
    '',
    'Edit instruction:',
    edit_instruction.trim(),
    '',
    'Output requirements:',
    '- Return 2-3 edited logo variants.',
    '- Keep the result production-minded and easy to vectorize.',
    '- Avoid adding presentation mockups or unrelated scene elements.',
    '- Maintain strong contrast and crisp edges.',
  ].join('\n');
}

function ensureApiKey(env) {
  const apiKey = (env && env.OPENAI_API_KEY) || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error('missing OPENAI_API_KEY');
    err.code = 'MISSING_OPENAI_API_KEY';
    throw err;
  }
  return apiKey;
}

function normalizeOpenAIError(error) {
  const message = error && error.message ? String(error.message) : 'Unknown OpenAI image error';
  const status = error && (error.status || (error.response && error.response.status));
  if (status === 401) return new Error('OpenAI image request failed: invalid OPENAI_API_KEY');
  if (status === 403) {
    return new Error('OpenAI image request failed: API access may require a verified OpenAI organization');
  }
  return new Error(message);
}

function createOpenAIClient({ apiKey, OpenAIClass, requireFn }) {
  const requireModule = requireFn || require;
  let OpenAI = OpenAIClass;
  if (!OpenAI) {
    try {
      OpenAI = requireModule('openai');
    } catch (error) {
      if (error && error.code === 'MODULE_NOT_FOUND') {
        throw new Error('OpenAI SDK not installed. Run: npm install --no-save openai');
      }
      throw error;
    }
  }
  return new OpenAI({ apiKey });
}

function resolveOutputDir(outputDir) {
  return path.resolve(outputDir || DEFAULT_OUTPUT_DIR);
}

function ensureDir(dirPath, fsModule) {
  (fsModule || fs).mkdirSync(dirPath, { recursive: true });
}

function decodeBase64Image({ data, outputDir, prefix, index, fsModule }) {
  ensureDir(outputDir, fsModule);
  const filename = `${prefix}-${index + 1}.png`;
  const fullPath = path.join(outputDir, filename);
  (fsModule || fs).writeFileSync(fullPath, Buffer.from(data, 'base64'));
  return fullPath;
}

function createRunId() {
  return crypto.randomBytes(6).toString('hex');
}

async function generateLogoConcepts(args, deps) {
  const options = deps || {};
  const apiKey = ensureApiKey(options.env);
  const client = options.client || createOpenAIClient({
    apiKey,
    OpenAIClass: options.OpenAIClass,
    requireFn: options.requireFn,
  });
  const variants = args.variants || DEFAULT_GENERATE_VARIANTS;
  const prompt = buildGeneratePrompt(args);
  const outputDir = resolveOutputDir(args.output_dir);
  const runId = `generate-${createRunId()}`;

  try {
    const response = await client.images.generate({
      model: 'gpt-image-2',
      prompt,
      n: variants,
      size: args.size || '1024x1024',
      background: args.background || 'transparent',
    });
    const images = normalizeImageOutputs({
      data: response && response.data,
      outputDir,
      prefix: runId,
      fsModule: options.fs,
    });
    if (images.length < 4) {
      throw new Error(`Expected at least 4 generated images, received ${images.length}`);
    }
    return {
      tool: GENERATE_TOOL,
      prompt,
      images,
      output_dir: outputDir,
      count: images.length,
    };
  } catch (error) {
    throw normalizeOpenAIError(error);
  }
}

async function editLogoConcept(args, deps) {
  const options = deps || {};
  const apiKey = ensureApiKey(options.env);
  const client = options.client || createOpenAIClient({
    apiKey,
    OpenAIClass: options.OpenAIClass,
    requireFn: options.requireFn,
  });
  const fileConverter = options.fileConverter || defaultFileConverter;
  const variants = args.variants || DEFAULT_EDIT_VARIANTS;
  const prompt = buildEditPrompt(args);
  const outputDir = resolveOutputDir(args.output_dir);
  const runId = `edit-${createRunId()}`;

  try {
    const imageFiles = [];
    for (const imagePath of args.source_images) {
      imageFiles.push(await fileConverter(imagePath, options));
    }
    const request = {
      model: 'gpt-image-2',
      prompt,
      image: imageFiles,
      n: variants,
      size: args.size || '1024x1024',
      background: args.background || 'transparent',
    };
    if (args.mask_image) {
      request.mask = await fileConverter(args.mask_image, options);
    }
    const response = await client.images.edit(request);
    const images = normalizeImageOutputs({
      data: response && response.data,
      outputDir,
      prefix: runId,
      fsModule: options.fs,
    });
    if (images.length < 2 || images.length > 3) {
      throw new Error(`Expected 2-3 edited images, received ${images.length}`);
    }
    return {
      tool: EDIT_TOOL,
      prompt,
      images,
      output_dir: outputDir,
      count: images.length,
    };
  } catch (error) {
    throw normalizeOpenAIError(error);
  }
}

function normalizeImageOutputs({ data, outputDir, prefix, fsModule }) {
  const items = Array.isArray(data) ? data : [];
  return items.map((entry, index) => {
    if (entry && entry.url) {
      return { kind: 'url', value: entry.url };
    }
    if (entry && entry.b64_json) {
      return {
        kind: 'file',
        value: decodeBase64Image({
          data: entry.b64_json,
          outputDir,
          prefix,
          index,
          fsModule,
        }),
      };
    }
    throw new Error(`Unsupported image output at index ${index}`);
  });
}

async function defaultFileConverter(imagePath, options) {
  const requireModule = (options && options.requireFn) || require;
  let toFile;
  try {
    ({ toFile } = requireModule('openai'));
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      throw new Error('OpenAI SDK not installed. Run: npm install --no-save openai');
    }
    throw error;
  }
  return toFile(fs.createReadStream(imagePath), path.basename(imagePath));
}

function makeToolResponse(result) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
    structuredContent: result,
  };
}

async function callTool(name, args, deps) {
  if (name === GENERATE_TOOL) {
    return makeToolResponse(await generateLogoConcepts(args || {}, deps));
  }
  if (name === EDIT_TOOL) {
    return makeToolResponse(await editLogoConcept(args || {}, deps));
  }
  throw new Error(`Unknown tool: ${name}`);
}

function toolListResult() {
  return { tools: TOOL_DEFINITIONS };
}

function readMessages(onMessage) {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.trim()) continue;
      try {
        onMessage(JSON.parse(line));
      } catch (error) {
        process.stderr.write(`Failed to parse JSON-RPC line: ${error && error.message ? error.message : String(error)}\n`);
      }
    }
  });
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleRpcMessage(message) {
  if (!message || typeof message !== 'object') return;
  if (!Object.prototype.hasOwnProperty.call(message, 'id')) {
    if (message.method === 'notifications/initialized') return;
    return;
  }

  try {
    if (message.method === 'initialize') {
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: message.params && message.params.protocolVersion ? message.params.protocolVersion : '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      });
      return;
    }

    if (message.method === 'tools/list') {
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: toolListResult(),
      });
      return;
    }

    if (message.method === 'tools/call') {
      const result = await callTool(
        message.params && message.params.name,
        message.params && message.params.arguments
      );
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result,
      });
      return;
    }

    if (message.method === 'ping') {
      writeMessage({ jsonrpc: '2.0', id: message.id, result: {} });
      return;
    }

    writeMessage({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `Method not found: ${message.method}` },
    });
  } catch (error) {
    writeMessage({
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32000,
        message: error && error.message ? error.message : String(error),
      },
    });
  }
}

function startServer() {
  process.stdin.resume();
  readMessages((message) => {
    handleRpcMessage(message).catch((error) => {
      process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    });
  });
}

module.exports = {
  DEFAULT_EDIT_VARIANTS,
  DEFAULT_GENERATE_VARIANTS,
  EDIT_TOOL,
  GENERATE_TOOL,
  TOOL_DEFINITIONS,
  buildEditPrompt,
  buildGeneratePrompt,
  callTool,
  createOpenAIClient,
  editLogoConcept,
  ensureApiKey,
  generateLogoConcepts,
  normalizeImageOutputs,
  startServer,
  toolListResult,
};

if (require.main === module) {
  startServer();
}
