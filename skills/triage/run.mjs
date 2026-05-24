#!/usr/bin/env node
/**
 * run.mjs — CLI entry point for /hive:triage.
 *
 * Usage:
 *   node run.mjs --list [<state>] [--json]
 *   node run.mjs <id> [--json]
 *   node run.mjs "<description>" [--json]
 *   node run.mjs <id> --advance <state> [--kind <k>] [--priority <p>] [--severity <s>] [--json]
 *   node run.mjs <id> --hand-off [--json]
 *   node run.mjs <id> --close [--reason "..."] [--json]
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const QUEUE_DIR = join(REPO_ROOT, '.pHive', 'triage');
const QUEUE_PATH = join(QUEUE_DIR, 'queue.yaml');
const SCHEMA_VERSION = 1;

const VALID_STATES = ['inbox', 'clarified', 'prioritized', 'plan-ready', 'closed'];

const VALID_TRANSITIONS = {
  inbox: ['clarified', 'closed'],
  clarified: ['prioritized', 'closed'],
  prioritized: ['plan-ready', 'closed'],
  'plan-ready': ['closed'],
  closed: [],
};

// ---------------------------------------------------------------------------
// Arg parser
// ---------------------------------------------------------------------------

function usage() {
  return [
    'Usage:',
    '  triage --list [<state>] [--json]',
    '  triage <id> [--json]',
    '  triage "<description>" [--json]',
    '  triage <id> --advance <state> [--kind <k>] [--priority <p>] [--severity <s>] [--json]',
    '  triage <id> --hand-off [--json]',
    '  triage <id> --close [--reason "..."] [--json]',
  ].join('\n');
}

function parseArgs(argv) {
  const args = [...argv];
  const opts = {
    list: false,
    listState: null,
    positional: null,
    advance: null,
    handOff: false,
    close: false,
    reason: null,
    kind: null,
    priority: null,
    severity: null,
    json: false,
  };

  const KNOWN_FLAGS = new Set([
    '--list', '--advance', '--hand-off', '--close',
    '--reason', '--kind', '--priority', '--severity', '--json',
  ]);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--list') {
      opts.list = true;
      // Peek ahead: if next arg looks like a state name (not a flag), consume it
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        opts.listState = args[++i];
      }
    } else if (arg === '--advance') {
      const val = args[++i];
      if (!val || val.startsWith('--')) die(`--advance requires a state argument.\n${usage()}`);
      opts.advance = val;
    } else if (arg === '--hand-off') {
      opts.handOff = true;
    } else if (arg === '--close') {
      opts.close = true;
    } else if (arg === '--reason') {
      const val = args[++i];
      if (!val || val.startsWith('--')) die(`--reason requires a value.\n${usage()}`);
      opts.reason = val;
    } else if (arg === '--kind') {
      const val = args[++i];
      if (!val || val.startsWith('--')) die(`--kind requires a value.\n${usage()}`);
      opts.kind = val;
    } else if (arg === '--priority') {
      const val = args[++i];
      if (!val || val.startsWith('--')) die(`--priority requires a value.\n${usage()}`);
      opts.priority = val;
    } else if (arg === '--severity') {
      const val = args[++i];
      if (!val || val.startsWith('--')) die(`--severity requires a value.\n${usage()}`);
      opts.severity = val;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg.startsWith('--')) {
      die(`unknown flag: ${arg}\n${usage()}`);
    } else {
      if (opts.positional !== null) die(`unexpected argument: ${arg}\n${usage()}`);
      opts.positional = arg;
    }
  }
  return opts;
}

function die(msg, code = 1) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Queue I/O — single writer
// ---------------------------------------------------------------------------

function ensureQueue() {
  if (!existsSync(QUEUE_DIR)) {
    mkdirSync(QUEUE_DIR, { recursive: true });
    process.stderr.write(
      'Warning: Hive not initialized for this project. Run `/hive:kickoff` for full context. Proceeding with defaults.\n',
    );
  }
  if (!existsSync(QUEUE_PATH)) {
    writeFileSync(QUEUE_PATH, 'version: 1\nitems: []\n', 'utf8');
  }
}

function readQueue() {
  if (!existsSync(QUEUE_PATH)) return [];
  const text = readFileSync(QUEUE_PATH, 'utf8');
  return parseQueueYaml(text);
}

function writeQueue(items) {
  ensureQueue();
  writeFileSync(QUEUE_PATH, serializeQueueYaml(items), 'utf8');
}

// ---------------------------------------------------------------------------
// Minimal YAML parser for queue.yaml
// ---------------------------------------------------------------------------

function parseQueueYaml(text) {
  // Split into item blocks at lines starting with "  - id:"
  const blocks = text.split(/\n(?=  - id:)/);
  const items = [];
  for (const block of blocks) {
    if (!block.includes('id:')) continue;
    const item = parseItemBlock(block);
    if (item) items.push(item);
  }
  return items;
}

function readScalar(block, field) {
  const m = block.match(new RegExp(`^    ${field}:\\s*(.+)$`, 'm'));
  if (!m) return null;
  const v = m[1].trim();
  if (v === 'null') return null;
  return v.replace(/^['"]|['"]$/g, '');
}

function readBlockLiteral(block, field) {
  // Match "    field: |" then collect indented lines below
  const startRe = new RegExp(`^    ${field}:\\s*\\|\\s*$`, 'm');
  const startMatch = block.match(startRe);
  if (!startMatch) {
    // Try inline value
    return readScalar(block, field);
  }
  const startIdx = block.indexOf(startMatch[0]) + startMatch[0].length + 1;
  const rest = block.slice(startIdx);
  const lines = [];
  for (const line of rest.split('\n')) {
    if (line.startsWith('      ')) {
      lines.push(line.slice(6)); // strip 6 spaces of indent
    } else if (line.trim() === '' && lines.length > 0) {
      lines.push('');
    } else {
      break;
    }
  }
  // Trim trailing blank lines
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') || null;
}

function parseStateHistory(block) {
  const history = [];
  const re = /- state:\s*(\S+)\s*\n\s+at:\s*(\S+)/g;
  // Find the state_history section
  const histMatch = block.match(/    state_history:([\s\S]*?)(?=\n    \w|$)/);
  if (!histMatch) return history;
  const histSection = histMatch[1];
  let m;
  while ((m = re.exec(histSection)) !== null) {
    history.push({ state: m[1], at: m[2] });
  }
  return history;
}

function parseItemBlock(block) {
  // First field is `  - id: <value>` (list-item marker), not `    id:`.
  // Read it with a list-prefix regex; fall through to the 4-space-indent
  // scalar reader for all subsequent fields.
  const idMatch = block.match(/^\s*-\s+id:\s*(.+)$/m);
  const id = idMatch ? idMatch[1].trim().replace(/^['"]|['"]$/g, '') : null;
  if (!id) return null;
  return {
    id,
    state: readScalar(block, 'state') ?? 'inbox',
    kind: readScalar(block, 'kind') ?? 'unknown',
    title: readScalar(block, 'title') ?? '',
    description: readBlockLiteral(block, 'description') ?? '',
    reporter: readScalar(block, 'reporter') ?? 'unknown',
    reported_at: readScalar(block, 'reported_at') ?? new Date().toISOString(),
    priority: readScalar(block, 'priority'),
    severity: readScalar(block, 'severity'),
    assignee: readScalar(block, 'assignee'),
    linked_epic: readScalar(block, 'linked_epic'),
    linked_story: readScalar(block, 'linked_story'),
    closed_reason: readScalar(block, 'closed_reason'),
    closed_at: readScalar(block, 'closed_at'),
    state_history: parseStateHistory(block),
  };
}

// ---------------------------------------------------------------------------
// Minimal YAML serializer for queue.yaml
// ---------------------------------------------------------------------------

function yamlStr(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string' && /[:{}[\],&*?|<>=!%@`#'"\n]/.test(v)) {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return String(v);
}

function serializeItem(item) {
  const descLines = (item.description ?? '').split('\n');
  const descYaml = descLines.length === 1 && !descLines[0].includes('\n')
    ? `      ${descLines[0]}\n`
    : descLines.map(l => `      ${l}`).join('\n') + '\n';
  const descField = `    description: |\n${descYaml}`;

  const histLines = (item.state_history ?? [])
    .map(h => `      - state: ${h.state}\n        at: ${h.at}`)
    .join('\n');

  return [
    `  - id: ${yamlStr(item.id)}`,
    `    state: ${yamlStr(item.state)}`,
    `    kind: ${yamlStr(item.kind)}`,
    `    title: ${yamlStr(item.title)}`,
    descField.trimEnd(),
    `    reporter: ${yamlStr(item.reporter)}`,
    `    reported_at: ${yamlStr(item.reported_at)}`,
    `    priority: ${yamlStr(item.priority)}`,
    `    severity: ${yamlStr(item.severity)}`,
    `    assignee: ${yamlStr(item.assignee)}`,
    `    linked_epic: ${yamlStr(item.linked_epic)}`,
    `    linked_story: ${yamlStr(item.linked_story)}`,
    `    closed_reason: ${yamlStr(item.closed_reason)}`,
    `    closed_at: ${yamlStr(item.closed_at)}`,
    `    state_history:`,
    histLines || '      []',
  ].join('\n');
}

function serializeQueueYaml(items) {
  if (items.length === 0) return 'version: 1\nitems: []\n';
  return `version: 1\nitems:\n${items.map(serializeItem).join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function nextId(items) {
  const nums = items
    .map(i => {
      const m = i.id.match(/^t-(\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    })
    .filter(Boolean);
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `t-${String(max + 1).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function out(text) {
  process.stdout.write(text + '\n');
}

function outJson(obj) {
  out(JSON.stringify({ schema_version: SCHEMA_VERSION, ...obj }, null, 2));
}

function fmtItem(item) {
  const lines = [
    `${item.id} [${item.state}] ${item.kind} — ${item.title}`,
    `Reporter: ${item.reporter ?? 'unknown'}  Reported: ${item.reported_at ?? '?'}`,
  ];
  if (item.description) {
    lines.push('Description:');
    for (const l of item.description.split('\n')) lines.push(`  ${l}`);
  }
  lines.push(
    `Priority: ${item.priority ?? 'null'}  Severity: ${item.severity ?? 'null'}`,
  );
  if (item.linked_epic || item.linked_story) {
    lines.push(`Linked epic: ${item.linked_epic ?? 'null'}  Story: ${item.linked_story ?? 'null'}`);
  }
  if (item.state === 'closed') {
    lines.push(`Closed: ${item.closed_at ?? '?'}  Reason: ${item.closed_reason ?? 'none'}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Sub-commands
// ---------------------------------------------------------------------------

function cmdList(opts) {
  const items = readQueue();
  const stateFilter = opts.listState;
  if (stateFilter && !VALID_STATES.includes(stateFilter)) {
    die(`unknown state: ${stateFilter}\nValid states: ${VALID_STATES.join(', ')}`);
  }
  const filtered = stateFilter ? items.filter(i => i.state === stateFilter) : items;

  if (opts.json) {
    outJson({ command: 'list', filter: stateFilter ?? null, count: filtered.length, items: filtered });
    return;
  }

  const header = stateFilter
    ? `Triage queue — ${filtered.length} entries (filter: ${stateFilter})`
    : `Triage queue — ${filtered.length} entries`;
  out(header);
  if (filtered.length === 0) {
    out('(empty)');
    return;
  }
  out('');
  const COL = [6, 12, 10, 0];
  out(
    'ID'.padEnd(COL[0]) + 'STATE'.padEnd(COL[1]) + 'KIND'.padEnd(COL[2]) + 'TITLE',
  );
  out('-'.repeat(6) + '  ' + '-'.repeat(10) + '  ' + '-'.repeat(8) + '  ' + '-'.repeat(20));
  for (const item of filtered) {
    out(
      item.id.padEnd(COL[0]) +
      item.state.padEnd(COL[1]) +
      (item.kind ?? 'unknown').padEnd(COL[2]) +
      (item.title ?? ''),
    );
  }
}

function cmdGet(id, opts) {
  const items = readQueue();
  const item = items.find(i => i.id === id);
  if (!item) die(`entry not found: ${id}`);

  if (opts.json) {
    outJson({ command: 'get', item });
    return;
  }
  out(fmtItem(item));
}

function cmdCreate(description, opts) {
  ensureQueue();
  const items = readQueue();
  const id = nextId(items);
  const now = new Date().toISOString();
  const newItem = {
    id,
    state: 'inbox',
    kind: 'unknown',
    title: description.split('\n')[0].slice(0, 80),
    description,
    reporter: 'operator',
    reported_at: now,
    priority: null,
    severity: null,
    assignee: null,
    linked_epic: null,
    linked_story: null,
    closed_reason: null,
    closed_at: null,
    state_history: [{ state: 'inbox', at: now }],
  };
  writeQueue([...items, newItem]);

  if (opts.json) {
    outJson({ command: 'create', id, state: 'inbox' });
    return;
  }
  out(`Created ${id} [inbox]`);
}

function cmdAdvance(id, opts) {
  const targetState = opts.advance;
  if (!VALID_STATES.includes(targetState)) {
    die(`unknown state: ${targetState}\nValid states: ${VALID_STATES.join(', ')}`);
  }

  const items = readQueue();
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) die(`entry not found: ${id}`);

  const item = items[idx];
  const allowed = VALID_TRANSITIONS[item.state] ?? [];
  if (!allowed.includes(targetState)) {
    die(`invalid transition: ${item.state} → ${targetState}\nAllowed from ${item.state}: ${allowed.join(', ') || 'none'}`);
  }

  const previousState = item.state;
  const now = new Date().toISOString();
  const updated = {
    ...item,
    state: targetState,
    kind: opts.kind ?? item.kind,
    priority: opts.priority ?? item.priority,
    severity: opts.severity ?? item.severity,
    state_history: [...item.state_history, { state: targetState, at: now }],
  };
  items[idx] = updated;
  writeQueue(items);

  if (opts.json) {
    outJson({ command: 'advance', id, previous_state: previousState, new_state: targetState });
    return;
  }
  out(`${id}: ${previousState} → ${targetState}`);
}

function cmdHandOff(id, opts) {
  const items = readQueue();
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) die(`entry not found: ${id}`);

  const item = items[idx];
  if (item.state !== 'prioritized') {
    die(`hand-off requires state=prioritized; current state is ${item.state}`);
  }

  const now = new Date().toISOString();
  const updated = {
    ...item,
    state: 'plan-ready',
    state_history: [...item.state_history, { state: 'plan-ready', at: now }],
  };
  items[idx] = updated;
  writeQueue(items);

  if (opts.json) {
    outJson({
      command: 'hand-off',
      id,
      previous_state: item.state,
      new_state: 'plan-ready',
      linked_epic: updated.linked_epic,
      linked_story: updated.linked_story,
    });
    return;
  }
  out(
    `${id} → plan-ready  (linked_epic: ${updated.linked_epic ?? 'null'}  linked_story: ${updated.linked_story ?? 'null'})`,
  );
}

function cmdClose(id, opts) {
  const items = readQueue();
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) die(`entry not found: ${id}`);

  const item = items[idx];
  if (item.state === 'closed') die(`entry ${id} is already closed`);

  const now = new Date().toISOString();
  const updated = {
    ...item,
    state: 'closed',
    closed_reason: opts.reason ?? null,
    closed_at: now,
    state_history: [...item.state_history, { state: 'closed', at: now }],
  };
  items[idx] = updated;
  writeQueue(items);

  if (opts.json) {
    outJson({
      command: 'close',
      id,
      previous_state: item.state,
      new_state: 'closed',
      reason: opts.reason ?? null,
    });
    return;
  }
  out(`${id} → closed  (reason: ${opts.reason ? `"${opts.reason}"` : 'none'})`);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.list) return cmdList(opts);

  if (opts.positional !== null) {
    const pos = opts.positional;

    if (opts.advance) return cmdAdvance(pos, opts);
    if (opts.handOff) return cmdHandOff(pos, opts);
    if (opts.close) return cmdClose(pos, opts);

    // Disambiguate: triage entry ID vs new description
    if (/^t-\d+$/.test(pos)) return cmdGet(pos, opts);
    return cmdCreate(pos, opts);
  }

  die(`no sub-command specified\n${usage()}`);
}

main();
