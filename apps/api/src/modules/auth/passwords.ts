import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// OWASP's 32 MiB scrypt profile; Node's built-in implementation avoids native addons.
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const prefix = 'scrypt$32768$8$3';

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `${prefix}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  const salt = parts[4];
  const digest = parts[5];
  if (
    parts.length !== 6 ||
    parts.slice(0, 4).join('$') !== prefix ||
    !salt ||
    !/^[a-f0-9]{32}$/.test(salt) ||
    !digest ||
    !/^[a-f0-9]{128}$/.test(digest)
  ) {
    return false;
  }
  return timingSafeEqual(
    await derive(password, Buffer.from(salt, 'hex')),
    Buffer.from(digest, 'hex'),
  );
}
