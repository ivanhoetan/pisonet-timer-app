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

// Short, human-friendly pairing code (e.g. "7K2Q-9F"). Avoids ambiguous
// characters (0/O, 1/I/L) so staff can read and type it without mistakes.
const PAIRING_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generatePairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let raw = '';
  for (let i = 0; i < 6; i++) {
    raw += PAIRING_ALPHABET[bytes[i] % PAIRING_ALPHABET.length];
  }
  return `${raw.slice(0, 3)}-${raw.slice(3)}`;
}

export const PAIRING_CODE_TTL_MS = 15 * 60 * 1000;

// Short temporary password for admin-initiated resets. Uses the same
// unambiguous alphabet so customers can read and type it without mistakes.
export function generateTempPassword(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let code = '';
  for (let i = 0; i < length; i++) {
    code += PAIRING_ALPHABET[bytes[i] % PAIRING_ALPHABET.length];
  }
  return code;
}
