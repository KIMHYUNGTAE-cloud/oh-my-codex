#!/usr/bin/env python3
"""Opt-in real Codex skill pilot in a disposable project and private CODEX_HOME."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
CODEX = Path(shutil.which('codex') or '')
NODE = shutil.which('node')
USER_AUTH = Path.home() / '.codex/auth.json'
RUN = ROOT / '.local-tests' / ('skill-smoke-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
RUN.mkdir(parents=True, exist_ok=False)
RUN.chmod(0o700)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value if isinstance(value, str) else json.dumps(value, indent=2) + '\n')


def command(project, env, args, *, timeout=30):
    result = subprocess.run(args, cwd=project, env=env, text=True, capture_output=True, timeout=timeout, stdin=subprocess.DEVNULL)
    if result.returncode:
        raise RuntimeError(f'{args[:3]} failed: {result.stderr[-1500:]}')
    return result


def main(project, home):
    original_auth = sha(USER_AUTH)
    codex_home = home / '.codex'
    codex_home.mkdir(parents=True)
    auth = json.loads(USER_AUTH.read_text())
    auth['tokens']['refresh_token'] = ''
    save(codex_home / 'auth.json', auth)
    (codex_home / 'auth.json').chmod(0o600)
    save(codex_home / 'config.toml', f'''model = "gpt-6-luna"
model_reasoning_effort = "low"
cli_auth_credentials_store = "file"
approval_policy = "never"
sandbox_mode = "workspace-write"
[projects."{project}"]
trust_level = "trusted"
''')
    env = {'PATH': os.environ['PATH'], 'HOME': str(home), 'CODEX_HOME': str(codex_home), 'TMPDIR': str(home)}
    command(project, env, ['git', 'init', '-q'])
    save(project / 'schema.json', {'schemaVersion': 1, 'value': 11})
    save(project / 'evidence.txt', 'Independent project procedure requires checking schemaVersion and positive value.\n')
    save(project / 'stable.txt', 'stable')
    save(project / 'check.mjs', '''import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
if (process.argv[2] === 'reproduce') {
  const result = spawnSync('python3', ['.agents/skills/adaptive-schema-check/scripts/check.py', 'schema.json'], { encoding: 'utf8' });
  process.exit(result.status === 0 && result.stdout.includes('schema-ok:11') ? 0 : 1);
}
process.exit(fs.readFileSync('stable.txt', 'utf8') === 'stable' ? 0 : 1);
''')
    cli = [NODE, str(ROOT / 'bin/omx-adaptive.mjs'), 'evolve']
    command(project, env, cli + ['init'])
    policy_path = project / '.omx-project/policy.json'
    policy = json.loads(policy_path.read_text())
    policy['checks'] = [{'id': kind, 'kind': kind, 'categories': ['skills'], 'command': NODE,
                         'args': ['check.mjs', kind], 'timeoutMs': 3000} for kind in ['reproduce', 'regression']]
    save(policy_path, policy)
    evidence = {'id': 'schema-procedure', 'sessionId': 'pilot', 'taskId': 'fixture', 'type': 'user-correction',
                'summary': 'Schema verification must use the project checker',
                'evidence': [{'path': 'evidence.txt', 'sha256': sha(project / 'evidence.txt')}]}
    save(project / 'incident.json', evidence)
    command(project, env, cli + ['record', '--file', 'incident.json'])
    body = 'For fixture schema verification, run [the project checker](scripts/check.py) on schema.json. Report its exact marker and whether the check passed.'
    script = '''import json, sys
data = json.load(open(sys.argv[1]))
assert data['schemaVersion'] == 1 and isinstance(data['value'], int) and data['value'] > 0
print(f"schema-ok:{data['value']}")
'''
    files = {'scripts/check.py': script}
    source_digest = hashlib.sha256(json.dumps({'content': body, 'files': sorted(files.items())}, separators=(',', ':')).encode()).hexdigest()
    skill = {'id': 'schema-check', 'purpose': 'Verify fixture schema with the project checker',
             'activation': ['Asked to verify the fixture schema'], 'compatibility': {'runtimes': ['codex'], 'scope': 'project'},
             'dependencies': [], 'provenance': {'kind': 'project', 'origin': 'independent project verification procedure'},
             'source': {'content': body, 'digest': source_digest, 'files': files}}
    save(project / 'proposal.json', {'id': 'schema-skill', 'incidentIds': ['schema-procedure'],
                                    'reason': 'Make the verified checker discoverable in this project',
                                    'skills': {'schemaVersion': 1, 'skills': [skill]}})
    command(project, env, cli + ['propose', '--file', 'proposal.json'])
    evaluation = json.loads(command(project, env, cli + ['evaluate', '--proposal', 'schema-skill']).stdout)
    assert evaluation['state'] == 'ready'
    application = json.loads(command(project, env, cli + ['apply', '--proposal', 'schema-skill']).stdout)
    assert application['state'] == 'applied'
    # The authoring check used value 11. A fresh, independent case uses value 7.
    save(project / 'schema.json', {'schemaVersion': 1, 'value': 7})
    prompt = command(project, env, [str(CODEX), 'debug', 'prompt-input', 'Verify the fixture schema according to the project procedure.'], timeout=25)
    assert 'adaptive-schema-check' in prompt.stdout
    save(RUN / 'prompt.json', prompt.stdout)
    real = command(project, env, [str(CODEX), '-a', 'never', 'exec', '--skip-git-repo-check', '--sandbox', 'workspace-write',
                                  '-m', 'gpt-6-luna', '-c', 'model_reasoning_effort="low"', '-c', 'agents.enabled=false',
                                  '--json', '-o', str(RUN / 'final.txt'),
                                  'Verify the fixture schema according to the project procedure. Report the exact result marker and whether it passed.'], timeout=150)
    save(RUN / 'events.jsonl', real.stdout)
    save(RUN / 'stderr.log', real.stderr)
    answer = (RUN / 'final.txt').read_text()
    assert 'schema-ok:7' in answer, answer
    models, efforts, calls = set(), set(), []
    for path in codex_home.glob('sessions/**/*.jsonl'):
        for line in path.read_text().splitlines():
            event = json.loads(line)
            payload = event.get('payload', {})
            if event.get('type') in ['turn_context', 'session_meta']:
                if payload.get('model'): models.add(payload['model'])
                if payload.get('effort'): efforts.add(payload['effort'])
            if event.get('type') == 'response_item' and payload.get('type') == 'function_call':
                calls.append(payload.get('arguments', ''))
    for line in real.stdout.splitlines():
        event = json.loads(line)
        item = event.get('item', {})
        if event.get('type') == 'item.completed' and item.get('type') == 'command_execution':
            calls.append(item.get('command', ''))
    assert models == {'gpt-6-luna'} and efforts == {'low'}, (models, efforts)
    assert any('adaptive-schema-check/scripts/check.py' in str(call) for call in calls), 'Model did not invoke the generated skill script'
    assert sha(USER_AUTH) == original_auth
    return {'status': 'passed', 'evaluation': evaluation['state'], 'application': application['state'],
            'nativeLoader': True, 'independentCase': 'value 7; authoring check value 11',
            'observedModels': sorted(models), 'observedEfforts': sorted(efforts),
            'scriptInvoked': True, 'exactMarker': 'schema-ok:7', 'originalAuthUnchanged': True,
            'temporaryHomeRemoved': True}


if __name__ == '__main__':
    report = {'status': 'failed'}
    try:
        with tempfile.TemporaryDirectory(prefix='omx-adaptive-skill-pilot-') as temporary:
            workspace = Path(temporary)
            project = workspace / 'project'
            project.mkdir()
            report = main(project, workspace / 'home')
    except Exception as error:
        report['error'] = str(error)[-2000:]
    save(RUN / 'report.json', report)
    print(json.dumps({'report': str(RUN / 'report.json'), **report}))
    raise SystemExit(0 if report['status'] == 'passed' else 1)
