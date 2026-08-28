import type { MockPrivateVault } from "@/lib/private-vault";

export const SAFE_EGRESS_ERROR = "Sealed blocked this operation at the guarded boundary.";
export type GuardedToolResponse<T extends Record<string, unknown>> = Readonly<{ content: readonly Readonly<{ type: "text"; text: string }>[]; structuredContent: T }>;

export function containsRawPrivateValue(value: unknown, vault: MockPrivateVault): boolean {
  const privateStrings = [vault.passportNumber, vault.dateOfBirth, vault.identityNumber].filter((token) => token.length > 0);
  const incomeToken = String(vault.monthlyIncome);
  const incomePattern = new RegExp(`(^|[^A-Za-z0-9])${incomeToken}($|[^A-Za-z0-9])`);
  const ancestors = new WeakSet<object>();

  const inspect = (candidate: unknown): boolean => {
    if (typeof candidate === "string") {
      return privateStrings.some((token) => candidate.includes(token)) || incomePattern.test(candidate);
    }
    if (typeof candidate === "number") return Object.is(candidate, vault.monthlyIncome);
    if (candidate === null || typeof candidate !== "object") return false;
    if (ancestors.has(candidate)) return true;
    ancestors.add(candidate);
    try {
      if (Array.isArray(candidate)) return candidate.some(inspect);
      return Object.entries(candidate).some(([key, nested]) => inspect(key) || inspect(nested));
    } catch {
      return true;
    } finally {
      ancestors.delete(candidate);
    }
  };

  return inspect(value);
}

export function guardSafeEgress<T extends Record<string, unknown>>(response: GuardedToolResponse<T>, vault: MockPrivateVault): GuardedToolResponse<T> {
  if (containsRawPrivateValue(response.content, vault) || containsRawPrivateValue(response.structuredContent, vault)) throw new Error(SAFE_EGRESS_ERROR);
  if (Object.isFrozen(response) && Object.isFrozen(response.content) && Object.isFrozen(response.structuredContent)) return response;
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
