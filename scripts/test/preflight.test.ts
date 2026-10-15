import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listenBehaviour: { busyPorts: Set<number> } = { busyPorts: new Set() };

vi.mock('node:net', () => {
  const createServer = () => {
    const server = new EventEmitter() as EventEmitter & {
      listen: (port: number, host?: string) => void;
      close: (cb?: () => void) => void;
      unref: () => void;
    };
    server.listen = (port: number) => {
      setImmediate(() => {
        if (listenBehaviour.busyPorts.has(port)) {
          const err = new Error('in use') as NodeJS.ErrnoException;
          err.code = 'EADDRINUSE';
          server.emit('error', err);
        } else server.emit('listening');
      });
    };
    server.close = (cb) => cb?.();
    server.unref = () => {};
    return server;
  };
  return { default: { createServer }, createServer };
});

const { isPortFree, runPreflight, parseNodeMajor } = await import('../preflight.js');

const okDeps = {
  nodeVersion: '24.1.0',
  exec: async (cmd: string) => {
    if (cmd.startsWith('pnpm')) return '10.33.0';
    if (cmd.startsWith('docker info')) return '27.0';
    return '';
  },
};

beforeEach(() => listenBehaviour.busyPorts.clear());

describe('isPortFree', () => {
  it('is true when the listen succeeds', async () => {
    expect(await isPortFree(5432)).toBe(true);
  });
  it('is false on EADDRINUSE', async () => {
    listenBehaviour.busyPorts.add(5432);
    expect(await isPortFree(5432)).toBe(false);
  });
});

describe('parseNodeMajor', () => {
  it('parses versions', () => {
    expect(parseNodeMajor('v20.11.1')).toBe(20);
    expect(parseNodeMajor('24.0.0')).toBe(24);
    expect(parseNodeMajor('garbage')).toBeNaN();
  });
});

describe('runPreflight', () => {
  it('passes when everything is free', async () => {
    const r = await runPreflight(okDeps);
    expect(r.ok).toBe(true);
  });

  it('fails on old node', async () => {
    const r = await runPreflight({ ...okDeps, nodeVersion: '18.19.0' });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/Node/);
  });

  it('fails when pnpm is missing', async () => {
    const r = await runPreflight({
      ...okDeps,
      exec: async (cmd) => {
        if (cmd.startsWith('pnpm')) throw new Error('not found');
        return '';
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/pnpm/);
  });

  it('fails when the docker daemon is unreachable', async () => {
    const r = await runPreflight({
      ...okDeps,
      exec: async (cmd) => {
        if (cmd.startsWith('docker info')) throw new Error('daemon down');
        return '10.0.0';
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/Docker/);
  });

  it('passes when 5432 is held by roofline-postgres', async () => {
    listenBehaviour.busyPorts.add(5432);
    const r = await runPreflight({
      ...okDeps,
      exec: async (cmd) => {
        if (cmd.startsWith('docker ps')) return 'roofline-postgres';
        return okDeps.exec(cmd);
      },
    });
    expect(r.ok).toBe(true);
  });

  it('fails naming the holder when 5432 is held by something else', async () => {
    listenBehaviour.busyPorts.add(5432);
    const r = await runPreflight({
      ...okDeps,
      exec: async (cmd) => {
        if (cmd.startsWith('docker ps')) return 'other-pg';
        if (cmd.startsWith('lsof')) return 'COMMAND PID\npostgres 4242 me';
        return okDeps.exec(cmd);
      },
    });
    expect(r.ok).toBe(false);
    const msg = r.errors.join('\n');
    expect(msg).toContain('5432');
    expect(msg).toContain('other-pg');
    expect(msg).toContain('4242');
  });

  it('only warns when 3000 is busy', async () => {
    listenBehaviour.busyPorts.add(3000);
    const r = await runPreflight(okDeps);
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toMatch(/3000/);
  });
});
