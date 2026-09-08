import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { platform } from 'node:os';
import { authenticate } from '../protocol/auth.mjs';
import { DEFAULT_KEY_DIR } from '../cli/config.mjs';

const KEY_DIR = process.env.TESS_COMPANION_KEYS || DEFAULT_KEY_DIR;
const KEYCHAIN_SERVICE = 'tesseract-companion';

const safeLabel = (label) => String(label).replace(/[^a-z0-9_-]/gi, '_');

export const keyFileFor = (label) => join(KEY_DIR, `${safeLabel(label)}.jwk.json`);

const keychainAvailable = () => platform() === 'darwin' && process.env.TESS_COMPANION_PLAINTEXT !== '1';

function keychainRead(account) {
  try {
    const out = execFileSync(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const hex = out.toString('utf8').trim();
    if (!/^[0-9a-f]+$/i.test(hex)) return null;
    return JSON.parse(Buffer.from(hex, 'hex').toString('utf8'));
  } catch {
    return null;
  }
}

function keychainWrite(account, jwk) {
  const hex = Buffer.from(JSON.stringify(jwk), 'utf8').toString('hex');
  execFileSync('security', ['-i'], {
    input: `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${account} -j "tesseract companion key" -w ${hex}\n`,
    stdio: ['pipe', 'ignore', 'pipe'],
  });
}

function loadOrMintKeyPair(label) {
  const account = safeLabel(label);
  const file = keyFileFor(label);

  if (keychainAvailable()) {
    const jwk = keychainRead(account);
    if (jwk) {
      const privateKey = createPrivateKey({ key: jwk, format: 'jwk' });
      return { privateKey, publicKey: createPublicKey(privateKey), custody: 'keychain', file: null, minted: false };
    }
  }

  try {
    const jwk = JSON.parse(readFileSync(file, 'utf8'));
    const privateKey = createPrivateKey({ key: jwk, format: 'jwk' });
    console.warn(`[companion] key for "${label}" is a PLAINTEXT file at ${file} — anything running as this user can read it`);
    return { privateKey, publicKey: createPublicKey(privateKey), custody: 'file', file, minted: false };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw new Error(`companion key ${file} exists but is unusable (${err.message}) — refusing to mint a second identity over it`);
    }
  }

  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });

  if (keychainAvailable()) {
    try {
      keychainWrite(account, jwk);
      return { privateKey, publicKey, custody: 'keychain', file: null, minted: true };
    } catch (err) {
      console.error(`[companion] macOS Keychain refused the key (${err.message.split('\n')[0]}) — falling back to a plaintext file`);
    }
  }

  mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(jwk), { mode: 0o600 });
  console.error(`[companion] key for "${label}" written as a PLAINTEXT file at ${file} — anything running as this user can read it`);
  return { privateKey, publicKey, custody: 'file', file, minted: true };
}

export async function companionIdentity(port, { label = 'claude' } = {}) {
  const { privateKey, publicKey, custody, file, minted } = loadOrMintKeyPair(label);
  const identity = await authenticate(port, { keyPair: { privateKey, publicKey }, kind: 'companion' });
  return { ...identity, label, custody, file, minted };
}
