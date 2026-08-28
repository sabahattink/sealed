export type PrivateField = "passport_number";
export type RequirementResult = "not_checked" | "satisfied" | "not_satisfied";
export type ApplicationStep = 1 | 2 | 3;
export type ReviewState = "not_requested" | "requested";
export type UncertaintyTopic =
  | "income_eligibility"
  | "passport_number"
  | "property_details";

export type PublicApplicationField =
  | "fullName"
  | "email"
  | "propertyAddress"
  | "monthlyRent"
  | "moveInDate";

export type PublicApplicationFields = Pick<
  RentalApplicationState,
  PublicApplicationField
>;

export type RentalApplicationState = {
  fullName: string;
  email: string;
  propertyAddress: string;
  monthlyRent: number;
  moveInDate: string;
  privateBindings: Record<PrivateField, "unbound" | "bound">;
  requirementResult: RequirementResult;
};

export function createInitialRentalApplication(): RentalApplicationState {
  return {
    fullName: "",
    email: "",
    propertyAddress: "18 Cedar Lane, Baku",
    monthlyRent: 2_000,
    moveInDate: "2026-09-01",
    privateBindings: {
      passport_number: "unbound",
    },
    requirementResult: "not_checked",
  };
}

export function bindPrivateField(
  state: RentalApplicationState,
  field: PrivateField,
): RentalApplicationState {
  return {
    ...state,
    privateBindings: {
      ...state.privateBindings,
      [field]: "bound",
    },
  };
}

export function setRequirementResult(
  state: RentalApplicationState,
  requirementResult: Exclude<RequirementResult, "not_checked">,
): RentalApplicationState {
  return {
    ...state,
    requirementResult,
  };
}

export function evaluateIncomeRequirement(
  monthlyRent: number,
  privateMonthlyIncome: number,
): Exclude<RequirementResult, "not_checked"> {
  return privateMonthlyIncome >= monthlyRent * 3
    ? "satisfied"
    : "not_satisfied";
}
