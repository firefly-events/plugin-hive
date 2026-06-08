import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_DIFF_MAX_BYTES = 80_000;
const DEFAULT_MESSAGES_MAX_BYTES = 120_000;
const DEFAULT_HIVE_MEMORY_ROOT = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.claude',
  'hive',
  'memories',
);

function hasSignal(value) {
  return String(value ?? '').trim().length > 0;
}

function safeSlug(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

async function readOptionalFile(filePath, maxBytes) {
  if (!filePath) return null;
  try {
    const stat = await fs.stat(filePath);
    const raw = await fs.readFile(filePath, 'utf8');
    const truncated = Number.isFinite(maxBytes) && raw.length > maxBytes;
    return {
      path: filePath,
      content: truncated ? raw.slice(0, maxBytes) : raw,
      truncated,
      bytes: stat.size,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function readGitDiff(workDir, opts = {}) {
  if (!workDir) return null;
  const {
    baseRef,
    diffArgs = baseRef ? [baseRef, '--'] : ['HEAD'],
    maxBytes = DEFAULT_DIFF_MAX_BYTES,
  } = opts;
  try {
    const { stdout } = await execFileAsync('git', ['-C', workDir, 'diff', ...diffArgs], {
      maxBuffer: Math.max(maxBytes * 2, 1024 * 1024),
    });
    const truncated = Number.isFinite(maxBytes) && stdout.length > maxBytes;
    return {
      work_dir: workDir,
      command: ['git', '-C', workDir, 'diff', ...diffArgs].join(' '),
      content: truncated ? stdout.slice(0, maxBytes) : stdout,
      truncated,
    };
  } catch (error) {
    return {
      work_dir: workDir,
      error: error?.message || String(error),
      content: '',
      truncated: false,
    };
  }
}

export async function collectMulticaDistillInputs(opts) {
  const {
    hiveStateDir,
    epicHandle,
    storyId,
    workDir,
    messagesPath,
    selfCapturePath,
    diffBaseRef,
    diffArgs,
    diffMaxBytes = DEFAULT_DIFF_MAX_BYTES,
    messagesMaxBytes = DEFAULT_MESSAGES_MAX_BYTES,
  } = opts;

  const agentSelfCapturePath =
    selfCapturePath ||
    (workDir ? path.join(workDir, '.hive', 'insights', `${storyId}.md`) : null);
  const fallbackMessagesPath =
    messagesPath || path.join(hiveStateDir, 'episodes', epicHandle, storyId, 'multica-run.messages.jsonl');

  const [agent_self_capture, transcript, git_diff] = await Promise.all([
    readOptionalFile(agentSelfCapturePath, messagesMaxBytes),
    readOptionalFile(fallbackMessagesPath, messagesMaxBytes),
    readGitDiff(workDir, { baseRef: diffBaseRef, diffArgs, maxBytes: diffMaxBytes }),
  ]);

  return {
    epic: epicHandle,
    story: storyId,
    agent_self_capture,
    transcript,
    git_diff,
  };
}

export async function writeTeamMemory(opts) {
  const { stateDir = '.pHive', epicHandle, storyId, content } = opts;
  if (!hasSignal(content)) return null;

  const dir = path.join(stateDir, 'team-memories', epicHandle);
  const filePath = path.join(dir, `${storyId}.md`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, `${String(content).trim()}\n`, 'utf8');
  return filePath;
}

function memoryFrontmatter(memory) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(memory.frontmatter || {})) {
    if (value === undefined) continue;
    lines.push(`${key}: ${value === null ? 'null' : JSON.stringify(String(value))}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

async function updateMemoryIndex(agentDir, memory) {
  const indexPath = path.join(agentDir, 'MEMORY.md');
  const title = memory.title || memory.frontmatter?.name || memory.slug;
  const description = memory.description || memory.frontmatter?.description || '';
  const line = `- [${title}](${memory.slug}.md)${description ? ` - ${description}` : ''}`;
  let current = '';
  try {
    current = await fs.readFile(indexPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    current = `# ${memory.agent} Agent Memory Index\n\n`;
  }
  if (current.includes(`](${memory.slug}.md)`)) return indexPath;
  const next = current.endsWith('\n') ? `${current}${line}\n` : `${current}\n${line}\n`;
  await fs.writeFile(indexPath, next, 'utf8');
  return indexPath;
}

export async function promoteHiveMemory(opts) {
  const { memoryRoot = DEFAULT_HIVE_MEMORY_ROOT, memory } = opts;
  if (!memory || !hasSignal(memory.content)) return null;

  const agent = safeSlug(memory.agent || memory.frontmatter?.agent || 'orchestrator');
  const slug = safeSlug(memory.slug || memory.frontmatter?.name);
  if (!slug) throw new TypeError('promoteHiveMemory requires a slug or frontmatter.name');

  const agentDir = path.join(memoryRoot, agent);
  const memoryPath = path.join(agentDir, `${slug}.md`);
  await fs.mkdir(agentDir, { recursive: true });
  const frontmatter = memoryFrontmatter({
    ...memory,
    frontmatter: {
      name: memory.title || memory.frontmatter?.name || slug,
      description: memory.description || memory.frontmatter?.description || '',
      type: memory.type || memory.frontmatter?.type || 'pattern',
      agent,
      source: 'orchestrator',
      ...memory.frontmatter,
    },
  });
  await fs.writeFile(memoryPath, `${frontmatter}${String(memory.content).trim()}\n`, 'utf8');
  const indexPath = await updateMemoryIndex(agentDir, {
    ...memory,
    agent,
    slug,
    title: memory.title || memory.frontmatter?.name || slug,
    description: memory.description || memory.frontmatter?.description || '',
  });
  return { memoryPath, indexPath };
}

export async function runMulticaInsightDistill(opts) {
  const {
    hiveStateDir = '.pHive',
    epicHandle,
    storyId,
    workDir,
    messagesPath,
    selfCapturePath,
    diffBaseRef,
    diffArgs,
    teamMemory,
    hiveMemories = [],
    memoryRoot,
    collectInputs = collectMulticaDistillInputs,
  } = opts;

  const inputs = await collectInputs({
    hiveStateDir,
    epicHandle,
    storyId,
    workDir,
    messagesPath,
    selfCapturePath,
    diffBaseRef,
    diffArgs,
  });

  const teamMemoryPath = await writeTeamMemory({
    stateDir: hiveStateDir,
    epicHandle,
    storyId,
    content: teamMemory,
  });
  const promotedMemories = [];
  for (const memory of hiveMemories) {
    const promoted = await promoteHiveMemory({ memoryRoot, memory });
    if (promoted) promotedMemories.push(promoted);
  }

  return {
    inputs,
    teamMemoryPath,
    promotedMemories,
    skipped: !teamMemoryPath && promotedMemories.length === 0,
  };
}
