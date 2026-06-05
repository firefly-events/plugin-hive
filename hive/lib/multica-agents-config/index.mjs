import fs from 'node:fs';
import path from 'node:path';

// Parser choice: js-yaml is not available from the repo root, so this module
// uses a tiny purpose-built parser for the fixed agents.yaml schema.

const REQUIRED_AGENT_FIELDS = ['name', 'provider', 'model', 'persona_ref'];

function parseScalar(value) {
  if (value === '{}') {
    return {};
  }

  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (inner === '') return [];
    return inner
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .map((item) => parseScalar(item));
  }

  if (value === 'null' || value === '~') {
    return null;
  }

  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  // Strip matching surrounding quotes so quoted scalars store their content, not the
  // delimiters. Without this, `model: ""` yields the 2-char string `""` and a quoted
  // env value keeps its quotes — both diff against the server's normalized value on
  // every reconcile, causing spurious patches.
  if (
    value.length >= 2 &&
    ((value[0] === '"' && value[value.length - 1] === '"') ||
      (value[0] === "'" && value[value.length - 1] === "'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function applyDefaults(agent) {
  return {
    max_concurrent_tasks: 1,
    custom_env: {},
    custom_args: [],
    mcp_config: null,
    skills: [],
    visibility: 'workspace',
    ...agent,
  };
}

export function parseAgentsConfig(yamlString) {
  const lines = yamlString.split(/\r?\n/);
  let schemaVersion;
  const agents = [];
  let currentAgent = null;
  let currentNestedField = null;

  for (const [index, line] of lines.entries()) {
    if (!line.trim()) {
      continue;
    }

    const nestedFieldMatch = line.match(/^      ([^:]+):\s*(.*)$/);
    if (nestedFieldMatch && currentAgent && currentNestedField) {
      currentAgent[currentNestedField][nestedFieldMatch[1]] = parseScalar(nestedFieldMatch[2].trim());
      continue;
    }

    if (/^\s{6,}\S/.test(line)) {
      throw new Error(`unsupported nested YAML in agents config at line ${index + 1}`);
    }

    const schemaMatch = line.match(/^schema_version:\s*(.+)$/);
    if (schemaMatch) {
      schemaVersion = parseScalar(schemaMatch[1].trim());
      currentNestedField = null;
      continue;
    }

    if (line === 'agents:') {
      currentNestedField = null;
      continue;
    }

    const agentStartMatch = line.match(/^  - ([^:]+):\s*(.+)$/);
    if (agentStartMatch) {
      currentAgent = {};
      currentAgent[agentStartMatch[1]] = parseScalar(agentStartMatch[2].trim());
      agents.push(currentAgent);
      currentNestedField = null;
      continue;
    }

    const agentFieldMatch = line.match(/^    ([^:]+):\s*(.*)$/);
    if (agentFieldMatch && currentAgent) {
      const [, field, rawValue] = agentFieldMatch;
      const value = rawValue.trim();
      currentAgent[field] = value === '' ? {} : parseScalar(value);
      currentNestedField = value === '' ? field : null;
    }
  }

  if (schemaVersion !== 1) {
    throw new Error(`schema version mismatch: expected 1, received ${schemaVersion}`);
  }

  for (const agent of agents) {
    // Required = the key is present. An empty string is a valid value (e.g.
    // `model: ""` means "use the provider default"), so check presence, not truthiness.
    const missingFields = REQUIRED_AGENT_FIELDS.filter((field) => agent[field] === undefined || agent[field] === null);
    if (missingFields.length > 0) {
      throw new Error(`agent ${agent.name ?? '<unknown>'} missing required fields: ${missingFields.join(', ')}`);
    }
  }

  return {
    schema_version: schemaVersion,
    agents: agents.map(applyDefaults),
  };
}

export function resolveAgentInstructions(agent, repoRoot) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const realRepoRoot = fs.realpathSync(resolvedRepoRoot);
  const personaPath = path.resolve(resolvedRepoRoot, agent.persona_ref);
  let realPersonaPath;
  try {
    realPersonaPath = fs.realpathSync(personaPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`agent ${agent.name} persona_ref not found: ${personaPath}`);
    }

    throw error;
  }

  const rel = path.relative(realRepoRoot, realPersonaPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`agent ${agent.name} persona_ref must stay under repo root: ${agent.persona_ref}`);
  }

  return fs.readFileSync(realPersonaPath, 'utf8');
}
