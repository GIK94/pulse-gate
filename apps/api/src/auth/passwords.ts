import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id with OWASP-recommended baseline parameters (19 MiB, t=2, p=1).
 * Tunable via env for stronger hardware.
 */
const OPTIONS = {
  memoryCost: Number(process.env.ARGON2_MEMORY_KIB ?? 19_456),
  timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;
/** Verifies against a throwaway hash so unknown emails take as long as known ones. */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('pulsegate-timing-equaliser');
  await verifyPassword(await dummyHash, password);
}
