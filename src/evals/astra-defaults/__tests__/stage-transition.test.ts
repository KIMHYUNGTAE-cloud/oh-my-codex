import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { renderReport, summarize, weightedPassRates } from '../report.js';
import { baselineRecord, EvalSuiteError, loadRunRecords, loadSuite, validateRunRecords, validateSuite } from '../suite.js';
import { summarizeUsage } from '../usage.js';
import type { RunRecord, Usage } from '../types.js';

const mission = join(process.cwd(), 'missions/astra-default-evaluation');
const example = join(mission, 'examples/stage-transition');
const suite = loadSuite(mission, join(example, 'configs'));
const supplied = loadRunRecords(join(example, 'records.json'), suite);
const script = join(process.cwd(), 'dist/scripts/eval/eval-astra-defaults.js');

function record(): RunRecord {
  return structuredClone(supplied.records[0]);
}

function measured(): Usage {
  return { inputTokens: 100, outputTokens: 20, uncachedInputTokens: 70, cacheReadTokens: 30,
    cacheWriteTokens: 10, source: 'test receipt' };
}

function invalid(row: RunRecord, pattern: RegExp): void {
  assert.throws(() => validateRunRecords([row], suite), (error) =>
    error instanceof EvalSuiteError && pattern.test(error.message));
}

describe('stage configuration and supplied-record validation', () => {
  it('loads old configurations unchanged and leaves new observations unknown', () => {
    const legacy = loadSuite(mission);
    assert.equal(legacy.configs.length, 6);
    assert.ok(legacy.configs.every((config) => config.stages === undefined));
    const fixture = legacy.fixtures.find((entry) => entry.deterministicBaseline)!;
    const old = { ...baselineRecord(fixture), usage: { inputTokens: 0, outputTokens: 0 } };
    assert.deepEqual(validateRunRecords([old], legacy), [old]);
    const report = renderReport(legacy, [old]);
    assert.match(report, /unknown \| unknown \| unknown \| unknown \|/);
    assert.match(report, /No complete cost claim/);
    assert.equal(summarize([old], old.configId).usageAttributionComplete, false);
  });

  it('keeps configs separate from fixture quality and rejects duplicate/malformed stages', () => {
    assert.equal(suite.fixtures.some((entry) => String(entry.surface) === 'planner'), false);
    for (const change of ['duplicate-stage', 'bad-pair', 'duplicate-config']) {
      const bad = structuredClone(suite);
      if (change === 'duplicate-stage') bad.configs[0].stages!.push(bad.configs[0].stages![0]);
      if (change === 'bad-pair') bad.configs[0].stages![0].requested.reasoningEffort = '';
      if (change === 'duplicate-config') bad.configs[1].id = bad.configs[0].id;
      assert.throws(() => validateSuite(bad), EvalSuiteError);
    }
  });

  it('requires exactly the declared stages, with null evidence for unavailable stages', () => {
    const row = record();
    row.stages!.pop();
    invalid(row, /stages must match/);
    row.stages = record().stages;
    row.stages![1] = { stageId: 'executor', usage: null, latencyMs: null };
    assert.doesNotThrow(() => validateRunRecords([row], suite));
    row.stages![1].stageId = 'planner';
    invalid(row, /duplicate stage/);
  });

  it('requires workflow identity and one accounting scope', () => {
    const row = record();
    delete row.workflowId;
    invalid(row, /workflowId and usageScope/);
    row.workflowId = 'one';
    row.usage = measured();
    invalid(row, /workflow usage to be null/);
    delete row.stages;
    invalid(row, /requires stages/);
  });

  it('rejects unsupported repetitions before reporting or weighting can overcount', () => {
    const rows = [record(), { ...record(), workflowId: 'second-trial' }];
    assert.throws(() => renderReport(suite, rows), /repeated trials unsupported/);
    assert.throws(() => summarize(rows, rows[0].configId), /repeated trials unsupported/);
    assert.throws(() => weightedPassRates(suite, rows, { 'executor-bounded-change': 1 }), /repeated trials unsupported/);
  });

  it('rejects unknown identities, mismatched response checks and stray record fields', () => {
    const row = record();
    row.fixtureId = 'missing';
    invalid(row, /unknown fixture or config/);
    row.fixtureId = record().fixtureId;
    row.checks = [];
    invalid(row, /checks must match/);
    assert.throws(() => validateRunRecords([{ ...record(), stageId: 'accidental-task-row' }], suite), EvalSuiteError);
  });

  it('rejects invalid numeric input through the shared boundary', () => {
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '10']) {
      const row = record();
      row.stages![0].usage!.inputTokens = value as number;
      invalid(row, /inputTokens/);
    }
    for (const field of ['latencyMs', 'operatorMinutes', 'retries'] as const) {
      const row = record();
      row[field] = -1;
      invalid(row, new RegExp(field));
    }
    for (const field of ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
      const row = record();
      row.stages![0].usage![field] = Infinity;
      invalid(row, new RegExp(field));
    }
  });

  it('requires breakdown provenance and consistent inclusive input', () => {
    const row = record();
    row.stages![0].usage = measured();
    delete row.stages![0].usage.source;
    invalid(row, /requires a source/);
    row.stages![0].usage = { ...measured(), cacheReadTokens: 50 };
    invalid(row, /subsets exceed/);
    row.stages![0].usage = { ...measured(), cacheReadTokens: 20 };
    invalid(row, /must equal/);
    row.stages![0].usage = { ...measured(), uncachedInputTokens: 'not-applicable', cacheReadTokens: 'not-applicable' };
    invalid(row, /must equal/);
  });
});

describe('observation and accounting reports', () => {
  it('preserves requested, launch-resolved and runtime-observed differences and sources', () => {
    const report = renderReport(suite, supplied.records, null, 'synthetic');
    const executor = report.split('\n').find((line) => line.includes('split-pair / executor'))!;
    assert.match(executor, /gpt-5.6-terra \/ medium/);
    assert.match(executor, /proposed agentModels.executor \/ proposed agentReasoning.executor/);
    assert.match(executor, /gpt-5.6-sol \/ high \(synthetic explicit launch override/);
    assert.match(executor, /gpt-6-astra \/ unknown \(synthetic runtime receipt/);
    const missing = report.split('\n').find((line) => line.includes('continue-pair / executor'))!;
    assert.match(missing, /synthetic launch receipt\) \| unknown \|$/);
    assert.match(report, /Synthetic supplied observations/);
  });

  it('counts a staged workflow once without adding input subsets or reasoning twice', () => {
    const row = record();
    row.stages!.forEach((stage) => { stage.usage = measured(); });
    const summary = summarize([row], row.configId);
    assert.deepEqual([summary.total, summary.passed], [1, 1]);
    assert.deepEqual(summary.totalUsage, { inputTokens: 200, outputTokens: 40 });
    assert.equal(summary.usageBreakdown.cacheReadTokens.known, 60);
    assert.equal(summary.usageBreakdown.cacheWriteTokens.known, 20);
    assert.equal(summary.usageAttributionComplete, true);
    assert.equal(summary.totalLatencyMs, 250); // Stage durations sum to 300.
    assert.equal(summary.totalOperatorMinutes, 2);
    assert.deepEqual(weightedPassRates(suite, [row], { 'executor-bounded-change': 1 }),
      [{ configId: row.configId, weightedPassRate: 1 }]);
  });

  it('uses only workflow totals when stages are non-additive detail', () => {
    const row = record();
    row.usageScope = 'workflow';
    row.usage = measured();
    row.stages![0].usage = null;
    const summary = summarize([row], row.configId);
    assert.deepEqual(summary.totalUsage, { inputTokens: 100, outputTokens: 20 });
    assert.equal(summary.usageAttributionComplete, true);
    assert.match(renderReport(suite, [row]), /planner \(detail only\)/);
  });

  it('preserves zero, partial sums, unsupported and missing stage evidence separately', () => {
    const row = record();
    row.stages![0].usage = { ...measured(), cacheWriteTokens: 0 };
    row.stages![1].usage = null;
    const summary = summarize([row], row.configId);
    assert.equal(summary.totalUsage, null);
    assert.deepEqual(summary.usageBreakdown.cacheWriteTokens,
      { known: 0, complete: false, unknown: 1, unsupported: 0, notApplicable: 0 });
    assert.equal(summary.usageAttributionComplete, false);
    assert.match(renderReport(suite, [row]), /0 known; 1 unknown/);
    const parts = summarizeUsage([measured(), { ...measured(), cacheWriteTokens: 'unsupported' }]);
    assert.equal(parts.cacheWriteTokens.known, 10);
    assert.equal(parts.cacheWriteTokens.unsupported, 1);
    assert.equal(parts.cacheWriteTokens.complete, false);
    assert.equal(summarizeUsage([{ ...measured(), cacheWriteTokens: 'not-applicable' }]).cacheWriteTokens.known, null);
  });

  it('keeps an available cache-read zero when uncached/write measurements are absent', () => {
    const row = structuredClone(supplied.records[1]);
    const summary = summarize([row], row.configId);
    assert.equal(summary.usageBreakdown.cacheReadTokens.complete, true);
    assert.equal(summary.usageBreakdown.uncachedInputTokens.known, 80);
    assert.equal(summary.usageBreakdown.uncachedInputTokens.complete, false);
    assert.match(renderReport(suite, [row]), /80 known; 1 unknown/);
  });

  it('does not let a response-content pass imply required checks or cost completeness', () => {
    const report = renderReport(suite, supplied.records);
    assert.match(report, /\| pass \| unknown \|/);
    assert.match(report, /\| pass \| fail \|/);
    assert.match(report, /Required checks: fail; declared outcome is not verified completion/);
    assert.match(report, /No complete cost claim/);
    assert.match(report, /No model quality, cost, or savings conclusion/);
  });

  it('keeps externally supplied provenance inside its Markdown table cell', () => {
    const row = record();
    row.stages![0].runtimeObserved!.source = 'receipt | field\n<unknown>';
    const report = renderReport(suite, [row]);
    assert.match(report, /receipt &#124; field &lt;unknown&gt;/);
    assert.equal(row.stages![0].runtimeObserved!.source, 'receipt | field\n<unknown>');
  });

  it('rejects unsafe token sums and refuses invalid frequency weights', () => {
    const row = record();
    row.stages!.forEach((stage) => { stage.usage = { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 0 }; });
    assert.throws(() => summarize([row], row.configId), /unsafe aggregate inputTokens/);
    for (const value of [-1, Infinity, NaN]) {
      assert.equal(weightedPassRates(suite, [record()], { 'executor-bounded-change': value }), null);
    }
  });
});

describe('model-free report entrypoint', () => {
  it('preserves the default evaluator JSON contract', () => {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf-8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { pass: true, score: 1, fixtures: 6, configs: 6, deterministicBaselines: 2 });
  });

  it('reproduces supplied records plus existing deterministic baselines byte for byte', () => {
    const args = [script, '--report', join(example, 'records.json'), '--configs', join(example, 'configs')];
    const first = spawnSync(process.execPath, args, { encoding: 'utf-8' });
    const second = spawnSync(process.execPath, args, { encoding: 'utf-8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(first.stdout, second.stdout);
    assert.equal(first.stdout, readFileSync(join(example, 'report.md'), 'utf-8'));
    assert.match(first.stdout, /deterministic-no-model/);
  });

  it('reports supplied records without baselines while the default evaluator still requires them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omx-eval-no-baselines-'));
    try {
      mkdirSync(join(dir, 'fixtures'));
      mkdirSync(join(dir, 'configs'));
      for (const fixture of suite.fixtures) {
        const custom = { ...fixture };
        delete custom.deterministicBaseline;
        writeFileSync(join(dir, 'fixtures', `${custom.id}.json`), JSON.stringify(custom));
      }
      for (const config of suite.configs) {
        writeFileSync(join(dir, 'configs', `${config.id}.json`), JSON.stringify(config));
      }
      const result = spawnSync(process.execPath,
        [script, dir, '--report', join(example, 'records.json')], { encoding: 'utf-8' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, `${renderReport(loadSuite(dir), supplied.records, null, supplied.evidence)}\n`);
      assert.doesNotMatch(result.stdout, /deterministic-no-model/);

      const defaultResult = spawnSync(process.execPath, [script, dir], { encoding: 'utf-8' });
      assert.equal(defaultResult.status, 1);
      assert.match(defaultResult.stderr, /suite declares no deterministic no-model baseline/);
      assert.deepEqual(JSON.parse(defaultResult.stdout), { pass: false, score: 0 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails invalid external records and arguments without a success report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omx-eval-records-'));
    try {
      const path = join(dir, 'records.json');
      const row = record();
      row.stages![0].usage!.inputTokens = -5;
      writeFileSync(path, JSON.stringify({ evidence: 'synthetic', records: [row] }));
      const result = spawnSync(process.execPath,
        [script, '--report', path, '--configs', join(example, 'configs')], { encoding: 'utf-8' });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /inputTokens/);
      assert.deepEqual(JSON.parse(result.stdout), { pass: false, score: 0 });
      const invalidArgs = spawnSync(process.execPath, [script, '--live'], { encoding: 'utf-8' });
      assert.equal(invalidArgs.status, 1);
      assert.match(invalidArgs.stderr, /usage:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
