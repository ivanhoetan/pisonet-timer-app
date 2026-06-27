import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export async function hashSecret(value: string): Promise<string> {
  return bcrypt.hash(value, SALT_ROUNDS);
}

export async function compareSecret(value: string, hash: string): Promise<boolean> {
  return bcrypt.compare(value, hash);
}

export function generateAuthSecret(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
