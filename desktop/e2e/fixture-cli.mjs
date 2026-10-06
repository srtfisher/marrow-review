// Stands in for dist/cli.js: the shell forks this with Electron's Node, which
// cannot run the TypeScript fixture server, so it hands the work to bun.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('../../e2e/fixture-server.ts', import.meta.url));
const child = spawn('bun', [server, ...process.argv.slice(2)], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
