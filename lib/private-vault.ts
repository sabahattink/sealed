export type MockPrivateVault = Readonly<{
  passportNumber: string;
  monthlyIncome: number;
  dateOfBirth: string;
  identityNumber: string;
}>;

export const DEMO_CANARY_SECRET = "CANARY-SEALED-PASSPORT-4829";
export const MEMBERSHIP_CANARY_SECRET = "CANARY-SEALED-IDENTITY-7314";
export const MEMBERSHIP_BIRTH_DATE = "1996-04-12";

/**
 * Demo-only local vault. This is deliberately not presented as a production
 * security boundary; it exists to make the no-raw-value contract observable.
 */
export function createMockPrivateVault(): MockPrivateVault {
  return Object.freeze({
    passportNumber: DEMO_CANARY_SECRET,
    monthlyIncome: 8_500,
    dateOfBirth: MEMBERSHIP_BIRTH_DATE,
    identityNumber: MEMBERSHIP_CANARY_SECRET,
  });
}
