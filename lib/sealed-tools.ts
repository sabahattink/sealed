import type { InputSchema, ModelContext, ModelContextTool } from "@mcp-b/webmcp-types";
import type { MockPrivateVault } from "@/lib/private-vault";
import { createActivityEntry, createPrivacyTraceEntry } from "@/lib/observability";
import {
  getBindingStatus,
  getRequirementResult,
  getScenario,
  isPublicFieldComplete,
  type PrivateFieldId,
  type PublicFieldId,
  type PublicFieldValue,
  type RequirementId,
  type RequirementResult,
  type ScenarioId,
  type UncertaintyTopic,
  type WorkflowStep,
} from "@/lib/scenarios";
import type { SealedState, SealedStore } from "@/lib/sealed-store";

type TextContent = { type: "text"; text: string };
type SafeToolResponse<T extends Record<string, unknown>> = {
  content: [TextContent];
  structuredContent: T;
};

export const SEALED_TOOL_NAMES = [
  "get_application_context",
  "set_public_fields",
  "flag_uncertain",
  "request_review",
  "request_private_binding",
  "evaluate_private_requirement",
] as const;

export type SealedToolName = (typeof SEALED_TOOL_NAMES)[number];

export const ACTIVE_TOOL_NAMES_BY_STEP = {
  1: ["get_application_context", "set_public_fields", "flag_uncertain", "request_private_binding", "evaluate_private_requirement"],
  2: ["get_application_context", "set_public_fields", "flag_uncertain", "request_review", "request_private_binding", "evaluate_private_requirement"],
  3: ["get_application_context", "flag_uncertain", "request_review", "request_private_binding", "evaluate_private_requirement"],
} as const satisfies Record<WorkflowStep, readonly SealedToolName[]>;

export const ACTIVE_TOOL_NAMES_BY_SCENARIO = {
  rental: ACTIVE_TOOL_NAMES_BY_STEP,
  membership: ACTIVE_TOOL_NAMES_BY_STEP,
} as const satisfies Record<ScenarioId, Record<WorkflowStep, readonly SealedToolName[]>>;

const REVIEW_REQUESTED_TOOL_NAMES = ["get_application_context", "flag_uncertain"] as const satisfies readonly SealedToolName[];

export function getActiveSealedToolNames(
  state: Pick<SealedState, "scenarioId" | "currentStep" | "reviewState">,
): readonly SealedToolName[] {
  if (state.reviewState === "requested") return REVIEW_REQUESTED_TOOL_NAMES;
  return ACTIVE_TOOL_NAMES_BY_SCENARIO[state.scenarioId][state.currentStep];
}

type ApplicationContextResponse = SafeToolResponse<{
  status: "ok";
  scenario_id: ScenarioId;
  current_step: WorkflowStep;
  public_fields: Partial<Record<PublicFieldId, PublicFieldValue>>;
  private_fields: Partial<Record<PrivateFieldId | "income" | "date_of_birth", "bound" | "unbound" | "withheld">>;
  private_requirement: { id: RequirementId; status: RequirementResult; value: "withheld" };
  review_state: "not_requested" | "requested";
  sections: Record<string, {
    required_public_fields: readonly PublicFieldId[];
    section_complete: boolean;
    private_capabilities?: readonly (PrivateFieldId | RequirementId)[];
  }>;
  open_questions: readonly (PublicFieldId | PrivateFieldId | RequirementId | UncertaintyTopic)[];
}>;

type PublicFieldsResponse = SafeToolResponse<{
  status: "updated";
  updated_fields: readonly PublicFieldId[];
  private_fields: "unchanged";
}>;
type UncertaintyResponse = SafeToolResponse<{ status: "flagged"; topic: UncertaintyTopic }>;
type ReviewResponse = SafeToolResponse<{ status: "review_requested"; submitted: false }>;
type PrivateBindingResponse = SafeToolResponse<{ status: "bound"; field: PrivateFieldId; value: "withheld" }>;
type RequirementResponse = SafeToolResponse<{
  status: "satisfied" | "not_satisfied";
  requirement: RequirementId;
  value: "withheld";
}>;

type Tool<TInput extends Record<string, unknown>, TOutput, TName extends SealedToolName> =
  ModelContextTool<TInput, TOutput, TName> & { inputSchema: InputSchema };

export type SealedToolset = {
  get_application_context: Tool<Record<string, never>, ApplicationContextResponse, "get_application_context">;
  set_public_fields: Tool<{ fields: Partial<Record<PublicFieldId, PublicFieldValue>> }, PublicFieldsResponse, "set_public_fields">;
  flag_uncertain: Tool<{ topic: UncertaintyTopic }, UncertaintyResponse, "flag_uncertain">;
  request_review: Tool<Record<string, never>, ReviewResponse, "request_review">;
  request_private_binding: Tool<{ field: PrivateFieldId }, PrivateBindingResponse, "request_private_binding">;
  evaluate_private_requirement: Tool<{ requirement: RequirementId }, RequirementResponse, "evaluate_private_requirement">;
};

export type SealedToolRuntime = { vault: MockPrivateVault; store: SealedStore };

const emptyInputSchema = { type: "object", properties: {}, additionalProperties: false } as const;

function publicFieldsInputSchema(scenarioId: ScenarioId): InputSchema {
  const scenario = getScenario(scenarioId);
  const properties = Object.fromEntries(scenario.publicFields.map((field) => [
    field.id,
    {
      type: field.kind === "number" ? "number" : "string",
      ...(field.kind === "number" ? { minimum: 1 } : {}),
      ...(field.options ? { enum: field.options } : {}),
      description: field.description,
    },
  ]));
  return {
    type: "object",
    properties: {
      fields: { type: "object", properties, minProperties: 1, additionalProperties: false },
    },
    required: ["fields"],
    additionalProperties: false,
  } as InputSchema;
}

function enumInputSchema(property: string, values: readonly string[], description: string): InputSchema {
  return {
    type: "object",
    properties: { [property]: { type: "string", enum: [...values], description } },
    required: [property],
    additionalProperties: false,
  } as InputSchema;
}

function normalizePublicFields(
  scenarioId: ScenarioId,
  fields: Partial<Record<PublicFieldId, PublicFieldValue>> | undefined,
): { fields: Partial<Record<PublicFieldId, PublicFieldValue>>; fieldIds: readonly PublicFieldId[] } {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("set_public_fields requires at least one public field");
  }
  const scenario = getScenario(scenarioId);
  const definitions = new Map(scenario.publicFields.map((field) => [field.id, field]));
  const entries = Object.entries(fields);
  if (entries.length === 0) throw new Error("set_public_fields requires at least one public field");

  const normalized: Partial<Record<PublicFieldId, PublicFieldValue>> = {};
  const fieldIds: PublicFieldId[] = [];
  for (const [rawId, value] of entries) {
    const fieldId = rawId as PublicFieldId;
    const definition = definitions.get(fieldId);
    if (!definition) {
      throw new Error("set_public_fields accepts active-scenario public fields only; sealed fields cannot be edited");
    }
    if (definition.kind === "number") {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new Error(`${fieldId} must be a positive number`);
      }
    } else if (typeof value !== "string") {
      throw new Error(`${fieldId} must be text`);
    }
    if (definition.options && !definition.options.includes(String(value))) {
      throw new Error(`${fieldId} must be an allowed option`);
    }
    normalized[fieldId] = value;
    fieldIds.push(fieldId);
  }
  return { fields: normalized, fieldIds };
}

function getOpenQuestionIds(state: SealedState) {
  const scenario = getScenario(state.scenarioId);
  const questions: (PublicFieldId | PrivateFieldId | RequirementId | UncertaintyTopic)[] = [];
  for (const field of scenario.publicFields) {
    if (!isPublicFieldComplete(scenario, field.id, state.workflow.publicFields[field.id])) questions.push(field.id);
  }
  if (getRequirementResult(state.workflow, scenario) === "not_checked") questions.push(scenario.requirement.id);
  if (getBindingStatus(state.workflow, scenario) === "unbound") questions.push(scenario.binding.id);
  for (const topic of state.uncertainTopics) if (!questions.includes(topic)) questions.push(topic);
  return questions;
}

function recordActivity(
  store: SealedStore,
  toolName: "get_application_context" | "set_public_fields" | "flag_uncertain" | "request_review",
  input: Parameters<typeof createActivityEntry>[0]["input"],
  output: Parameters<typeof createActivityEntry>[0]["output"],
  lastToolResponse: string,
) {
  store.recordAgentActivity({ activity: createActivityEntry({ toolName, input, output }), lastToolResponse });
}

export function createSealedToolset({ vault, store }: SealedToolRuntime): SealedToolset {
  const scenario = getScenario(store.getSnapshot().scenarioId);
  const noun = scenario.workflowLabel.toLowerCase();

  const getApplicationContext: SealedToolset["get_application_context"] = {
    name: "get_application_context",
    title: "Get workflow context",
    description: `Read-only. Use whenever the agent needs the current ${noun} context before acting. Returns public fields, fixed section requirements, open question IDs, review state, and redacted private statuses. It never returns raw vault values; ${scenario.id === "rental" ? "income" : scenario.requirement.privateValueLabel.toLowerCase()} remains withheld.`,
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: () => {
      const state = store.getSnapshot();
      const activeScenario = getScenario(state.scenarioId);
      const sections = Object.fromEntries(activeScenario.sections.map((section) => [section.id, {
        required_public_fields: section.requiredPublicFields,
        section_complete: section.requiredPublicFields.every((fieldId) =>
          isPublicFieldComplete(activeScenario, fieldId, state.workflow.publicFields[fieldId]),
        ),
        ...(section.privateCapabilities ? { private_capabilities: section.privateCapabilities } : {}),
      }]));
      const response: ApplicationContextResponse = {
        content: [{ type: "text", text: "Workflow context returned. Private values remain withheld." }],
        structuredContent: {
          status: "ok",
          scenario_id: state.scenarioId,
          current_step: state.currentStep,
          public_fields: state.workflow.publicFields,
          private_fields: {
            [activeScenario.binding.id]: getBindingStatus(state.workflow, activeScenario),
            [activeScenario.id === "rental" ? "income" : "date_of_birth"]: "withheld",
          },
          private_requirement: {
            id: activeScenario.requirement.id,
            status: getRequirementResult(state.workflow, activeScenario),
            value: "withheld",
          },
          review_state: state.reviewState,
          sections,
          open_questions: getOpenQuestionIds(state),
        },
      };
      recordActivity(store, "get_application_context", {}, {
        status: "ok", returned: "application_context", scenario: state.scenarioId,
      }, response.content[0].text);
      return response;
    },
  };

  const setPublicFields: SealedToolset["set_public_fields"] = {
    name: "set_public_fields",
    title: "Set public workflow fields",
    description: `Mutation. Update only the allowlisted public fields for the active ${noun}. Private and sealed fields are rejected by schema and runtime.`,
    inputSchema: publicFieldsInputSchema(scenario.id),
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: ({ fields }) => {
      const normalized = normalizePublicFields(scenario.id, fields);
      store.setPublicFields(normalized.fields);
      const response: PublicFieldsResponse = {
        content: [{ type: "text", text: "Public fields updated. Sealed fields remain unchanged." }],
        structuredContent: { status: "updated", updated_fields: normalized.fieldIds, private_fields: "unchanged" },
      };
      recordActivity(store, "set_public_fields", { fields: normalized.fieldIds }, {
        status: "updated", updated_fields: normalized.fieldIds,
      }, response.content[0].text);
      return response;
    },
  };

  const flagUncertain: SealedToolset["flag_uncertain"] = {
    name: "flag_uncertain",
    title: "Flag uncertainty",
    description: "Mutation. Record one active-scenario topic for human attention without exposing or changing private data.",
    inputSchema: enumInputSchema("topic", scenario.uncertaintyTopics, "Fixed topic for human review."),
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: ({ topic }) => {
      if (!scenario.uncertaintyTopics.includes(topic)) throw new Error("Unsupported uncertainty topic for active scenario");
      store.flagUncertain(topic);
      const response: UncertaintyResponse = {
        content: [{ type: "text", text: "Uncertainty flagged for human review. Private values remain withheld." }],
        structuredContent: { status: "flagged", topic },
      };
      recordActivity(store, "flag_uncertain", { topic }, { status: "flagged", topic }, response.content[0].text);
      return response;
    },
  };

  const requestReview: SealedToolset["request_review"] = {
    name: "request_review",
    title: "Request human review",
    description: scenario.id === "rental"
      ? "Mutation. Move this rental application to human review. It never submits the application, sends it to a landlord, or exposes raw private values."
      : `Mutation. Move this ${noun} to human review. It never submits, sends, enrolls, or exposes raw private values.`,
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: () => {
      store.requestReview();
      const response: ReviewResponse = {
        content: [{ type: "text", text: "Human review requested. Nothing was submitted." }],
        structuredContent: { status: "review_requested", submitted: false },
      };
      recordActivity(store, "request_review", {}, response.structuredContent, response.content[0].text);
      return response;
    },
  };

  const requestPrivateBinding: SealedToolset["request_private_binding"] = {
    name: "request_private_binding",
    title: "Request private binding",
    description: scenario.id === "rental"
      ? "Use this tool whenever the user asks to bind the approved passport number into the rental application while keeping the raw value private. It is the only supported way for an agent to request this private binding. Human approval is mandatory; the agent receives only bound and withheld."
      : `Use only after the user asks to ${scenario.binding.guidance.toLowerCase()} Human approval is mandatory; the agent receives only bound and withheld.`,
    inputSchema: enumInputSchema("field", [scenario.binding.id], scenario.binding.guidance),
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: async ({ field }) => {
      if (field !== scenario.binding.id) throw new Error("Unsupported private field for active scenario");
      if (!scenario.binding.isAvailable(vault)) throw new Error("Private binding value unavailable");
      const requestSession = store.getSnapshot().demoSession;
      const approved = await store.requestPrivateBindingApproval(field);
      if (!approved) {
        if (store.getSnapshot().demoSession !== requestSession) {
          throw new Error("Private binding request was cancelled by demo reset");
        }
        store.recordAgentActivity({
          activity: createActivityEntry({ toolName: "request_private_binding", input: { field }, output: { status: "denied", field } }),
          lastToolResponse: "Private binding was not approved.",
        });
        throw new Error("Private binding was not approved");
      }
      const response: PrivateBindingResponse = {
        content: [{ type: "text", text: "Private value bound locally. Raw private values remain withheld." }],
        structuredContent: { status: "bound", field, value: "withheld" },
      };
      store.dispatch({
        type: "private_binding_completed",
        field,
        activity: createActivityEntry({ toolName: "request_private_binding", input: { field }, output: response.structuredContent }),
        privacyTrace: createPrivacyTraceEntry({ scenario: scenario.id, capability: field, returnedResult: "bound" }),
        lastToolResponse: response.content[0].text,
      });
      return response;
    },
  };

  const evaluatePrivateRequirement: SealedToolset["evaluate_private_requirement"] = {
    name: "evaluate_private_requirement",
    title: "Evaluate private requirement",
    description: scenario.id === "rental"
      ? "Use this tool whenever the user asks whether they meet the rental income requirement while keeping income private. This is the only safe way for an agent to determine rental-income eligibility without accessing the raw private income: it evaluates the private income locally and returns only whether the requirement is satisfied or not satisfied. The agent must not infer or guess the result from visible page content."
      : `Use only for the active scenario predicate: ${scenario.requirement.guidance} The page executes locally and returns only satisfied or not_satisfied with value withheld.`,
    inputSchema: enumInputSchema("requirement", [scenario.requirement.id], scenario.requirement.guidance),
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: ({ requirement }) => {
      if (requirement !== scenario.requirement.id) throw new Error("Unsupported private requirement for active scenario");
      const result = scenario.requirement.evaluate(store.getSnapshot().workflow.publicFields, vault);
      const response: RequirementResponse = {
        content: [{
          type: "text",
          text: result === "satisfied"
            ? "Requirement satisfied. Private values remain withheld."
            : "Requirement not satisfied. Private values remain withheld.",
        }],
        structuredContent: { status: result, requirement, value: "withheld" },
      };
      store.dispatch({
        type: "private_requirement_evaluated",
        requirement,
        result,
        activity: createActivityEntry({ toolName: "evaluate_private_requirement", input: { requirement }, output: response.structuredContent }),
        privacyTrace: createPrivacyTraceEntry({ scenario: scenario.id, capability: requirement, returnedResult: result }),
        lastToolResponse: response.content[0].text,
      });
      return response;
    },
  };

  return {
    get_application_context: getApplicationContext,
    set_public_fields: setPublicFields,
    flag_uncertain: flagUncertain,
    request_review: requestReview,
    request_private_binding: requestPrivateBinding,
    evaluate_private_requirement: evaluatePrivateRequirement,
  };
}

export async function registerSealedTools(
  modelContext: ModelContext,
  tools: SealedToolset,
  signal?: AbortSignal,
  activeToolNames: readonly SealedToolName[] = SEALED_TOOL_NAMES,
): Promise<void> {
  type RegisterableTool = ModelContextTool<Record<string, unknown>, unknown, string> & { inputSchema: InputSchema };
  for (const toolName of activeToolNames) {
    await modelContext.registerTool(tools[toolName] as unknown as RegisterableTool, { signal });
  }
}
