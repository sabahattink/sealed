import type {
  PrivateFieldId,
  PublicFieldId,
  RequirementId,
  ScenarioId,
  UncertaintyTopic,
} from "@/lib/scenarios";

export type ActivityToolName =
  | "get_application_context"
  | "set_public_fields"
  | "flag_uncertain"
  | "request_review"
  | "request_private_binding"
  | "evaluate_private_requirement";

export type RedactedToolInput =
  | Record<string, never>
  | { fields: readonly PublicFieldId[] }
  | { topic: UncertaintyTopic }
  | { field: PrivateFieldId }
  | { requirement: RequirementId };

export type RedactedToolOutput =
  | { status: "ok"; returned: "application_context"; scenario: ScenarioId }
  | { status: "updated"; updated_fields: readonly PublicFieldId[] }
  | { status: "denied"; field: PrivateFieldId }
  | { status: "flagged"; topic: UncertaintyTopic }
  | { status: "review_requested"; submitted: false }
  | { status: "bound"; field: PrivateFieldId; value: "withheld" }
  | {
      status: "satisfied" | "not_satisfied";
      requirement: RequirementId;
      value: "withheld";
    };

export type AgentActivityEntry = Readonly<{
  id: string;
  toolName: ActivityToolName;
  timestamp: string;
  actor: "agent";
  redactedInput: RedactedToolInput;
  redactedOutput: RedactedToolOutput;
}>;

export type PrivacyTraceEntry = Readonly<{
  id: string;
  timestamp: string;
  scenario: ScenarioId;
  capability: PrivateFieldId | RequirementId;
  localVaultAccess: "YES";
  domExposure: "NO";
  webmcpInputExposure: "NO";
  webmcpOutputExposure: "NO";
  returnedResult: "bound" | "satisfied" | "not_satisfied";
}>;

let eventSequence = 0;

function nextEventId(prefix: "activity" | "privacy") {
  eventSequence += 1;
  return `${prefix}-${eventSequence}`;
}

function now() {
  return new Date().toISOString();
}

export function createActivityEntry({ toolName, input, output }: {
  toolName: ActivityToolName;
  input: RedactedToolInput;
  output: RedactedToolOutput;
}): AgentActivityEntry {
  return {
    id: nextEventId("activity"),
    toolName,
    timestamp: now(),
    actor: "agent",
    redactedInput: input,
    redactedOutput: output,
  };
}

export function createPrivacyTraceEntry({ scenario, capability, returnedResult }: {
  scenario: ScenarioId;
  capability: PrivacyTraceEntry["capability"];
  returnedResult: PrivacyTraceEntry["returnedResult"];
}): PrivacyTraceEntry {
  return {
    id: nextEventId("privacy"),
    timestamp: now(),
    scenario,
    capability,
    localVaultAccess: "YES",
    domExposure: "NO",
    webmcpInputExposure: "NO",
    webmcpOutputExposure: "NO",
    returnedResult,
  };
}
