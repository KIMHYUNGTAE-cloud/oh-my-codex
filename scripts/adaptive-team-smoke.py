#!/usr/bin/env python3
"""Opt-in actual OMX/Codex team pilot. Requires a test-local tmux or ADAPTIVE_TEST_TMUX.

Uses an isolated tmux server and HOME. Never changes installed OMX or shared Codex
configuration. Authentication has no refresh token and is removed in finally.
"""
import hashlib
import json
import os
import re
from pathlib import Path
import shlex
import shutil
import subprocess
import time
import tomllib
import uuid

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / '.local-tests' / ('team-smoke-' + uuid.uuid4().hex[:8])
PROJECT, HOME_DIR = RUN / 'project', RUN / 'home'
CODEX_DIR, BIN = HOME_DIR / '.codex', RUN / 'bin'
CLI = ROOT / 'bin/omx-adaptive.mjs'
NODE = shutil.which('node')
USER_CODEX = Path(os.environ.get('ADAPTIVE_TEST_AUTH_HOME', str(Path.home() / '.codex')))
CODEX = Path(os.environ.get('ADAPTIVE_TEST_CODEX_BIN', shutil.which('codex'))).resolve()
TMUX = Path(os.environ.get('ADAPTIVE_TEST_TMUX', str(ROOT / '.local-tests/tools/bin/tmux')))
SOCKET = 'adaptive-' + uuid.uuid4().hex[:10]


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value if isinstance(value, str) else json.dumps(value, indent=2) + '\n')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def env():
    return {'HOME': str(HOME_DIR), 'CODEX_HOME': str(CODEX_DIR), 'PATH': str(BIN) + ':' + os.environ['PATH'],
            'LANG': 'en_US.UTF-8', 'TERM': 'xterm-256color', 'SHELL': '/bin/sh', 'TMPDIR': str(RUN / 'tmp'),
            'OMX_ENTRY_PATH': str(ROOT / 'dist/cli/omx.js'), 'OMX_TMUX_SOURCE_SHELL_RC': '0',
            'OMX_TEAM_WORKER_CLI': 'codex', 'OMX_TEAM_READY_TIMEOUT_MS': '60000',
            'OMX_TEAM_STARTUP_EVIDENCE_TIMEOUT_MS': '60000',
            'OMX_TEAM_WORKER_LAUNCH_ARGS': '--sandbox workspace-write --ask-for-approval never'}


def tmux(*args, check=True):
    return subprocess.run([str(TMUX), '-L', SOCKET, '-f', '/dev/null', *args], env=env(), cwd=PROJECT,
                          text=True, capture_output=True, check=check, timeout=15)


if __name__ == '__main__':
    for path in [PROJECT, CODEX_DIR, BIN, RUN / 'tmp']:
        path.mkdir(parents=True, exist_ok=True)
    RUN.chmod(0o700)
    original = sha(USER_CODEX / 'auth.json')
    report = {'kind': 'actual-omx-team-model-pilot', 'run': str(RUN), 'status': 'running', 'savings': 'not-established'}
    auth_path = CODEX_DIR / 'auth.json'
    auth = {}
    try:
        auth = json.loads((USER_CODEX / 'auth.json').read_text())
        auth['tokens']['refresh_token'] = ''
        write(auth_path, auth)
        auth_path.chmod(0o600)
        main_model = tomllib.loads((USER_CODEX / 'config.toml').read_text())['model']
        write(CODEX_DIR / 'config.toml', f'''model = {json.dumps(main_model)}
model_reasoning_effort = "medium"
cli_auth_credentials_store = "file"
approval_policy = "never"
sandbox_mode = "workspace-write"
[projects.{json.dumps(str(PROJECT))}]
trust_level = "trusted"
[shell_environment_policy]
inherit = "all"
''')
        shutil.copytree(ROOT / 'skills/worker', CODEX_DIR / 'skills/worker')
        for name, command in [('codex', [str(CODEX)]), ('omx', [NODE, str(CLI)]), ('tmux', [str(TMUX), '-L', SOCKET, '-f', '/dev/null'])]:
            write(BIN / name, '#!/bin/sh\nexec ' + shlex.join(command) + ' "$@"\n')
            (BIN / name).chmod(0o700)
        subprocess.run(['git', 'init', '-q'], cwd=PROJECT, env=env(), check=True)
        write(PROJECT / 'AGENTS.md', '# Isolated verification fixture\nUse only assigned inputs. Do not spawn child agents. Follow the OMX worker protocol.\n')
        write(PROJECT / 'rows.csv', 'id,value\n1,5\n2,7\n3,11\n')
        write(PROJECT / 'settings.json', {'schemaVersion': 1, 'enabled': True, 'limit': 3})
        role_base = {'activation': ['Assigned fixture audit'], 'inputs': ['Assigned context'], 'outputs': ['Verified concise result'],
                     'verification': ['Execute a Python assertion against the assigned input'], 'scope': 'read-only', 'modelTier': 'economy',
                     'instructions': 'Read only assigned data. Run a short Python assertion. Complete the task through OMX team API with exact findings. Do not edit product files. Remain idle afterwards for shutdown.'}
        roles = [{**role_base, 'id': 'row-auditor', 'purpose': 'Count and sum tabular records', 'capabilities': ['row-audit']},
                 {**role_base, 'id': 'settings-auditor', 'purpose': 'Verify settings invariants', 'capabilities': ['settings-audit']}]
        task_base = {'scope': 'read-only', 'writes': [], 'dependsOn': [], 'estimatedWorkTokens': 500, 'outputTokens': 150,
                     'verification': ['Run a Python assertion and report its successful exit']}
        plan_input = {'id': 'actual-team', 'goal': 'Independently verify the row totals and settings invariants.', 'parent': {'model': main_model, 'effort': 'medium'},
                      'mode': 'team', 'mainContextTokens': 16000, 'roleDrafts': roles, 'tasks': [
                          {**task_base, 'id': 'rows', 'description': 'Verify rows.csv has 3 records and value sum 23. Report both counts in the task result.', 'capabilities': ['row-audit'], 'minTier': 'economy', 'context': ['rows.csv']},
                          {**task_base, 'id': 'settings', 'description': 'Verify settings.json schemaVersion equals 1, enabled equals true, limit equals 3. Report all three values.', 'capabilities': ['settings-audit'], 'minTier': 'deep', 'context': ['settings.json']}]}
        write(PROJECT / 'plan-input.json', plan_input)
        schema = {'type': 'object', 'additionalProperties': False, 'properties': {
            'records': {'type': 'integer'}, 'sum': {'type': 'integer'}, 'schemaVersion': {'type': 'integer'},
            'enabled': {'type': 'boolean'}, 'limit': {'type': 'integer'}},
            'required': ['records', 'sum', 'schemaVersion', 'enabled', 'limit']}
        write(RUN / 'baseline-schema.json', schema)
        baseline_prompt = 'Verify rows.csv has 3 records and value sum 23, and settings.json has schemaVersion 1, enabled true and limit 3. Read both files and run Python assertions. Do not change files or delegate. Return the observed values in JSON.'
        baseline = subprocess.run([str(CODEX), '-a', 'never', 'exec', '--skip-git-repo-check', '--sandbox', 'workspace-write',
                                   '-m', main_model, '-c', 'model_reasoning_effort="medium"', '-c', 'agents.enabled=false',
                                   '--json', '--output-schema', str(RUN / 'baseline-schema.json'), '-o', str(RUN / 'baseline-final.json'), baseline_prompt],
                                  cwd=PROJECT, env=env(), text=True, capture_output=True, timeout=150, stdin=subprocess.DEVNULL)
        write(RUN / 'baseline-events.jsonl', baseline.stdout)
        write(RUN / 'baseline-stderr.log', baseline.stderr)
        assert baseline.returncode == 0, 'Direct baseline must succeed'
        assert json.loads((RUN / 'baseline-final.json').read_text()) == {'records': 3, 'sum': 23, 'schemaVersion': 1, 'enabled': True, 'limit': 3}
        baseline_events = [json.loads(line) for line in baseline.stdout.splitlines() if line.startswith('{')]
        report['baselineUsage'] = [event['usage'] for event in baseline_events if event.get('type') == 'turn.completed']
        baseline_rollouts = {str(p) for p in CODEX_DIR.glob('sessions/**/*.jsonl')}
        print(json.dumps({'phase': 'direct-baseline', 'completed': True}), flush=True)
        runner = RUN / 'runner.mjs'
        write(runner, f'''import fs from 'node:fs';
import {{initEvolution}} from {json.dumps((ROOT/'dist/evolution/service.js').as_uri())};
import {{initStaffing,createPlan}} from {json.dumps((ROOT/'dist/evolution/planner.js').as_uri())};
import {{discoverHost}} from {json.dumps((ROOT/'dist/evolution/host.js').as_uri())};
import {{launchPlan}} from {json.dumps((ROOT/'dist/evolution/execution.js').as_uri())};
import {{scaleUp}} from {json.dumps((ROOT/'dist/team/scaling.js').as_uri())};
try {{
initEvolution(process.cwd());initStaffing(process.cwd());
const policy=JSON.parse(fs.readFileSync('.omx-project/staffing.json'));policy.profiles.economy={{model:'gpt-6-luna',effort:'high',workTokenFactor:1}};
fs.writeFileSync('.omx-project/staffing.json',JSON.stringify(policy));
const host=await discoverHost();fs.writeFileSync({json.dumps(str(RUN/'host.json'))},JSON.stringify(host,null,2));
const input=JSON.parse(fs.readFileSync('plan-input.json'));
const automatic=createPlan(process.cwd(),{{...input,id:'automatic-decision',mode:'auto'}},host);
if(automatic.mode!=='direct')throw new Error('Tiny fixture should stay direct after real team overhead is included');
fs.writeFileSync({json.dumps(str(RUN/'automatic-plan.json'))},JSON.stringify(automatic,null,2));
const plan=createPlan(process.cwd(),input,host);
fs.writeFileSync({json.dumps(str(RUN/'plan.json'))},JSON.stringify(plan,null,2));
const result=await launchPlan(process.cwd(),plan.id);fs.writeFileSync({json.dumps(str(RUN/'launch.json'))},JSON.stringify(result,null,2));
const capped=await scaleUp(result.teamName,1,'executor',[],process.cwd(),{{...process.env,OMX_TEAM_SCALING_ENABLED:'1'}});
if(capped.ok||!capped.error.includes('frozen'))throw new Error('Adaptive runtime did not enforce the frozen worker cap');
fs.writeFileSync({json.dumps(str(RUN/'scale-cap.json'))},JSON.stringify(capped,null,2));
}} catch(error) {{fs.writeFileSync({json.dumps(str(RUN/'launch-error.txt'))},String(error.stack));process.exitCode=1;}}
setInterval(()=>{{}},1000);
''')
        command = shlex.join([NODE, str(runner)]) + ' >' + shlex.quote(str(RUN / 'launcher.log')) + ' 2>&1'
        tmux('new-session', '-d', '-s', 'pilot', '-x', '180', '-y', '55', '-c', str(PROJECT), command)
        deadline = time.monotonic() + 240
        next_update = 0
        tasks = []
        settled = False
        while time.monotonic() < deadline:
            if (RUN / 'launch-error.txt').exists():
                raise RuntimeError((RUN / 'launch-error.txt').read_text()[-3000:])
            tasks = [json.loads(path.read_text()) for path in (PROJECT / '.omx/state/team').glob('*/tasks/task-*.json')]
            if len(tasks) == 2 and all(t.get('status') == 'completed' for t in tasks):
                statuses = [json.loads(p.read_text()) for p in (PROJECT / '.omx/state/team').glob('*/workers/*/status.json')]
                rollouts = [p for p in CODEX_DIR.glob('sessions/**/*.jsonl') if str(p) not in baseline_rollouts]
                finished = 0
                for path in rollouts:
                    lifecycle = [e.get('payload', {}).get('type') for e in map(json.loads, path.read_text().splitlines())
                                 if e.get('type') == 'event_msg' and e.get('payload', {}).get('type') in ['task_started', 'task_complete']]
                    if lifecycle and lifecycle[-1] == 'task_complete': finished += 1
                if len(statuses) == 2 and all(s.get('state') == 'idle' for s in statuses) and finished == 2:
                    settled = True
                    break
            if time.monotonic() > next_update:
                print(json.dumps({'phase': 'actual-team', 'tasks': [{k: t.get(k) for k in ['id', 'status']} for t in tasks], 'run': str(RUN)}), flush=True)
                next_update = time.monotonic() + 20
            time.sleep(1)
        report['tasks'] = tasks
        report['launch'] = json.loads((RUN / 'launch.json').read_text()) if (RUN / 'launch.json').exists() else None
        for pane in tmux('list-panes', '-a', '-F', '#{pane_id}').stdout.splitlines():
            write(RUN / ('pane-' + pane[1:] + '.txt'), tmux('capture-pane', '-p', '-S', '-300', '-t', pane).stdout)
        assert settled and len(tasks) == 2 and all(t.get('status') == 'completed' for t in tasks), 'Both real workers must complete and finish their turns through OMX task state'
        report['rollouts'] = []
        for path in CODEX_DIR.glob('sessions/**/*.jsonl'):
            if str(path) in baseline_rollouts: continue
            models, efforts, usage, commands = set(), set(), None, []
            for line in path.read_text().splitlines():
                event = json.loads(line); payload = event.get('payload', {})
                if event.get('type') in ['turn_context', 'session_meta']:
                    if payload.get('model'): models.add(payload['model'])
                    if payload.get('effort'): efforts.add(payload['effort'])
                if event.get('type') == 'event_msg' and payload.get('type') == 'token_count':
                    usage = (payload.get('info') or {}).get('total_token_usage', usage)
                if event.get('type') == 'response_item' and payload.get('type') == 'function_call':
                    commands.append({'name': payload.get('name'), 'arguments': payload.get('arguments')})
                item = payload.get('item', {})
                if payload.get('type') == 'item_completed' and item.get('type') == 'CommandExecution':
                    commands.append({'command': item.get('command'), 'exitCode': item.get('exit_code'), 'status': item.get('status')})
            report['rollouts'].append({'path': str(path.relative_to(RUN)), 'models': sorted(models), 'efforts': sorted(efforts), 'usage': usage, 'tools': commands})
        observed = {m for r in report['rollouts'] for m in r['models']}
        assert 'gpt-6-luna' in observed and main_model in observed, 'Real rollout metadata must confirm both selected models'
        assert len(report['rollouts']) == 2, 'Leaf workers must not start additional model sessions'
        for rollout in report['rollouts']:
            expected_effort = 'high' if rollout['models'] == ['gpt-6-luna'] else 'medium'
            assert rollout['efforts'] == [expected_effort], 'Observed effort must match the frozen plan'
            commands = [tool['command'][-1] for tool in rollout['tools'] if isinstance(tool.get('command'), list)]
            assert any('assert ' in cmd for cmd in commands), 'Each worker must execute verification'
            assert any(str(ROOT / 'dist/cli/omx.js') in cmd for cmd in commands), 'Worker lifecycle must use the isolated fork by absolute path'
            assert not any(re.search(r'(?:^|[;\n])\s*omx\s', cmd) for cmd in commands), 'A bare omx command could resolve to the global installation'
        report['automaticRouting'] = json.loads((RUN / 'automatic-plan.json').read_text())['mode']
        report['workerUsage'] = sum(r['usage']['total_tokens'] for r in report['rollouts'] if r['usage'])
        report['workerUsageScope'] = 'completed-work-before-shutdown; lower bound for whole lifecycle'
        report['teamLeaderUsage'] = 'not-measured; fixture coordinator is a Node process'
        report['scaleCap'] = json.loads((RUN / 'scale-cap.json').read_text())
        report['baselineTotalTokens'] = sum(u['input_tokens'] + u['output_tokens'] for u in report['baselineUsage'])
        report['observedTinyTaskDirectUsesFewerTokens'] = report['baselineTotalTokens'] < report['workerUsage']
        assert report['observedTinyTaskDirectUsesFewerTokens'], 'Small-task routing decision needs matching usage evidence'
        shutdown = subprocess.run([NODE, str(CLI), 'team', 'shutdown', report['launch']['teamName'], '--force'],
                                  cwd=PROJECT, env=env(), text=True, capture_output=True, timeout=75)
        write(RUN / 'shutdown.log', shutdown.stdout + '\n' + shutdown.stderr)
        report['shutdownPassed'] = shutdown.returncode == 0
        assert report['shutdownPassed'], 'Existing OMX shutdown must complete'
        report['status'] = 'passed'
    except BaseException as error:
        report['status'], report['error'] = 'failed', str(error)
        raise
    finally:
        # This socket was created solely by this fixture; it cannot reach user panes.
        try:
            for pane in tmux('list-panes', '-a', '-F', '#{pane_id}', check=False).stdout.splitlines():
                write(RUN / ('final-pane-' + pane[1:] + '.txt'), tmux('capture-pane', '-p', '-S', '-300', '-t', pane, check=False).stdout)
            tmux('kill-server', check=False)
        finally:
            auth_path.unlink(missing_ok=True)
            report['originalAuthUnchanged'] = sha(USER_CODEX / 'auth.json') == original
            report['temporaryAuthRemoved'] = not auth_path.exists()
            rendered = json.dumps(report, indent=2) + '\n'
            for value in auth.get('tokens', {}).values():
                if isinstance(value, str) and len(value) > 30: rendered = rendered.replace(value, '[REDACTED]')
            write(RUN / 'report.json', rendered)
            print(json.dumps({'report': str(RUN / 'report.json'), 'status': report['status']}), flush=True)
