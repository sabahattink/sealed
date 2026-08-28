export type ActivityToolName =
  | "get_application_context"
  | "set_public_fields"
  | "flag_uncertain"
  | "request_review"
  | "request_private_binding"
  | "evaluate_private_requirement";

export type RedactedToolInput =
  | Record<string, never>
  | {
      fields: readonly string[];
    }
  | {
      topic: "income_eligibility" | "passport_number" | "property_details";
    }
  | { field: "passport_number" }
  | { requirement: "income_3x_rent" };

export type RedactedToolOutput =
  | {
      status: "ok";
      returned: "application_context";
    }
  | {
      status: "updated";
      updated_fields: readonly string[];
    }
  | {
      status: "denied";
      field: "passport_number";
    }
  | {
      status: "flagged";
      topic: "income_eligibility" | "passport_number" | "property_details";
    }
  | {
      status: "review_requested";
      submitted: false;
    }
  | {
      status: "bound";
      field: "passport_number";
      value: "withheld";
    }
  | {
      status: "satisfied" | "not_satisfied";
      requirement: "income_3x_rent";
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
  capability: "passport_number" | "income_3x_rent";
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

export function createActivityEntry({
  toolName,
  input,
  output,
}: {
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

export function createPrivacyTraceEntry({
  capability,
  returnedResult,
}: {
  capability: PrivacyTraceEntry["capability"];
  returnedResult: PrivacyTraceEntry["returnedResult"];
}): PrivacyTraceEntry {
  return {
    id: nextEventId("privacy"),
    timestamp: now(),
    capability,
    localVaultAccess: "YES",
    domExposure: "NO",
    webmcpInputExposure: "NO",
    webmcpOutputExposure: "NO",
    returnedResult,
  };
}
