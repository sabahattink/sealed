export type MockPrivateVault = Readonly<{
  passportNumber: string;
  monthlyIncome: number;
}>;

export const DEMO_CANARY_SECRET = "CANARY-SEALED-PASSPORT-4829";

/**
 * Demo-only local vault. This is deliberately not presented as a production
 * security boundary; it exists to make the no-raw-value contract observable.
 */
export function createMockPrivateVault(): MockPrivateVault {
  return Object.freeze({
    passportNumber: DEMO_CANARY_SECRET,
    monthlyIncome: 8_500,
  });
}
