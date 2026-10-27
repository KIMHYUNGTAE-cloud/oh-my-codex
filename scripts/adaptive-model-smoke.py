#!/usr/bin/env python3
"""Opt-in real-account pilot. Writes only below .local-tests; never changes user auth.

Run after npm run build. Uses the existing configured model, with an ephemeral
private auth file stripped of refresh credentials, deleted after each model call.
This is a functional pilot, not statistical evidence of general quality gains.
"""
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import time
import tomllib
import uuid

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / '.local-tests' / ('model-smoke-' + uuid.uuid4().hex[:8])
PROJECT = RUN / 'project'
HOME_DIR = RUN / 'home'
CODEX_DIR = HOME_DIR / '.codex'
CLI = ROOT / 'bin/omx-adaptive.mjs'
NODE = shutil.which('node') or 'node'
USER_CODEX = Path(os.environ.get('ADAPTIVE_TEST_AUTH_HOME', str(Path.home() / '.codex')))
CODEX = Path(os.environ.get('ADAPTIVE_TEST_CODEX_BIN', shutil.which('codex') or 'codex')).resolve()
TAG = 'QA-' + uuid.uuid4().hex[:12]


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n' if not isinstance(value, str) else value)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def env():
    return {'PATH': os.environ['PATH'], 'HOME': str(HOME_DIR), 'CODEX_HOME': str(CODEX_DIR),
            'LANG': 'en_US.UTF-8', 'TMPDIR': str(RUN / 'tmp')}


def evolve(*args):
    result = subprocess.run([NODE, str(CLI), 'evolve', *args], cwd=PROJECT, env=env(),
                            text=True, capture_output=True, timeout=90)
    if result.returncode:
        raise RuntimeError(result.stderr[-2000:])
    return json.loads(result.stdout)


def model(phase, prompt, schema):
    auth = json.loads((USER_CODEX / 'auth.json').read_text())
    # The currently valid access token suffices; never rotate the user's refresh token.
    auth['tokens']['refresh_token'] = ''
    auth_path = CODEX_DIR / 'auth.json'
    auth_path.write_text(json.dumps(auth))
    auth_path.chmod(0o600)
    schema_path = RUN / f'{phase}-schema.json'
    output = RUN / f'{phase}-final.json'
    write(schema_path, schema)
    command = [str(CODEX), '-a', 'never', 'exec', '--ignore-user-config', '--ignore-rules',
               '--ephemeral', '--skip-git-repo-check', '--sandbox', 'workspace-write',
               '--enable', 'hooks', '--dangerously-bypass-hook-trust',
               '-m', MODEL, '-c', 'model_reasoning_effort="medium"',
               '-c', 'cli_auth_credentials_store="file"',
               '-c', 'shell_environment_policy.inherit="none"',
               '-c', 'shell_environment_policy.set={PATH=' + json.dumps(os.environ['PATH']) + ',HOME=' + json.dumps(str(HOME_DIR)) + ',CODEX_HOME=' + json.dumps(str(CODEX_DIR)) + '}',
               '--json', '--output-schema', str(schema_path), '-o', str(output), prompt]
    started = time.monotonic()
    try:
        result = subprocess.run(command, cwd=PROJECT, env=env(), text=True,
                                capture_output=True, timeout=150, stdin=subprocess.DEVNULL)
    finally:
        auth_path.unlink(missing_ok=True)
    stdout, stderr = result.stdout, result.stderr
    for value in auth.get('tokens', {}).values():
        if isinstance(value, str) and len(value) > 30:
            stdout, stderr = stdout.replace(value, '[REDACTED]'), stderr.replace(value, '[REDACTED]')
    write(RUN / f'{phase}-events.jsonl', stdout)
    write(RUN / f'{phase}-stderr.log', stderr)
    if result.returncode:
        raise RuntimeError(f'{phase}: Codex exit {result.returncode}; see isolated stderr log')
    events = [json.loads(line) for line in stdout.splitlines() if line.startswith('{')]
    turns = [event for event in events if event.get('type') == 'turn.completed']
    commands = [event['item'] for event in events if event.get('type') == 'item.completed'
                and event.get('item', {}).get('type') == 'command_execution']
    final = json.loads(output.read_text())
    observation = {'phase': phase, 'model': MODEL, 'reasoningEffort': 'medium', 'final': final,
                   'elapsedSeconds': round(time.monotonic() - started, 2),
                   'usage': [turn.get('usage') for turn in turns],
                   'commands': [{'command': c.get('command'), 'exitCode': c.get('exit_code')} for c in commands]}
    print(json.dumps({'phase': phase, 'completed': True}), flush=True)
    return observation


if __name__ == '__main__':
    PROJECT.mkdir(parents=True)
    CODEX_DIR.mkdir(parents=True, mode=0o700)
    (RUN / 'tmp').mkdir()
    RUN.chmod(0o700)
    original_auth_sha = sha(USER_CODEX / 'auth.json')
    MODEL = tomllib.loads((USER_CODEX / 'config.toml').read_text()).get('model', 'gpt-6.1-sol')
    observations = []
    report = {'model': MODEL, 'reasoningEffort': 'medium', 'modelSelection': 'snapshot-at-pilot-start', 'kind': 'real-model-functional-pilot', 'status': 'running',
              'generalQualityImprovement': 'not-established', 'run': str(RUN)}
    try:
        write(PROJECT / 'check.mjs', "import assert from 'node:assert/strict'; assert.equal(2+3,5); console.log('CHECK-PASSED');\n")
        write(PROJECT / 'note.txt', 'The project codename is Cedar.\n')
        evolve('init')
        # Only test-harness hook registrations are installed, in the isolated CODEX_HOME.
        hook = RUN / 'hook.py'
        write(hook, f'''import json,sys,subprocess,pathlib
p=json.load(sys.stdin)
r=subprocess.run([{NODE!r},{str(CLI)!r},'evolve','hook'],input=json.dumps(p),text=True,capture_output=True)
if r.returncode: sys.stderr.write(r.stderr);sys.exit(r.returncode)
context=json.loads(r.stdout).get('hookSpecificOutput',{{}}).get('additionalContext','')
with pathlib.Path({str(RUN / 'hook-deliveries.jsonl')!r}).open('a') as f:
 f.write(json.dumps({{'event':p.get('hook_event_name'),'containsTag':{TAG!r} in context,'contextChars':len(context)}})+'\\n')
print(r.stdout)
''')
        handler = {'type': 'command', 'command': 'python3 ' + shlex.quote(str(hook))}
        write(CODEX_DIR / 'hooks.json', {'hooks': {event: [{'hooks': [handler]}] for event in ['SessionStart', 'UserPromptSubmit']}})
        schema = {'type': 'object', 'additionalProperties': False,
                  'properties': {'ok': {'type': 'boolean'}, 'summary': {'type': 'string'}, 'auditTag': {'type': 'string'}},
                  'required': ['ok', 'summary', 'auditTag']}
        task = 'Run node check.mjs and report the observed result. Return ok, summary, auditTag. Use an empty auditTag unless applicable project guidance specifies one. Do not change any files.'
        observations.append(model('baseline', task, schema))
        assert observations[-1]['final']['ok'] and observations[-1]['final']['auditTag'] == ''
        # The first model session records a synthetic user correction, without applying it.
        seed = f'''This isolated fixture receives a user correction: when running project tests or node check.mjs, include auditTag {TAG} in the final JSON report after tests succeed. This convention applies only to test work.
Record the correction and propose its persistent procedure using node {shlex.quote(str(CLI))} evolve. Do not evaluate or apply yet.
Write user-correction.md as evidence. Compute its SHA256. Write incident.json with {{id:"audit-correction",sessionId:"fixture-seed",taskId:"qa-report",type:"user-correction",summary:...,evidence:[{{path:"user-correction.md",sha256:...}}]}} and call record --file incident.json.
Write proposal.json with {{id:"audit-procedure",incidentIds:["audit-correction"],reason:...,entry:{{id:"qa-report",kind:"procedure",title:"Project QA reporting",content:...,when:["node check.mjs","project tests"]}}}} and call propose --file proposal.json. Include the exact tag and scope in content. Return recorded:true and proposalId:"audit-procedure" only after both commands succeed.'''
        seed_schema = {'type': 'object', 'additionalProperties': False, 'properties': {'recorded': {'type': 'boolean'}, 'proposalId': {'type': 'string'}}, 'required': ['recorded', 'proposalId']}
        observations.append(model('correction', seed, seed_schema))
        assert observations[-1]['final'] == {'recorded': True, 'proposalId': 'audit-procedure'}
        assert evolve('status')['incidents'] == 1
        # Deterministic checks validate the proposed policy and unchanged application tests.
        # Actual model behavior is assessed separately below, never inferred from these checks.
        write(PROJECT / 'evaluate-policy.mjs', f'''import fs from 'node:fs'; import {{spawnSync}} from 'node:child_process';
if(process.argv[2]==='reproduce'){{const g=JSON.parse(fs.readFileSync('.omx-project/guidance.json','utf8'));process.exit(g.entries.some(e=>e.id==='qa-report'&&e.content.includes({json.dumps(TAG)}))?0:1);}}
if(process.argv[2]==='regression')process.exit(spawnSync(process.execPath,['check.mjs']).status??1);
''')
        policy_path = PROJECT / '.omx-project/policy.json'
        policy = json.loads(policy_path.read_text())
        policy['checks'] = [{'id': kind, 'kind': kind, 'command': NODE, 'args': ['evaluate-policy.mjs', kind], 'timeoutMs': 3000} for kind in ['reproduce', 'regression']]
        write(policy_path, policy)
        evaluation = evolve('evaluate', '--proposal', 'audit-procedure')
        assert evaluation['state'] == 'ready'
        application = evolve('apply', '--proposal', 'audit-procedure', '--automatic')
        assert application['state'] == 'applied'
        observations.append(model('new-session', task, schema))
        assert observations[-1]['final']['ok'] and observations[-1]['final']['auditTag'] == TAG
        assert any('node check.mjs' in str(c['command']) and c['exitCode'] == 0 for c in observations[-1]['commands'])
        deliveries = [json.loads(line) for line in (RUN / 'hook-deliveries.jsonl').read_text().splitlines()]
        assert any(d['event'] == 'UserPromptSubmit' and d['containsTag'] for d in deliveries), 'real prompt hook must deliver the accepted procedure'
        observations.append(model('unrelated', 'Read note.txt and report its codename. Do not run tests or change files. Return ok, summary, auditTag, using an empty auditTag unless project guidance applicable to this task specifies one.', schema))
        assert observations[-1]['final']['ok'] and 'Cedar' in observations[-1]['final']['summary'] and observations[-1]['final']['auditTag'] == ''
        evolve('rollback', '--proposal', 'audit-procedure')
        observations.append(model('after-rollback', task, schema))
        assert observations[-1]['final']['ok'] and observations[-1]['final']['auditTag'] == ''
        report.update(status='passed', evaluation=evaluation, application=application,
                      observations=observations, hookDeliveries=deliveries,
                      assertions=['baseline-no-convention', 'model-recorded-correction', 'evaluation-and-apply',
                                  'fresh-session-used-native-hook-guidance-and-executed-tests',
                                  'unrelated-task-unaffected', 'rollback-removed-convention'])
    except Exception as error:
        report.update(status='failed', error=str(error), observations=observations)
        raise
    finally:
        (CODEX_DIR / 'auth.json').unlink(missing_ok=True)
        report['originalAuthUnchanged'] = sha(USER_CODEX / 'auth.json') == original_auth_sha
        report['temporaryAuthRemoved'] = not (CODEX_DIR / 'auth.json').exists()
        write(RUN / 'report.json', report)
        print(json.dumps({'status': report['status'], 'report': str(RUN / 'report.json')}), flush=True)
