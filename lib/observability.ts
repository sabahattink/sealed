import type { PrivateFieldId, PublicFieldId, RequirementId, ScenarioId, UncertaintyTopic } from "@/lib/scenarios";
import type { GuardedToolResponse } from "@/lib/safe-egress";

export type ActivityToolName = "get_application_context" | "set_public_fields" | "flag_uncertain" | "request_review" | "request_private_binding" | "evaluate_private_requirement";
export type RedactedToolInput = Record<string, never> | { fields: readonly PublicFieldId[] } | { topic: UncertaintyTopic } | { field: PrivateFieldId } | { requirement: RequirementId };
export type RedactedToolOutput =
  | { status: "ok"; returned: "application_context"; scenario: ScenarioId }
  | { status: "updated"; updated_fields: readonly PublicFieldId[] }
  | { status: "denied"; field: PrivateFieldId }
  | { status: "flagged"; topic: UncertaintyTopic }
  | { status: "review_requested"; submitted: false; packet_ref: string }
  | { status: "bound"; field: PrivateFieldId; value: "withheld"; binding_ref: string }
  | { status: "satisfied" | "not_satisfied"; requirement: RequirementId; value: "withheld" };

export type AgentActivityEntry = Readonly<{ id: string; toolName: ActivityToolName; timestamp: string; actor: "agent"; redactedInput: RedactedToolInput; redactedOutput: RedactedToolOutput }>;
export type BoundaryLedgerEntry = Readonly<{
  id: string;
  timestamp: string;
  scenario: ScenarioId;
  capability: PrivateFieldId | RequirementId;
  localOperation: "predicate_evaluation" | "opaque_binding";
  guardedPayload: Readonly<Record<string, unknown>>;
}>;

let eventSequence = 0;
function nextEventId(prefix: "activity" | "boundary") { eventSequence += 1; return `${prefix}-${eventSequence}`; }

export function createActivityEntry({ toolName, input, output }: { toolName: ActivityToolName; input: RedactedToolInput; output: RedactedToolOutput }): AgentActivityEntry {
  return { id: nextEventId("activity"), toolName, timestamp: new Date().toISOString(), actor: "agent", redactedInput: input, redactedOutput: output };
}

export function createBoundaryLedgerEntry<T extends Record<string, unknown>>({ scenario, capability, localOperation, guardedResponse }: {
  scenario: ScenarioId;
  capability: BoundaryLedgerEntry["capability"];
  localOperation: BoundaryLedgerEntry["localOperation"];
  guardedResponse: GuardedToolResponse<T>;
}): BoundaryLedgerEntry {
  return { id: nextEventId("boundary"), timestamp: new Date().toISOString(), scenario, capability, localOperation, guardedPayload: guardedResponse.structuredContent };
}
