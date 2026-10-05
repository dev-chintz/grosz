// `npm run dev`: serwer API (port 3000) i Vite (port 5173) razem; Ctrl+C zatrzymuje oba.

import { spawn, type ChildProcess } from 'node:child_process';

const run = (name: string, command: string, env: Record<string, string> = {}): ChildProcess => {
  const child = spawn(command, { stdio: ['ignore', 'pipe', 'pipe'], shell: true, env: { ...process.env, ...env } });
  const prefix = (chunk: Buffer) =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => `[${name}] ${line}`)
      .join('\n') + '\n';
  child.stdout?.on('data', (c: Buffer) => process.stdout.write(prefix(c)));
  child.stderr?.on('data', (c: Buffer) => process.stderr.write(prefix(c)));
  child.on('exit', (code) => {
    console.log(`[${name}] zakończony (kod ${code})`);
    stop();
  });
  return child;
};

// PORT ustawiamy jawnie: narzędzia uruchamiające podgląd przekazują własne PORT (np. 5173),
// a API musi zostać na 3000, bo tam kieruje je proxy Vite. HOST=127.0.0.1: lokalne API
// nie jest widoczne w sieci domowej ani w Tailscale.
const children = [run('api', 'npm run dev -w server', { PORT: '3000', HOST: '127.0.0.1' }), run('web', 'npm run dev -w web')];

function stop() {
  for (const child of children) if (child.exitCode === null) child.kill();
  process.exit();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
