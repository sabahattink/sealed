import type { InputSchema, ModelContext, ModelContextTool } from "@mcp-b/webmcp-types";
import { createActivityEntry, createBoundaryLedgerEntry } from "@/lib/observability";
import { createLocalBindingArtifact, type MockPrivateVault } from "@/lib/private-vault";
import { containsRawPrivateValue, guardSafeEgress, guardToolExecution, type GuardedToolResponse } from "@/lib/safe-egress";
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
import type { RequirementSnapshot, ReviewPacket, SealedState, SealedStore } from "@/lib/sealed-store";

type SafeToolResponse<T extends Record<string, unknown>> = GuardedToolResponse<T>;

export const SEALED_TOOL_NAMES = ["get_application_context", "set_public_fields", "flag_uncertain", "request_review", "request_private_binding", "evaluate_private_requirement"] as const;
export type SealedToolName = (typeof SEALED_TOOL_NAMES)[number];

export const ACTIVE_TOOL_NAMES_BY_STEP = {
  1: ["get_application_context", "set_public_fields", "flag_uncertain", "request_private_binding", "evaluate_private_requirement"],
  2: ["get_application_context", "set_public_fields", "flag_uncertain", "request_review", "request_private_binding", "evaluate_private_requirement"],
  3: ["get_application_context", "flag_uncertain", "request_review", "request_private_binding", "evaluate_private_requirement"],
} as const satisfies Record<WorkflowStep, readonly SealedToolName[]>;

export const ACTIVE_TOOL_NAMES_BY_SCENARIO = { rental: ACTIVE_TOOL_NAMES_BY_STEP, membership: ACTIVE_TOOL_NAMES_BY_STEP } as const satisfies Record<ScenarioId, Record<WorkflowStep, readonly SealedToolName[]>>;
const REVIEW_REQUESTED_TOOL_NAMES = ["get_application_context", "flag_uncertain"] as const satisfies readonly SealedToolName[];

export function getActiveSealedToolNames(state: Pick<SealedState, "scenarioId" | "currentStep" | "reviewState">): readonly SealedToolName[] {
  return state.reviewState === "requested" ? REVIEW_REQUESTED_TOOL_NAMES : ACTIVE_TOOL_NAMES_BY_SCENARIO[state.scenarioId][state.currentStep];
}

type ApplicationContextResponse = SafeToolResponse<{
  status: "ok"; scenario_id: ScenarioId; current_step: WorkflowStep;
  public_fields: Partial<Record<PublicFieldId, PublicFieldValue>>;
  private_fields: Partial<Record<PrivateFieldId | "income" | "date_of_birth", "bound" | "unbound" | "withheld">>;
  private_requirement: { id: RequirementId; status: RequirementResult; value: "withheld"; evaluation: "available" | "sealed_for_session" };
  binding_artifact: { field: PrivateFieldId; ref: string } | null;
  review_packet_ref: string | null;
  review_state: "not_requested" | "requested";
  sections: Record<string, { required_public_fields: readonly PublicFieldId[]; section_complete: boolean; private_capabilities?: readonly (PrivateFieldId | RequirementId)[] }>;
  open_questions: readonly (PublicFieldId | PrivateFieldId | RequirementId | UncertaintyTopic)[];
}>;
type PublicFieldsResponse = SafeToolResponse<{ status: "updated"; updated_fields: readonly PublicFieldId[]; private_fields: "unchanged" }>;
type UncertaintyResponse = SafeToolResponse<{ status: "flagged"; topic: UncertaintyTopic }>;
type ReviewResponse = SafeToolResponse<{
  status: "review_requested"; submitted: false; packet_ref: string;
  requirement: { id: RequirementId; status: Exclude<RequirementResult, "not_checked"> };
  binding: { field: PrivateFieldId; ref: string };
}>;
type PrivateBindingResponse = SafeToolResponse<{ status: "bound"; field: PrivateFieldId; value: "withheld"; binding_ref: string }>;
type RequirementResponse = SafeToolResponse<{ status: "satisfied" | "not_satisfied"; requirement: RequirementId; value: "withheld"; evaluation: "sealed_for_session" }>;

type Tool<TInput extends Record<string, unknown>, TOutput, TName extends SealedToolName> = ModelContextTool<TInput, TOutput, TName> & { inputSchema: InputSchema };
export type SealedToolset = {
  get_application_context: Tool<Record<string, never>, ApplicationContextResponse, "get_application_context">;
  set_public_fields: Tool<{ fields: Partial<Record<PublicFieldId, PublicFieldValue>> }, PublicFieldsResponse, "set_public_fields">;
  flag_uncertain: Tool<{ topic: UncertaintyTopic }, UncertaintyResponse, "flag_uncertain">;
  request_review: Tool<Record<string, never>, ReviewResponse, "request_review">;
  request_private_binding: Tool<{ field: PrivateFieldId }, PrivateBindingResponse, "request_private_binding">;
  evaluate_private_requirement: Tool<{ requirement: RequirementId }, RequirementResponse, "evaluate_private_requirement">;
};
export type SealedToolRuntime = { vault: MockPrivateVault; store: SealedStore; now?: () => Date };

const emptyInputSchema = { type: "object", properties: {}, additionalProperties: false } as const;
function publicFieldsInputSchema(scenarioId: ScenarioId): InputSchema {
  const scenario = getScenario(scenarioId);
  const properties = Object.fromEntries(scenario.publicFields.map((field) => [field.id, {
    type: field.kind === "number" ? "number" : "string",
    ...(field.kind === "number" ? { minimum: 1 } : {}),
    ...(field.options ? { enum: field.options } : {}),
    description: field.description,
  }]));
  return { type: "object", properties: { fields: { type: "object", properties, minProperties: 1, additionalProperties: false } }, required: ["fields"], additionalProperties: false } as InputSchema;
}
function enumInputSchema(property: string, values: readonly string[], description: string): InputSchema {
  return { type: "object", properties: { [property]: { type: "string", enum: [...values], description } }, required: [property], additionalProperties: false } as InputSchema;
}
function normalizePublicFields(scenarioId: ScenarioId, fields: Partial<Record<PublicFieldId, PublicFieldValue>> | undefined) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error("set_public_fields requires at least one public field");
  const definitions = new Map(getScenario(scenarioId).publicFields.map((field) => [field.id, field]));
  const entries = Object.entries(fields);
  if (entries.length === 0) throw new Error("set_public_fields requires at least one public field");
  const normalized: Partial<Record<PublicFieldId, PublicFieldValue>> = {};
  const fieldIds: PublicFieldId[] = [];
  for (const [rawId, value] of entries) {
    const fieldId = rawId as PublicFieldId;
    const definition = definitions.get(fieldId);
    if (!definition) throw new Error("set_public_fields accepts active-scenario public fields only; sealed fields cannot be edited");
    if (definition.kind === "number" && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) throw new Error(`${fieldId} must be a positive number`);
    if (definition.kind !== "number" && typeof value !== "string") throw new Error(`${fieldId} must be text`);
    if (definition.options && !definition.options.includes(String(value))) throw new Error(`${fieldId} must be an allowed option`);
    normalized[fieldId] = value; fieldIds.push(fieldId);
  }
  return { fields: normalized, fieldIds };
}
function getOpenQuestionIds(state: SealedState) {
  const scenario = getScenario(state.scenarioId);
  const questions: (PublicFieldId | PrivateFieldId | RequirementId | UncertaintyTopic)[] = [];
  for (const field of scenario.publicFields) if (!isPublicFieldComplete(scenario, field.id, state.workflow.publicFields[field.id])) questions.push(field.id);
  if (getRequirementResult(state.workflow, scenario) === "not_checked") questions.push(scenario.requirement.id);
  if (getBindingStatus(state.workflow, scenario) === "unbound") questions.push(scenario.binding.id);
  for (const topic of state.uncertainTopics) if (!questions.includes(topic)) questions.push(topic);
  return questions;
}
function randomReviewRef() { return `review_${crypto.randomUUID().replaceAll("-", "")}`; }
function privateCredential(vault: MockPrivateVault, field: PrivateFieldId) { return field === "passport_number" ? vault.passportNumber : vault.identityNumber; }

export function assertSafeToolMetadata(tools: SealedToolset, vault: MockPrivateVault): void {
  for (const tool of Object.values(tools)) {
    if (containsRawPrivateValue(tool.description, vault) || containsRawPrivateValue(tool.inputSchema, vault)) throw new Error("Sealed blocked unsafe tool metadata");
  }
}

export function createSealedToolset({ vault, store, now = () => new Date() }: SealedToolRuntime): SealedToolset {
  const captured = store.getSnapshot();
  const scenario = getScenario(captured.scenarioId);
  const noun = scenario.workflowLabel.toLowerCase();
  const assertRuntime = (toolName: SealedToolName) => {
    const state = store.getSnapshot();
    if (state.demoSession !== captured.demoSession) throw new Error("Tool handler is stale for the active demo session");
    if (state.scenarioId !== captured.scenarioId) throw new Error("Tool handler is stale for the active scenario");
    if (state.currentStep !== captured.currentStep || state.reviewState !== captured.reviewState) throw new Error("Tool handler is stale for the active tool surface");
    if (!getActiveSealedToolNames(state).includes(toolName)) throw new Error("Tool is not on the active tool surface");
    return state;
  };
  const guarded = <T extends Record<string, unknown>>(execute: () => SafeToolResponse<T> | Promise<SafeToolResponse<T>>) => guardToolExecution(vault, execute) as SafeToolResponse<T> | Promise<SafeToolResponse<T>>;

  const getApplicationContext: SealedToolset["get_application_context"] = {
    name: "get_application_context", title: "Get workflow context",
    description: `Read-only. Returns current ${noun} public fields, fixed requirements, open question IDs, review state, and redacted private statuses through guarded egress. Raw private values remain withheld.`,
    inputSchema: emptyInputSchema, annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: () => guarded(() => {
      const state = assertRuntime("get_application_context");
      const sections = Object.fromEntries(scenario.sections.map((section) => [section.id, {
        required_public_fields: section.requiredPublicFields,
        section_complete: section.requiredPublicFields.every((fieldId) => isPublicFieldComplete(scenario, fieldId, state.workflow.publicFields[fieldId])),
        ...(section.privateCapabilities ? { private_capabilities: section.privateCapabilities } : {}),
      }]));
      const artifact = state.bindingArtifacts[scenario.binding.id];
      const response = guardSafeEgress({
        content: [{ type: "text", text: "Workflow context returned through guarded egress. Private values remain withheld." }],
        structuredContent: {
          status: "ok" as const, scenario_id: state.scenarioId, current_step: state.currentStep, public_fields: state.workflow.publicFields,
          private_fields: { [scenario.binding.id]: getBindingStatus(state.workflow, scenario), [scenario.id === "rental" ? "income" : "date_of_birth"]: "withheld" as const },
          private_requirement: { id: scenario.requirement.id, status: getRequirementResult(state.workflow, scenario), value: "withheld" as const, evaluation: state.requirementSnapshots[scenario.requirement.id] ? "sealed_for_session" as const : "available" as const },
          binding_artifact: artifact ? { field: artifact.field, ref: artifact.ref } : null,
          review_packet_ref: state.reviewPacket?.ref ?? null,
          review_state: state.reviewState, sections, open_questions: getOpenQuestionIds(state),
        },
      }, vault) as ApplicationContextResponse;
      store.recordAgentActivity({ activity: createActivityEntry({ toolName: "get_application_context", input: {}, output: { status: "ok", returned: "application_context", scenario: state.scenarioId } }), lastToolResponse: response.content[0].text });
      return response;
    }),
  };

  const setPublicFields: SealedToolset["set_public_fields"] = {
    name: "set_public_fields", title: "Set public workflow fields",
    description: `Mutation. Update only allowlisted public fields for the active ${noun}. Dependencies used by a private predicate become immutable for that demo session.`,
    inputSchema: publicFieldsInputSchema(scenario.id), annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: ({ fields }) => guarded(() => {
      assertRuntime("set_public_fields");
      const normalized = normalizePublicFields(scenario.id, fields);
      const response = guardSafeEgress({ content: [{ type: "text", text: "Public fields updated. Sealed fields remain unchanged." }], structuredContent: { status: "updated" as const, updated_fields: normalized.fieldIds, private_fields: "unchanged" as const } }, vault) as PublicFieldsResponse;
      store.setPublicFields(normalized.fields);
      store.recordAgentActivity({ activity: createActivityEntry({ toolName: "set_public_fields", input: { fields: normalized.fieldIds }, output: { status: "updated", updated_fields: normalized.fieldIds } }), lastToolResponse: response.content[0].text });
      return response;
    }),
  };

  const flagUncertain: SealedToolset["flag_uncertain"] = {
    name: "flag_uncertain", title: "Flag uncertainty", description: "Mutation. Record one fixed active-scenario topic for human attention without changing private data.",
    inputSchema: enumInputSchema("topic", scenario.uncertaintyTopics, "Fixed topic for human review."), annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: ({ topic }) => guarded(() => {
      assertRuntime("flag_uncertain");
      if (!scenario.uncertaintyTopics.includes(topic)) throw new Error("Unsupported uncertainty topic for active scenario");
      const response = guardSafeEgress({ content: [{ type: "text", text: "Uncertainty flagged for human review." }], structuredContent: { status: "flagged" as const, topic } }, vault) as UncertaintyResponse;
      store.flagUncertain(topic);
      store.recordAgentActivity({ activity: createActivityEntry({ toolName: "flag_uncertain", input: { topic }, output: response.structuredContent }), lastToolResponse: response.content[0].text });
      return response;
    }),
  };

  const requestReview: SealedToolset["request_review"] = {
    name: "request_review", title: "Request human review",
    description: `Mutation. Build a safe local review packet from the sealed predicate verdict and approved opaque binding. It never submits, sends, enrolls, or exposes raw private values.`,
    inputSchema: emptyInputSchema, annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: () => guarded(() => {
      const state = assertRuntime("request_review");
      const result = getRequirementResult(state.workflow, scenario);
      const artifact = state.bindingArtifacts[scenario.binding.id];
      if (result === "not_checked" || !artifact || artifact.demoSession !== state.demoSession || artifact.scenarioId !== state.scenarioId) throw new Error("Review requires a private predicate verdict and approved binding artifact");
      const packet: ReviewPacket = { ref: randomReviewRef(), scenarioId: state.scenarioId, demoSession: state.demoSession, requirement: scenario.requirement.id, requirementStatus: result, bindingRef: artifact.ref, submitted: false };
      const response = guardSafeEgress({ content: [{ type: "text", text: "Safe review packet created for human review. Nothing was submitted." }], structuredContent: { status: "review_requested" as const, submitted: false as const, packet_ref: packet.ref, requirement: { id: packet.requirement, status: packet.requirementStatus }, binding: { field: artifact.field, ref: artifact.ref } } }, vault) as ReviewResponse;
      store.requestReview(packet);
      store.recordAgentActivity({ activity: createActivityEntry({ toolName: "request_review", input: {}, output: { status: "review_requested", submitted: false, packet_ref: packet.ref } }), lastToolResponse: response.content[0].text });
      return response;
    }),
  };

  const requestPrivateBinding: SealedToolset["request_private_binding"] = {
    name: "request_private_binding", title: "Request private binding",
    description: `Request the active fixed private binding. Human approval is mandatory. The raw credential is consumed locally to create a random opaque session-bound artifact; guarded egress returns only its non-secret reference.`,
    inputSchema: enumInputSchema("field", [scenario.binding.id], scenario.binding.guidance), annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: async ({ field }) => guarded(async () => {
      const state = assertRuntime("request_private_binding");
      if (field !== scenario.binding.id) throw new Error("Unsupported private field for active scenario");
      if (state.bindingArtifacts[field]) throw new Error("Private binding is already sealed for this demo session");
      const rawCredential = privateCredential(vault, field);
      if (!scenario.binding.isAvailable(vault)) throw new Error("Private binding value unavailable");
      const approved = await store.requestPrivateBindingApproval(field);
      const current = assertRuntime("request_private_binding");
      if (!approved) {
        store.recordAgentActivity({ activity: createActivityEntry({ toolName: "request_private_binding", input: { field }, output: { status: "denied", field } }), lastToolResponse: "Private binding was not approved." });
        throw new Error("Private binding was not approved");
      }
      const artifact = createLocalBindingArtifact({ value: rawCredential, field, scenarioId: current.scenarioId, demoSession: current.demoSession, now: now() });
      const response = guardSafeEgress({ content: [{ type: "text", text: "Opaque private binding created locally. Raw value withheld." }], structuredContent: { status: "bound" as const, field, value: "withheld" as const, binding_ref: artifact.ref } }, vault) as PrivateBindingResponse;
      store.dispatch({
        type: "private_binding_completed", field, artifact,
        activity: createActivityEntry({ toolName: "request_private_binding", input: { field }, output: response.structuredContent }),
        boundaryLedgerEntry: createBoundaryLedgerEntry({ scenario: scenario.id, capability: field, localOperation: "opaque_binding", guardedPayload: { status: "bound", field, value: "withheld", binding_ref: artifact.ref } }),
        lastToolResponse: response.content[0].text,
      });
      return response;
    }) as Promise<PrivateBindingResponse>,
  };

  const evaluatePrivateRequirement: SealedToolset["evaluate_private_requirement"] = {
    name: "evaluate_private_requirement", title: "Evaluate private requirement",
    description: `Evaluate only the active fixed predicate once per demo session. Public dependencies are snapshotted and locked; duplicate evaluation is rejected to prevent probing. Guarded egress returns only satisfied or not_satisfied with value withheld.`,
    inputSchema: enumInputSchema("requirement", [scenario.requirement.id], scenario.requirement.guidance), annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: ({ requirement }) => guarded(() => {
      const state = assertRuntime("evaluate_private_requirement");
      if (requirement !== scenario.requirement.id) throw new Error("Unsupported private requirement for active scenario");
      if (state.requirementSnapshots[requirement]) throw new Error("Private requirement is already sealed for this demo session");
      const evaluatedAt = now();
      const dependencies = Object.fromEntries(scenario.requirement.publicDependencies.map((field) => [field, state.workflow.publicFields[field]]));
      const snapshot: RequirementSnapshot = { requirement, publicDependencies: dependencies, evaluatedAt: evaluatedAt.toISOString() };
      const result = scenario.requirement.evaluate({ ...state.workflow.publicFields, ...dependencies }, vault, evaluatedAt);
      const response = guardSafeEgress({ content: [{ type: "text", text: result === "satisfied" ? "Requirement satisfied. Private values remain withheld." : "Requirement not satisfied. Private values remain withheld." }], structuredContent: { status: result, requirement, value: "withheld" as const, evaluation: "sealed_for_session" as const } }, vault) as RequirementResponse;
      store.dispatch({
        type: "private_requirement_evaluated", requirement, result, snapshot,
        activity: createActivityEntry({ toolName: "evaluate_private_requirement", input: { requirement }, output: { status: result, requirement, value: "withheld" } }),
        boundaryLedgerEntry: createBoundaryLedgerEntry({ scenario: scenario.id, capability: requirement, localOperation: "predicate_evaluation", guardedPayload: { status: result, requirement, value: "withheld" } }),
        lastToolResponse: response.content[0].text,
      });
      return response;
    }),
  };

  const tools = { get_application_context: getApplicationContext, set_public_fields: setPublicFields, flag_uncertain: flagUncertain, request_review: requestReview, request_private_binding: requestPrivateBinding, evaluate_private_requirement: evaluatePrivateRequirement };
  assertSafeToolMetadata(tools, vault);
  return tools;
}

export async function registerSealedTools(modelContext: ModelContext, tools: SealedToolset, signal?: AbortSignal, activeToolNames: readonly SealedToolName[] = SEALED_TOOL_NAMES): Promise<void> {
  type RegisterableTool = ModelContextTool<Record<string, unknown>, unknown, string> & { inputSchema: InputSchema };
  for (const toolName of activeToolNames) await modelContext.registerTool(tools[toolName] as unknown as RegisterableTool, { signal });
}
