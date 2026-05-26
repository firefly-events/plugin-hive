import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { resolveEnvPath, resolveCustomEnv } from '../../hive/lib/multica-bootstrap/index.mjs';

test('resolveEnvPath expands leading tilde to home dir', () => {
  const home = os.homedir();
  assert.equal(resolveEnvPath('~/.claude/plugins'), `${home}/.claude/plugins`);
  assert.equal(resolveEnvPath('~'), home);
});

test('resolveEnvPath expands ${HOME} anywhere in the value', () => {
  const home = os.homedir();
  assert.equal(resolveEnvPath('${HOME}/.claude/plugins'), `${home}/.claude/plugins`);
  assert.equal(resolveEnvPath('/opt${HOME}/x'), `/opt${home}/x`);
});

test('resolveEnvPath expands bare $HOME but not $HOMEBREW_PREFIX', () => {
  const home = os.homedir();
  assert.equal(resolveEnvPath('$HOME/.claude/plugins'), `${home}/.claude/plugins`);
  assert.equal(resolveEnvPath('$HOMEBREW_PREFIX/bin'), '$HOMEBREW_PREFIX/bin');
});

test('resolveEnvPath returns non-string values unchanged', () => {
  assert.equal(resolveEnvPath(undefined), undefined);
  assert.equal(resolveEnvPath(null), null);
  assert.equal(resolveEnvPath(42), 42);
});

test('resolveCustomEnv resolves every string value in the map', () => {
  const home = os.homedir();
  const out = resolveCustomEnv({
    CLAUDE_PLUGIN_PATH: '${HOME}/.claude/plugins',
    OTHER_PATH: '~/other',
    LITERAL: '/abs/path',
  });
  assert.deepEqual(out, {
    CLAUDE_PLUGIN_PATH: `${home}/.claude/plugins`,
    OTHER_PATH: `${home}/other`,
    LITERAL: '/abs/path',
  });
});

test('resolveCustomEnv returns input unchanged when not a map', () => {
  assert.equal(resolveCustomEnv(null), null);
  assert.equal(resolveCustomEnv(undefined), undefined);
});
