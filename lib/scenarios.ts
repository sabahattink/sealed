import type { MockPrivateVault } from "@/lib/private-vault";

export type ScenarioId = "rental" | "membership";
export type WorkflowStep = 1 | 2 | 3;
export type ReviewState = "not_requested" | "requested";
export type RequirementResult = "not_checked" | "satisfied" | "not_satisfied";
export type BindingStatus = "unbound" | "bound";
export type PublicFieldValue = string | number;

export type PublicFieldId =
  | "full_name"
  | "email"
  | "property_address"
  | "monthly_rent"
  | "move_in_date"
  | "display_name"
  | "membership_plan";

export type PrivateFieldId = "passport_number" | "identity_number";
export type RequirementId = "income_3x_rent" | "age_18_plus";
export type UncertaintyTopic =
  | "income_eligibility"
  | "passport_number"
  | "property_details"
  | "age_eligibility"
  | "identity_number"
  | "membership_details";

export type WorkflowState = Readonly<{
  publicFields: Readonly<Partial<Record<PublicFieldId, PublicFieldValue>>>;
  privateBindings: Readonly<Partial<Record<PrivateFieldId, BindingStatus>>>;
  requirementResults: Readonly<Partial<Record<RequirementId, RequirementResult>>>;
}>;

export type ScenarioSection = Readonly<{
  id: string;
  label: string;
  requiredPublicFields: readonly PublicFieldId[];
  privateCapabilities?: readonly (PrivateFieldId | RequirementId)[];
}>;

export type ScenarioDefinition = Readonly<{
  id: ScenarioId;
  shortLabel: string;
  title: string;
  eyebrow: string;
  lede: string;
  workflowLabel: string;
  reviewLabel: string;
  steps: readonly Readonly<{ id: WorkflowStep; label: string; detail: string }>[];
  publicFields: readonly Readonly<{
    id: PublicFieldId;
    kind: "text" | "email" | "number" | "date" | "select";
    label: string;
    description: string;
    initialValue: PublicFieldValue;
    options?: readonly string[];
    complete: (value: PublicFieldValue | undefined) => boolean;
  }>[];
  sections: readonly ScenarioSection[];
  uncertaintyTopics: readonly UncertaintyTopic[];
  requirement: Readonly<{
    id: RequirementId;
    label: string;
    privateValueLabel: string;
    guidance: string;
    evaluate: (
      publicFields: WorkflowState["publicFields"],
      vault: MockPrivateVault,
    ) => Exclude<RequirementResult, "not_checked">;
  }>;
  binding: Readonly<{
    id: PrivateFieldId;
    label: string;
    guidance: string;
    isAvailable: (vault: MockPrivateVault) => boolean;
  }>;
}>;

const present = (value: PublicFieldValue | undefined) =>
  typeof value === "string" && value.trim().length > 0;
const namePresent = (value: PublicFieldValue | undefined) =>
  typeof value === "string" && value.trim().length > 1;
const emailPresent = (value: PublicFieldValue | undefined) =>
  typeof value === "string" && value.includes("@");
const positiveNumber = (value: PublicFieldValue | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export const SCENARIOS: Readonly<Record<ScenarioId, ScenarioDefinition>> = {
  rental: {
    id: "rental",
    shortLabel: "Rental",
    title: "Apply with confidence.",
    eyebrow: "Secure rental application",
    lede:
      "Complete the details for your next home while private checks stay inside this page. The connected agent gets useful decisions, never the values behind them.",
    workflowLabel: "Rental application",
    reviewLabel: "application",
    steps: [
      { id: 1, label: "Your details", detail: "Applicant" },
      { id: 2, label: "Your home", detail: "Property" },
      { id: 3, label: "Review & verify", detail: "Privacy check" },
    ],
    publicFields: [
      { id: "full_name", kind: "text", label: "Full name", description: "Applicant's public full name.", initialValue: "", complete: namePresent },
      { id: "email", kind: "email", label: "Email address", description: "Applicant's public contact email.", initialValue: "", complete: emailPresent },
      { id: "property_address", kind: "text", label: "Property address", description: "Public rental property address.", initialValue: "18 Cedar Lane, Baku", complete: present },
      { id: "monthly_rent", kind: "number", label: "Monthly rent", description: "Public monthly rent amount.", initialValue: 2_000, complete: positiveNumber },
      { id: "move_in_date", kind: "date", label: "Move-in date", description: "Public move-in date in YYYY-MM-DD form.", initialValue: "2026-09-01", complete: present },
    ],
    sections: [
      { id: "applicant_details", label: "Applicant details", requiredPublicFields: ["full_name", "email"] },
      { id: "home_details", label: "Home details", requiredPublicFields: ["property_address", "monthly_rent", "move_in_date"] },
      { id: "privacy_review", label: "Privacy review", requiredPublicFields: [], privateCapabilities: ["income_3x_rent", "passport_number"] },
    ],
    uncertaintyTopics: ["income_eligibility", "passport_number", "property_details"],
    requirement: {
      id: "income_3x_rent",
      label: "Income requirement",
      privateValueLabel: "Actual income",
      guidance: "Check whether private income is at least three times public rent without revealing income.",
      evaluate: (fields, vault) =>
        vault.monthlyIncome >= Number(fields.monthly_rent ?? 0) * 3
          ? "satisfied"
          : "not_satisfied",
    },
    binding: {
      id: "passport_number",
      label: "Passport number",
      guidance: "Bind the approved passport number locally without revealing it.",
      isAvailable: (vault) => vault.passportNumber.length > 0,
    },
  },
  membership: {
    id: "membership",
    shortLabel: "Membership",
    title: "Verify without revealing.",
    eyebrow: "Private membership enrollment",
    lede:
      "Join a community while age and identity checks execute locally. The same Sealed primitives return only approved outcomes to the agent.",
    workflowLabel: "Membership enrollment",
    reviewLabel: "enrollment",
    steps: [
      { id: 1, label: "Your profile", detail: "Member" },
      { id: 2, label: "Your plan", detail: "Membership" },
      { id: 3, label: "Review & verify", detail: "Privacy check" },
    ],
    publicFields: [
      { id: "display_name", kind: "text", label: "Display name", description: "Public name shown to the community.", initialValue: "", complete: namePresent },
      { id: "email", kind: "email", label: "Email address", description: "Public contact email.", initialValue: "", complete: emailPresent },
      { id: "membership_plan", kind: "select", label: "Membership plan", description: "Public membership tier.", initialValue: "Community", options: ["Community", "Supporter"], complete: present },
    ],
    sections: [
      { id: "member_profile", label: "Member profile", requiredPublicFields: ["display_name", "email"] },
      { id: "membership_details", label: "Membership details", requiredPublicFields: ["membership_plan"] },
      { id: "privacy_review", label: "Privacy review", requiredPublicFields: [], privateCapabilities: ["age_18_plus", "identity_number"] },
    ],
    uncertaintyTopics: ["age_eligibility", "identity_number", "membership_details"],
    requirement: {
      id: "age_18_plus",
      label: "Adult membership requirement",
      privateValueLabel: "Date of birth",
      guidance: "Check whether the private date of birth proves age 18 or older without revealing the date.",
      evaluate: (_fields, vault) => {
        const birth = new Date(`${vault.dateOfBirth}T00:00:00Z`);
        const cutoff = new Date("2026-08-28T00:00:00Z");
        cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 18);
        return birth <= cutoff ? "satisfied" : "not_satisfied";
      },
    },
    binding: {
      id: "identity_number",
      label: "Identity number",
      guidance: "Bind the approved identity number locally without revealing it.",
      isAvailable: (vault) => vault.identityNumber.length > 0,
    },
  },
};

export function getScenario(id: ScenarioId): ScenarioDefinition {
  return SCENARIOS[id];
}

export function createInitialWorkflow(id: ScenarioId): WorkflowState {
  const scenario = getScenario(id);
  return {
    publicFields: Object.fromEntries(
      scenario.publicFields.map((field) => [field.id, field.initialValue]),
    ),
    privateBindings: { [scenario.binding.id]: "unbound" },
    requirementResults: { [scenario.requirement.id]: "not_checked" },
  };
}

export function getRequirementResult(
  state: WorkflowState,
  scenario: ScenarioDefinition,
): RequirementResult {
  return state.requirementResults[scenario.requirement.id] ?? "not_checked";
}

export function getBindingStatus(
  state: WorkflowState,
  scenario: ScenarioDefinition,
): BindingStatus {
  return state.privateBindings[scenario.binding.id] ?? "unbound";
}

export function isPublicFieldComplete(
  scenario: ScenarioDefinition,
  fieldId: PublicFieldId,
  value: PublicFieldValue | undefined,
): boolean {
  return scenario.publicFields.find((field) => field.id === fieldId)?.complete(value) ?? false;
}

export function isStepComplete(
  scenario: ScenarioDefinition,
  workflow: WorkflowState,
  step: WorkflowStep,
): boolean {
  if (step === 3) return true;
  const section = scenario.sections[step - 1];
  return section.requiredPublicFields.every((fieldId) =>
    isPublicFieldComplete(scenario, fieldId, workflow.publicFields[fieldId]),
  );
}
