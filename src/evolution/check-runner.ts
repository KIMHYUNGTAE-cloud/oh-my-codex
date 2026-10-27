/** Dedicated process so timeout and successful exits both clean descendant groups. */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const check = JSON.parse(readFileSync(0, 'utf8')) as { command: string; args: string[]; timeoutMs: number };
const child = spawn(check.command, check.args, { stdio: 'inherit', detached: process.platform !== 'win32' });
let timedOut = false;
function cleanup() {
  if (!child.pid) return;
  try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') process.exit(125); }
}
const timer = setTimeout(() => { timedOut = true; cleanup(); }, check.timeoutMs);
child.on('error', () => { clearTimeout(timer); cleanup(); process.exit(125); });
child.on('exit', (code, signal) => {
  clearTimeout(timer); cleanup(); process.exit(timedOut || signal ? 124 : code ?? 125);
});
