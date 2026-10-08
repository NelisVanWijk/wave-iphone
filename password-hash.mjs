import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { passwordHash } from './auth.mjs';

// Interactive only: keeps the password out of command history and process args.
if (!process.stdin.isTTY) throw new Error('Run interactively: docker exec -it wave-iphone node password-hash.mjs');
let muted = false;
const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
const rl = createInterface({ input: process.stdin, output, terminal: true });
async function ask(prompt) {
  process.stdout.write(prompt); muted = true;
  try { return await rl.question(''); } finally { muted = false; process.stdout.write('\n'); }
}
try {
  const first = await ask('Nieuw wachtwoord (minimaal 16 tekens, invoer verborgen): ');
  const second = await ask('Herhaal wachtwoord: ');
  if (first !== second) throw new Error('Wachtwoorden verschillen.');
  console.log(`WAVE_PASSWORD_HASH=${await passwordHash(first)}`);
} finally { rl.close(); }
