import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const FIXTURE_SERVER = fileURLToPath(new URL('./fixture-server.ts', import.meta.url));

export interface Fixture {
  url: string;
  stop(): Promise<void>;
}

/** Starts the fixture server under bun and resolves with the URL it prints. */
export function startFixture(args: string[] = []): Promise<Fixture> {
  const child = spawn('bun', [FIXTURE_SERVER, '--no-open', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
  return new Promise((resolve, reject) => {
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const url = /^marrow: (\S+)$/m.exec(stdout)?.[1];
      if (url) {
        resolve({
          url,
          stop: () => new Promise((done) => { child.once('exit', () => done()); child.kill('SIGTERM'); }),
        });
      }
    });
    child.once('exit', (code) => reject(new Error(`fixture server exited ${code}: ${stderr}`)));
  });
}
