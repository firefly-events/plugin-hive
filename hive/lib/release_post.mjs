import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ARTIFACTS = [
  ['post-template.md', 'post.md'],
  ['video-script-template.md', 'video-script.md'],
  ['post-ideas-template.md', 'post-ideas.md'],
];

const DEFAULT_CHANNELS = [
  { name: 'Primary changelog', angle: 'Lead with the shipped outcomes and link to the release notes.' },
  { name: 'Team update', angle: 'Emphasize why the shipped work matters for current users and operators.' },
];

function moduleRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

// Honor the configured state directory (paths.state_dir) via HIVE_STATE_DIR,
// falling back to the default `.pHive`. Keeps release artifacts under the
// relocated state dir when a consumer overrides it.
function stateDir() {
  return process.env.HIVE_STATE_DIR || '.pHive';
}

function stripQuotes(value) {
  return String(value ?? '').trim().replace(/^['"]|['"]$/g, '');
}

function readScalar(text, field) {
  const match = text.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  if (!match) return null;
  const raw = match[1].trim();
  if (raw === '|' || raw === '>') return readBlock(text, field);
  return stripQuotes(raw);
}

function readBlock(text, field) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^${field}:\\s*[|>]\\s*$`).test(line));
  if (start === -1) return null;

  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && !line.startsWith(' ')) break;
    body.push(line.replace(/^  /, ''));
  }
  return body.join('\n').trim();
}

function firstSentence(text) {
  const compact = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const match = compact.match(/^(.+?[.!?])(?:\s|$)/);
  return (match?.[1] ?? compact).trim();
}

function storyFromYaml(epicId, file, text) {
  const storyId = readScalar(text, 'id') ?? path.basename(file, '.yaml');
  const title = readScalar(text, 'title') ?? storyId;
  const outcome =
    readScalar(text, 'outcome') ??
    readScalar(text, 'description_summary') ??
    firstSentence(readScalar(text, 'description'));

  return {
    epicId,
    storyId,
    title,
    outcome: outcome || title,
    sourcePath: `${stateDir()}/epics/${epicId}/stories/${path.basename(file)}`,
  };
}

function normalizeStory(story) {
  const epicId = story.epicId ?? story.epic_id ?? story.epic;
  const storyId = story.storyId ?? story.story_id ?? story.id;
  const title = story.title ?? storyId;
  const outcome = story.outcome ?? story.description_summary ?? firstSentence(story.description) ?? title;

  if (!epicId || !storyId) {
    throw new Error(`Shipped story is missing epic/story id: ${JSON.stringify(story)}`);
  }

  return {
    epicId,
    storyId,
    title,
    outcome,
    sourcePath: story.sourcePath ?? story.source_path ?? `${stateDir()}/epics/${epicId}/stories/${storyId}.yaml`,
  };
}

export async function collectShippedStories({ epicIds, repoRoot = process.cwd() }) {
  if (!Array.isArray(epicIds) || epicIds.length === 0) {
    throw new Error('collectShippedStories requires at least one epic id');
  }

  const stories = [];
  for (const epicId of epicIds) {
    const storiesDir = path.join(repoRoot, stateDir(), 'epics', epicId, 'stories');
    let files;
    try {
      files = await fs.readdir(storiesDir);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Epic stories directory not found: ${storiesDir}`);
      }
      throw error;
    }

    for (const file of files.filter((name) => name.endsWith('.yaml')).sort()) {
      const fullPath = path.join(storiesDir, file);
      const text = await fs.readFile(fullPath, 'utf8');
      if (readScalar(text, 'status') !== 'shipped') continue;
      stories.push(storyFromYaml(epicId, file, text));
    }
  }

  return stories;
}

function formatLinks({ repoUrl, links = {} }) {
  const entries = [];
  if (repoUrl) entries.push(['Repository', repoUrl]);
  for (const [label, url] of Object.entries(links)) {
    if (url) entries.push([label, url]);
  }
  if (entries.length === 0) return '- No links configured.';
  return entries.map(([label, url]) => `- ${label}: ${url}`).join('\n');
}

function formatHighlights(stories) {
  if (stories.length === 0) return '- No shipped stories were found for this release.';
  return stories
    .map((story) => `- ${story.outcome} (${story.epicId}/${story.storyId})`)
    .join('\n');
}

function formatStoryTrace(stories) {
  if (stories.length === 0) return '- No shipped story trace entries.';
  return stories
    .map((story) => `- ${story.epicId}/${story.storyId}: ${story.title} - ${story.sourcePath}`)
    .join('\n');
}

function formatVideoHighlights(stories) {
  if (stories.length === 0) return '- No shipped-story highlights are available.';
  return stories
    .slice(0, 4)
    .map((story, index) => `${index + 1}. ${story.outcome} (${story.epicId}/${story.storyId})`)
    .join('\n');
}

function normalizeChannels(channels = DEFAULT_CHANNELS) {
  if (!Array.isArray(channels) || channels.length === 0) return DEFAULT_CHANNELS;
  return channels.map((channel) => {
    if (typeof channel === 'string') {
      return { name: channel, angle: 'Adapt the reusable highlights for this audience.' };
    }
    return {
      name: channel.name,
      angle: channel.angle ?? channel.highlightAngle ?? 'Adapt the reusable highlights for this audience.',
    };
  });
}

function formatChannelIdeas(channels, stories) {
  const leadStories = stories.slice(0, 3);
  const fallback = 'No shipped-story highlights are available.';
  return normalizeChannels(channels)
    .map((channel) => {
      const highlights =
        leadStories.length === 0
          ? `  - ${fallback}`
          : leadStories
              .map((story) => `  - Emphasize: ${story.outcome} (${story.epicId}/${story.storyId})`)
              .join('\n');
      return `### ${channel.name}\n\n- Angle: ${channel.angle}\n${highlights}`;
    })
    .join('\n\n');
}

function renderTemplate(template, values) {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key) => values[key] ?? match);
}

export function renderReleaseArtifacts({
  releaseId,
  projectName,
  repoUrl = '',
  links = {},
  channels = DEFAULT_CHANNELS,
  shippedStories = [],
  generatedAt = new Date().toISOString(),
}) {
  if (!releaseId) throw new Error('releaseId is required');
  if (!projectName) throw new Error('projectName is required');

  const stories = shippedStories.map(normalizeStory);
  const releaseTitle = `${projectName} ${releaseId}`;
  const values = {
    release_id: releaseId,
    project_name: projectName,
    release_title: releaseTitle,
    generated_at: generatedAt,
    release_intro:
      stories.length === 0
        ? `This release has no shipped stories to announce yet.`
        : `${projectName} ${releaseId} ships ${stories.length} story-derived improvement${stories.length === 1 ? '' : 's'}.`,
    highlights: formatHighlights(stories),
    story_trace: formatStoryTrace(stories),
    links: formatLinks({ repoUrl, links }),
    video_hook:
      stories.length === 0
        ? `Today we are checking whether ${projectName} has shipped work ready to announce.`
        : `Today we are shipping ${projectName} ${releaseId}: ${stories[0].outcome}`,
    video_highlights: formatVideoHighlights(stories),
    video_cta: repoUrl
      ? `Read the release details and try it from ${repoUrl}.`
      : `Read the release details and try the new release.`,
    channel_ideas: formatChannelIdeas(channels, stories),
  };

  return { values, stories };
}

export async function generateReleasePostArtifacts({
  epicIds,
  releaseId,
  projectName,
  repoUrl = '',
  links = {},
  channels = DEFAULT_CHANNELS,
  repoRoot = process.cwd(),
  templateDir = path.join(moduleRoot(), 'hive', 'references', 'release-post'),
  shippedStories,
  generatedAt,
}) {
  const stories = shippedStories
    ? shippedStories.map(normalizeStory)
    : await collectShippedStories({ epicIds, repoRoot });
  const { values } = renderReleaseArtifacts({
    releaseId,
    projectName,
    repoUrl,
    links,
    channels,
    shippedStories: stories,
    generatedAt,
  });

  const outDir = path.join(repoRoot, stateDir(), 'releases', releaseId);
  await fs.mkdir(outDir, { recursive: true });

  const written = [];
  for (const [templateName, outputName] of ARTIFACTS) {
    const template = await fs.readFile(path.join(templateDir, templateName), 'utf8');
    const rendered = `${renderTemplate(template, values).trim()}\n`;
    const outputPath = path.join(outDir, outputName);
    await fs.writeFile(outputPath, rendered, 'utf8');
    written.push(outputPath);
  }

  return { releaseId, outDir, written, stories };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = args[key] ? [].concat(args[key], next) : next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function splitCsv(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const channels = splitCsv(args.channels).map((name) => ({ name }));
  const result = await generateReleasePostArtifacts({
    epicIds: splitCsv(args.epics),
    releaseId: args['release-id'],
    projectName: args['project-name'],
    repoUrl: args['repo-url'] ?? '',
    channels,
    repoRoot: args['repo-root'] ?? process.cwd(),
  });
  console.log(JSON.stringify(result, null, 2));
}
