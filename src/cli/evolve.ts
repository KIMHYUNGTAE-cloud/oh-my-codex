import { readFileSync, realpathSync } from 'node:fs';
import { apply, automationStatus, evaluate, evolutionContext, evolutionWorkflow, evolutionSchemas, initEvolution, propose, recordIncident, recover, rollback, setAutomation, status } from '../evolution/service.js';
import { discoverHost } from '../evolution/host.js';
import { clearModelCandidates, createPlan, enableStaffing, initStaffing, listModelCandidates, modelCandidatesSchema, planInputSchema, readPlan, removeModelCandidate, setModelCandidates, staffingPolicySchema } from '../evolution/planner.js';
import { z } from 'zod';
import { launchPlan, observationSchema, observePlan } from '../evolution/execution.js';
import { skillsSchema } from '../evolution/skills.js';
import { findSkillsWithCli, inspectSkillWithCli } from '../evolution/skill-discovery.js';

export async function evolveCommand(args: string[]): Promise<void> {
  const command = args[0] ?? 'status';
  const root = process.cwd();
  if (command === 'auto') {
    const action = args[1] ?? 'status';
    if (args.length > 2 || !['on', 'off', 'status'].includes(action)) throw new Error('Usage: evolve auto on|off|status');
    if (action !== 'status') initEvolution(root);
    if (action === 'on') { initStaffing(root); enableStaffing(root); }
    console.log(JSON.stringify(action === 'status' ? automationStatus(root) : setAutomation(root, action === 'on')));
    return;
  }
  if (command === 'models' && args[1] === 'candidates') {
    const action = args[2] ?? 'list';
    if (action === 'list' && (args.length === 2 || args.length === 3)) {
      console.log(JSON.stringify(listModelCandidates(root))); return;
    }
    if (action === 'clear' && args.length === 3) { console.log(JSON.stringify(clearModelCandidates(root))); return; }
    if (action === 'remove' && args.length === 4) {
      console.log(JSON.stringify(removeModelCandidate(root, args[3]!))); return;
    }
    if (action === 'add' && args.length === 8 && args[4] === '--tier' && args[6] === '--efforts') {
      const candidate = { model: args[3]!, tier: args[5]!, efforts: args[7]!.split(',') };
      const existing = listModelCandidates(root).candidates.filter(item => item.model !== candidate.model);
      console.log(JSON.stringify(setModelCandidates(root, { candidates: [...existing, candidate] }, await discoverHost()))); return;
    }
    if (action === 'set' && args.length === 5 && args[3] === '--file') {
      const input = JSON.parse(readFileSync(args[4]!, 'utf8')) as unknown;
      console.log(JSON.stringify(setModelCandidates(root, input, await discoverHost()))); return;
    }
    throw new Error('Usage: evolve models candidates [list|clear|add MODEL --tier TIER --efforts low,medium|remove MODEL|set --file candidates.json]');
  }
  const flags = new Map<string, string>();
  for (let i = 1; i < args.length; i++) {
    const name = args[i]!;
    if (!['--file', '--proposal', '--query', '--id', '--automatic', '--json', '--plan'].includes(name) || flags.has(name)) throw new Error(`Invalid or repeated option: ${name}`);
    if (name === '--automatic' || name === '--json') flags.set(name, 'true');
    else { const value = args[++i]; if (value === undefined || value.startsWith('--')) throw new Error(`Missing ${name}`); flags.set(name, value); }
  }
  const input = () => JSON.parse(readFileSync(flags.get('--file') ?? (() => { throw new Error('--file required'); })(), 'utf8')) as unknown;
  const proposalId = () => flags.get('--proposal') ?? (() => { throw new Error('--proposal required'); })();
  const planId = () => flags.get('--plan') ?? (() => { throw new Error('--plan required'); })();
  let result: unknown;
  switch (command) {
    case 'init': result = initEvolution(root); break;
    case 'record': result = recordIncident(root, input()); break;
    case 'propose': result = propose(root, input()); break;
    case 'evaluate': result = evaluate(root, proposalId()); break;
    case 'apply': result = apply(root, proposalId(), flags.has('--automatic')); break;
    case 'rollback': result = rollback(root, proposalId()); break;
    case 'recover': result = recover(root); break;
    case 'status': result = status(root); break;
    case 'schema': result = { ...evolutionSchemas(), skills: z.toJSONSchema(skillsSchema), staffing: z.toJSONSchema(staffingPolicySchema), modelCandidates: z.toJSONSchema(modelCandidatesSchema), plan: z.toJSONSchema(planInputSchema), observation: z.toJSONSchema(observationSchema) }; break;
    case 'find-skills': result = findSkillsWithCli(flags.get('--query') ?? (() => { throw new Error('--query required'); })()); break;
    case 'inspect-skill': result = inspectSkillWithCli(flags.get('--id') ?? (() => { throw new Error('--id required'); })()); break;
    case 'staffing-init': result = initStaffing(root); break;
    case 'models': result = await discoverHost(); break;
    case 'plan': result = createPlan(root, input(), await discoverHost()); break;
    case 'show-plan': result = readPlan(realpathSync(root), planId()); break;
    case 'launch': result = await launchPlan(realpathSync(root), planId()); break;
    case 'observe': result = observePlan(realpathSync(root), planId(), input()); break;
    case 'context': console.log(evolutionContext(root, flags.get('--query') ?? '')); return;
    case 'hook': {
      const payload = JSON.parse(readFileSync(0, 'utf8')) as { cwd?: string; prompt?: string; hook_event_name?: string };
      if (!['SessionStart', 'UserPromptSubmit'].includes(payload.hook_event_name ?? '')) { console.log('{}'); return; }
      // Hook cwd must agree with its configured project process cwd.
      if (payload.cwd && realpathSync(payload.cwd) !== realpathSync(root)) throw new Error('Hook project cwd mismatch');
      const context = [payload.hook_event_name === 'SessionStart' ? evolutionWorkflow(root) : '', evolutionContext(root, payload.prompt ?? '')].filter(Boolean).join('\n\n');
      console.log(JSON.stringify(context ? { hookSpecificOutput: { hookEventName: payload.hook_event_name, additionalContext: context } } : {})); return;
    }
    case 'help': console.log('omx-adaptive evolve auto on|off|status; models; models candidates list|clear|add MODEL --tier TIER --efforts low,medium|remove MODEL|set --file JSON; init|schema|record --file JSON|propose --file JSON|evaluate --proposal ID|apply --proposal ID [--automatic]|rollback --proposal ID|recover|status|context --query TEXT|hook|find-skills --query TEXT|inspect-skill --id SOURCE/SKILL|staffing-init|plan --file JSON|show-plan --plan ID|launch --plan ID|observe --plan ID --file JSON'); return;
    default: throw new Error(`Unknown evolve command: ${command}`);
  }
  console.log(JSON.stringify(result));
}
