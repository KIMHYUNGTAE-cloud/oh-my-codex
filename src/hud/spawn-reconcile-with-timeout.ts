import { spawn } from 'child_process';
import { execFileSync } from 'child_process';

export interface SpawnReconcileOptions {
  omxBinary: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  leaderPaneId?: string;
  leaderPanePid?: string;
  platform?: NodeJS.Platform;
}

/**
 * Spawn the reconcile process with timeout and process tree kill on both POSIX and Windows.
 * On POSIX, kills the process group to terminate any child processes.
 * On Windows, uses taskkill /T to kill the process tree.
 * The timeout is handled via an unreferenced timer to avoid keeping the parent alive.
 */
export async function spawnReconcileWithTimeout(options: SpawnReconcileOptions): Promise<boolean> {
  const {
    omxBinary,
    cwd,
    env,
    timeoutMs,
    leaderPaneId,
    leaderPanePid,
    platform = process.platform,
  } = options;

  const childEnv: NodeJS.ProcessEnv = {
    ...env,
  };
  if (leaderPaneId) {
    childEnv.TMUX_PANE = leaderPaneId;
  }
  if (leaderPanePid) {
    childEnv.OMX_HUD_WATCH_LEADER_PID = leaderPanePid;
  }
  childEnv.OMX_HUD_WATCH_REPAIR = '1';

  const child = spawn(process.execPath, [omxBinary, 'hud', '--reconcile-tmux'], {
    cwd,
    env: childEnv,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  });

  // A child stuck before it runs any JS never exits on its own; bound it
  // so the watcher can retry instead of waiting on it forever. Not spawn's
  // `timeout` option: its timer is referenced and would keep a stopped
  // watcher's process alive until it fires.
  const killTimer = setTimeout(() => {
    // The detached child leads its own process group on POSIX; kill the
    // group so a subprocess it started (tmux) does not outlive it.
    // Windows has no process groups: `taskkill /T` ends the tree (psmux).
    try {
      if (child.pid === undefined) {
        child.kill('SIGKILL');
      } else if (platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
          timeout: 5_000,
        });
      } else {
        process.kill(-child.pid, 'SIGKILL');
      }
    } catch {
      child.kill('SIGKILL');
    }
  }, timeoutMs);

  killTimer.unref();

  const settled = new Promise<boolean>((resolve) => {
    child.once('error', () => {
      clearTimeout(killTimer);
      resolve(false);
    });
    child.once('close', (code) => {
      clearTimeout(killTimer);
      resolve(code === 0);
    });
  });

  child.unref();
  return settled;
}
