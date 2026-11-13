import crypto from 'node:crypto';
import fs from 'node:fs';
import readline from 'node:readline';

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) {
      reject(new Error('Run this command in a terminal to enter the password privately.'));
      return;
    }
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let value = '';
    const finish = (error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      error ? reject(error) : resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

const password = await readHidden('New LocalDrive password: ');
if (password.length < 10) {
  console.error('Use at least 10 characters. No configuration was changed.');
  process.exit(1);
}
const salt = crypto.randomBytes(16);
const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const hash = `scrypt$16384$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
const file = new URL('../.env', import.meta.url);
const content = fs.readFileSync(file, 'utf8');
const next = content.match(/^PASSWORD_HASH=.*$/m)
  ? content.replace(/^PASSWORD_HASH=.*$/m, `PASSWORD_HASH=${hash}`)
  : `${content.trimEnd()}\nPASSWORD_HASH=${hash}\n`;
fs.writeFileSync(file, next, 'utf8');
console.log('Password hash saved in .env. The password itself was not stored.');