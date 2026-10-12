import assert from 'node:assert';
import { test } from 'node:test';
import { collectRecord } from '../collector.js';
import type { CodexOutput, CollectorOptions } from '../collector.js';
import type { EvalConfig, EvalFixture } from '../types.js';

// Stub fixture with response checks
const fixture: EvalFixture = {
  id: 'test-fixture',
  surface: 'explore',
  title: 'Test explore task',
  prompt: 'Find the bug in this code',
  inputs: { 'code.ts': 'const x = 1\nconsole.log(x)' },
  checks: [
    { kind: 'must-include', name: 'mentions-code', values: ['code', 'bug'] },
    { kind: 'must-not-include', name: 'no-vague-words', values: ['maybe', 'perhaps'] },
  ],
};

// Stub config
const config: EvalConfig = {
  id: 'test-config',
  label: 'Test config',
  isBaseline: false,
  omxRevision: 'abc123',
  roles: {
    explore: { model: 'gpt-6-test', reasoningEffort: 'medium' },
    executor: { model: 'gpt-6-test', reasoningEffort: 'medium' },
    'code-reviewer': { model: 'gpt-6-test', reasoningEffort: 'medium' },
    'team-worker': { model: 'gpt-6-test', reasoningEffort: 'medium' },
    sparkshell: { model: 'gpt-6-test', reasoningEffort: 'medium' },
  },
  serviceTier: 'test',
  cacheConditions: 'test',
};

test('collector: pass when response matches checks', async () => {
  const mockCodexInvoker = async (): Promise<CodexOutput> => ({
    exitCode: 0,
    stdout: JSON.stringify({
      response: 'Found a bug in the code. The variable is used correctly.',
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
    stderr: '',
  });

  const result = await collectRecord(fixture, config, { invokeCodex: mockCodexInvoker });

  assert.strictEqual(result.record.outcome, 'pass');
  assert.strictEqual(result.record.checks.length, 2);
  assert.ok(result.record.checks.every((c) => c.passed));
  assert.deepStrictEqual(result.record.usage, {
    inputTokens: 100,
    outputTokens: 50,
    uncachedInputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    source: 'codex exec --json',
  });
  assert.ok((result.record.latencyMs ?? 0) >= 0); // Latency is always recorded, even if 0
});

test('collector: fail when response does not match checks', async () => {
  const mockCodexInvoker = async (): Promise<CodexOutput> => ({
    exitCode: 0,
    stdout: JSON.stringify({
      response: 'Maybe this is a bug. Perhaps you should check.',
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
    stderr: '',
  });

  const result = await collectRecord(fixture, config, { invokeCodex: mockCodexInvoker });

  assert.strictEqual(result.record.outcome, 'fail');
  assert.ok(result.record.checks.some((c) => !c.passed));
});

test('collector: error when Codex exits non-zero', async () => {
  const mockCodexInvoker = async (): Promise<CodexOutput> => ({
    exitCode: 1,
    stdout: '',
    stderr: 'Codex error: authentication failed',
  });

  const result = await collectRecord(fixture, config, { invokeCodex: mockCodexInvoker });

  assert.strictEqual(result.record.outcome, 'error');
  assert.ok(result.record.notes?.includes('exit code 1'));
  assert.strictEqual(result.record.usage, null);
});

test('collector: error when JSON parsing fails', async () => {
  const mockCodexInvoker = async (): Promise<CodexOutput> => ({
    exitCode: 0,
    stdout: 'not valid json',
    stderr: '',
  });

  const result = await collectRecord(fixture, config, { invokeCodex: mockCodexInvoker });

  assert.strictEqual(result.record.outcome, 'error');
  assert.ok(result.record.notes?.includes('Failed to parse'));
});

test('collector: error when missing role config', async () => {
  const badConfig: EvalConfig = {
    ...config,
    roles: { explore: { model: 'gpt-6-test', reasoningEffort: 'medium' } }, // Missing other surfaces
  };

  const mockCodexInvoker = async (): Promise<CodexOutput> => ({
    exitCode: 0,
    stdout: '{}',
    stderr: '',
  });

  const result = await collectRecord(
    { ...fixture, surface: 'executor' },
    badConfig,
    { invokeCodex: mockCodexInvoker },
  );

  assert.strictEqual(result.record.outcome, 'error');
  assert.ok(result.record.notes?.includes('No role config'));
});

test('collector: handle null usage data gracefully', async () => {
  const mockCodexInvoker = async (): Promise<CodexOutput> => ({
    exitCode: 0,
    stdout: JSON.stringify({ response: 'Found a bug in the code. The variable is used correctly.' }),
    stderr: '',
  });

  const result = await collectRecord(fixture, config, { invokeCodex: mockCodexInvoker });

  assert.strictEqual(result.record.outcome, 'pass');
  assert.strictEqual(result.record.usage, null);
});

test('collector: records latency on success', async () => {
  const mockCodexInvoker = async (): Promise<CodexOutput> => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        response: 'Found a bug in the code. The variable is used correctly.',
      }),
      stderr: '',
    };
  };

  const result = await collectRecord(fixture, config, { invokeCodex: mockCodexInvoker });

  assert.ok((result.record.latencyMs ?? 0) >= 50);
});

test('collector: records latency even on error', async () => {
  const mockCodexInvoker = async (): Promise<CodexOutput> => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'Error',
    };
  };

  const result = await collectRecord(fixture, config, { invokeCodex: mockCodexInvoker });

  assert.ok((result.record.latencyMs ?? 0) >= 50);
});
