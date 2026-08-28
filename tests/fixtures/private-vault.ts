import type { MockPrivateVault } from "@/lib/private-vault";

export const DEMO_CANARY_SECRET = "TEST-CANARY-PASSPORT-4829";
export const MEMBERSHIP_CANARY_SECRET = "TEST-CANARY-IDENTITY-7314";
export const MEMBERSHIP_BIRTH_DATE = "1996-04-12";

export function createTestPrivateVault(): MockPrivateVault {
  return Object.freeze({
    passportNumber: DEMO_CANARY_SECRET,
    monthlyIncome: 8_500,
    dateOfBirth: MEMBERSHIP_BIRTH_DATE,
    identityNumber: MEMBERSHIP_CANARY_SECRET,
  });
}
