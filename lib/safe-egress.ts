import type { MockPrivateVault } from "@/lib/private-vault";

export const SAFE_EGRESS_ERROR = "Sealed blocked this operation at the guarded boundary.";
export type GuardedToolResponse<T extends Record<string, unknown>> = Readonly<{ content: readonly Readonly<{ type: "text"; text: string }>[]; structuredContent: T }>;

function privateTokens(vault: MockPrivateVault): readonly string[] {
  return [vault.passportNumber, String(vault.monthlyIncome), vault.dateOfBirth, vault.identityNumber].filter((value) => value.length > 0);
}

export function containsRawPrivateValue(value: unknown, vault: MockPrivateVault): boolean {
  let serialized: string;
  try { serialized = typeof value === "string" ? value : JSON.stringify(value); } catch { return true; }
  return privateTokens(vault).some((token) => serialized.includes(token));
}

export function guardSafeEgress<T extends Record<string, unknown>>(response: GuardedToolResponse<T>, vault: MockPrivateVault): GuardedToolResponse<T> {
  if (containsRawPrivateValue(response.content, vault) || containsRawPrivateValue(response.structuredContent, vault)) throw new Error(SAFE_EGRESS_ERROR);
  return Object.freeze({ content: Object.freeze(response.content.map((item) => Object.freeze({ ...item }))), structuredContent: Object.freeze({ ...response.structuredContent }) });
}

export function sanitizeBoundaryError(error: unknown, vault: MockPrivateVault): Error {
  const message = error instanceof Error ? error.message : "Sealed operation failed.";
  if (containsRawPrivateValue(message, vault)) return new Error(SAFE_EGRESS_ERROR);
  const allowlisted = ["active demo session", "active scenario", "active tool surface", "already sealed", "locked after private evaluation", "requires a private predicate verdict and approved binding", "not approved", "at least one public field", "active-scenario public fields only", "positive number", "must be text", "allowed option", "Unsupported uncertainty topic", "Private binding value unavailable"];
  return new Error(allowlisted.some((fragment) => message.includes(fragment)) ? message : SAFE_EGRESS_ERROR);
}

export function guardToolExecution<T extends Record<string, unknown>>(vault: MockPrivateVault, execute: () => GuardedToolResponse<T> | Promise<GuardedToolResponse<T>>): GuardedToolResponse<T> | Promise<GuardedToolResponse<T>> {
  try {
    const result = execute();
    if (result instanceof Promise) return result.then((response) => guardSafeEgress(response, vault)).catch((error) => { throw sanitizeBoundaryError(error, vault); });
    return guardSafeEgress(result, vault);
  } catch (error) { throw sanitizeBoundaryError(error, vault); }
}
