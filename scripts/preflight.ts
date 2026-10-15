/** Environment checks before dev: Node, pnpm, Docker, ports 5432 and 3000. `pnpm preflight` */
import net from 'node:net';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execP = promisify(execCb);

export type Exec = (cmd: string) => Promise<string>;
export interface Deps {
  nodeVersion: string;
  exec: Exec;
}
export interface Result {
  ok: boolean;
  errors: string[];
  warnings: string[];
  info: string[];
}

export const defaultExec: Exec = async (cmd) => (await execP(cmd)).stdout.trim();

export function parseNodeMajor(version: string): number {
  return Number.parseInt(version.replace(/^v/, '').split('.')[0] ?? '', 10);
}

export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

async function tryExec(exec: Exec, cmd: string): Promise<string> {
  try {
    return await exec(cmd);
  } catch {
    return '';
  }
}

export async function runPreflight(deps: Deps = { nodeVersion: process.version, exec: defaultExec }): Promise<Result> {
  const r: Result = { ok: true, errors: [], warnings: [], info: [] };
  const { exec } = deps;

  const major = parseNodeMajor(deps.nodeVersion);
  if (Number.isNaN(major) || major < 20) r.errors.push(`Node >= 20 required, found ${deps.nodeVersion}.`);
  else r.info.push(`Node ${deps.nodeVersion}`);

  try {
    r.info.push(`pnpm ${await exec('pnpm --version')}`);
  } catch {
    r.errors.push('pnpm not found on PATH. Install it (corepack enable).');
  }

  let dockerUp = true;
  try {
    await exec("docker info --format '{{.ServerVersion}}'");
    r.info.push('Docker daemon reachable');
  } catch {
    dockerUp = false;
    r.errors.push('Docker daemon is not reachable. Start Docker Desktop / OrbStack.');
  }

  if (!(await isPortFree(5432))) {
    const owners = dockerUp
      ? (await tryExec(exec, "docker ps --filter publish=5432 --format '{{.Names}}'")).split('\n').filter(Boolean)
      : [];
    if (owners.includes('roofline-postgres')) {
      r.info.push('Port 5432 held by roofline-postgres (ok)');
    } else {
      const lsof = await tryExec(exec, 'lsof -nP -iTCP:5432 -sTCP:LISTEN');
      r.errors.push(
        `Port 5432 is in use by something other than roofline-postgres.\n` +
          `  docker containers: ${owners.length ? owners.join(', ') : '(none)'}\n` +
          `  listener: ${lsof ? lsof.split('\n').join('\n    ') : '(unknown; try lsof -nP -iTCP:5432)'}\n` +
          `  Stop it; Roofline never remaps the port.`,
      );
    }
  } else r.info.push('Port 5432 free');

  if (!(await isPortFree(3000))) r.warnings.push('Port 3000 is in use; `pnpm dev` will not be able to bind it.');
  else r.info.push('Port 3000 free');

  r.ok = r.errors.length === 0;
  return r;
}

async function main(): Promise<void> {
  const r = await runPreflight();
  for (const l of r.info) console.log(`  ok    ${l}`);
  for (const l of r.warnings) console.warn(`  warn  ${l}`);
  for (const l of r.errors) console.error(`  FAIL  ${l}`);
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
