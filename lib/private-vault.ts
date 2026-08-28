import type { PrivateFieldId, ScenarioId } from "@/lib/scenarios";

export type MockPrivateVault = Readonly<{
  passportNumber: string;
  monthlyIncome: number;
  dateOfBirth: string;
  identityNumber: string;
}>;

export type LocalBindingArtifact = Readonly<{
  ref: string;
  field: PrivateFieldId;
  scenarioId: ScenarioId;
  demoSession: number;
  createdAt: string;
  localCommitment: string;
}>;

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function randomHex(length: number): string {
  return Array.from(randomBytes(length), (value) => value.toString(16).padStart(2, "0")).join("");
}

function localCommitment(value: string, salt: string): string {
  let hash = 0x811c9dc5;
  for (const character of `${salt}:${value}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16).padStart(8, "0")}${randomHex(4)}`;
}

/** Demo-only, session-local private values. This is not a production vault. */
export function createMockPrivateVault(now = new Date()): MockPrivateVault {
  const birth = new Date(Date.UTC(now.getUTCFullYear() - 30, 3, 12));
  const income = 7_500 + (randomBytes(1)[0] % 10) * 100;
  return Object.freeze({
    passportNumber: `demo-passport-${randomHex(12)}`,
    monthlyIncome: income,
    dateOfBirth: birth.toISOString().slice(0, 10),
    identityNumber: `demo-identity-${randomHex(12)}`,
  });
}

/** Consumes a raw local credential and emits only an opaque, session-bound artifact. */
export function createLocalBindingArtifact({ value, field, scenarioId, demoSession, now = new Date() }: {
  value: string;
  field: PrivateFieldId;
  scenarioId: ScenarioId;
  demoSession: number;
  now?: Date;
}): LocalBindingArtifact {
  if (!value) throw new Error("Private binding value unavailable");
  const salt = randomHex(16);
  return Object.freeze({
    ref: `binding_${randomHex(16)}`,
    field,
    scenarioId,
    demoSession,
    createdAt: now.toISOString(),
    localCommitment: localCommitment(value, salt),
  });
}
