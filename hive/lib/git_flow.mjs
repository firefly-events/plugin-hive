/**
 * git_flow resolution helper (story pe-1-config-schema).
 *
 * Reads root-first hive.config.yaml + plugin baseline hive/hive.config.yaml,
 * resolves the `git_flow` block, and probes `origin/develop` when
 * `default_pr_base: auto` is configured.
 *
 * Pure read-only: no writes outside the caller's stdio. Array-form
 * execFileSync only — never shell interpolation.
 */
'use strict';

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_BASELINE = resolve(__dirname, '..', 'hive.config.yaml');

const DEFAULT_GIT_FLOW = Object.freeze({
  default_pr_base: 'auto',
  branch_strategy: 'per-epic',
});

const VALID_STRATEGIES = new Set(['per-epic', 'per-story']);

function parseGitFlowBlock(raw) {
  if (!raw) return null;
  const lines = raw.split(/\r?\n/);
  let inBlock = false;
  const out = {};
  for (const line of lines) {
    if (/^\s*$/.test(line)) continue;
    if (/^#/.test(line)) continue;
    if (!inBlock) {
      if (/^git_flow:\s*(#.*)?$/.test(line)) {
        inBlock = true;
      }
      continue;
    }
    if (/^\S/.test(line)) {
      break;
    }
    const m = line.match(/^\s+([A-Za-z0-9_]+)\s*:\s*(.+?)\s*(?:#.*)?$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    val = val.replace(/^['"]|['"]$/g, '');
    if (val === 'null' || val === '~' || val === '') {
      out[key] = null;
    } else if (val === 'true') {
      out[key] = true;
    } else if (val === 'false') {
      out[key] = false;
    } else {
      out[key] = val;
    }
  }
  if (!inBlock) return null;
  return out;
}

function readConfigGitFlow(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf8');
    return parseGitFlowBlock(raw);
  } catch {
    return null;
  }
}

function probeOriginDevelop(cwd) {
  try {
    execFileSync('git', ['-C', cwd, 'rev-parse', '--verify', 'origin/develop'], {
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

export function resolveGitFlow({ cwd = process.cwd() } = {}) {
  const rootPath = join(cwd, 'hive.config.yaml');
  const pluginPath = join(cwd, 'hive', 'hive.config.yaml');

  let block = readConfigGitFlow(rootPath);
  let source = 'root';

  if (!block) {
    block = readConfigGitFlow(pluginPath);
    source = 'plugin';
  }

  if (!block) {
    block = readConfigGitFlow(PLUGIN_BASELINE);
    source = 'plugin';
  }

  if (!block) {
    block = { ...DEFAULT_GIT_FLOW };
    source = 'default';
  }

  let default_pr_base = block.default_pr_base;
  if (default_pr_base === null || default_pr_base === undefined || default_pr_base === '') {
    default_pr_base = DEFAULT_GIT_FLOW.default_pr_base;
  }

  let branch_strategy = block.branch_strategy;
  if (!VALID_STRATEGIES.has(branch_strategy)) {
    branch_strategy = DEFAULT_GIT_FLOW.branch_strategy;
  }

  let base_branch;
  if (default_pr_base === 'auto') {
    base_branch = probeOriginDevelop(cwd) ? 'develop' : 'main';
  } else {
    base_branch = default_pr_base;
  }

  return { base_branch, branch_strategy, source };
}

export const _internal = { parseGitFlowBlock, DEFAULT_GIT_FLOW };
