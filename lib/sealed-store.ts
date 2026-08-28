import type { AgentActivityEntry, BoundaryLedgerEntry } from "@/lib/observability";
import type { LocalBindingArtifact } from "@/lib/private-vault";
import {
  createInitialWorkflow,
  getScenario,
  type PrivateFieldId,
  type PublicFieldId,
  type PublicFieldValue,
  type RequirementId,
  type RequirementResult,
  type ReviewState,
  type ScenarioId,
  type UncertaintyTopic,
  type WorkflowState,
  type WorkflowStep,
} from "@/lib/scenarios";

export type { PublicFieldId } from "@/lib/scenarios";

const MAX_TRACE_ENTRIES = 8;
type AgentActivityMetadata = { activity: AgentActivityEntry; lastToolResponse: string };
type PrivateOperationMetadata = AgentActivityMetadata & { boundaryLedgerEntry: BoundaryLedgerEntry };

export type RequirementSnapshot = Readonly<{
  requirement: RequirementId;
  publicDependencies: Readonly<Partial<Record<PublicFieldId, PublicFieldValue>>>;
  evaluatedAt: string;
}>;

export type ReviewPacket = Readonly<{
  ref: string;
  scenarioId: ScenarioId;
  demoSession: number;
  requirement: RequirementId;
  requirementStatus: Exclude<RequirementResult, "not_checked">;
  bindingRef: string;
  submitted: false;
}>;

export type PendingPrivateBindingApproval = Readonly<{ requestId: string; field: PrivateFieldId }>;

export type SealedState = Readonly<{
  scenarioId: ScenarioId;
  demoSession: number;
  workflow: WorkflowState;
  currentStep: WorkflowStep;
  reviewState: ReviewState;
  uncertainTopics: readonly UncertaintyTopic[];
  activity: readonly AgentActivityEntry[];
  privacyTrace: readonly BoundaryLedgerEntry[];
  lastToolResponse: string;
  pendingBindingApproval: PendingPrivateBindingApproval | null;
  bindingArtifacts: Readonly<Partial<Record<PrivateFieldId, LocalBindingArtifact>>>;
  requirementSnapshots: Readonly<Partial<Record<RequirementId, RequirementSnapshot>>>;
  reviewPacket: ReviewPacket | null;
}>;

export type SealedAction =
  | { type: "scenario_changed"; scenarioId: ScenarioId; demoSession: number }
  | { type: "public_field_changed"; field: PublicFieldId; value: PublicFieldValue }
  | { type: "public_fields_set"; fields: Partial<Record<PublicFieldId, PublicFieldValue>> }
  | { type: "wizard_step_changed"; step: WorkflowStep }
  | { type: "uncertainty_flagged"; topic: UncertaintyTopic }
  | { type: "review_requested"; packet: ReviewPacket }
  | ({ type: "agent_activity_recorded" } & AgentActivityMetadata)
  | { type: "private_binding_approval_requested"; approval: PendingPrivateBindingApproval }
  | { type: "private_binding_approval_resolved" }
  | ({ type: "private_binding_completed"; field: PrivateFieldId; artifact: LocalBindingArtifact } & PrivateOperationMetadata)
  | ({ type: "private_requirement_evaluated"; requirement: RequirementId; result: Exclude<RequirementResult, "not_checked">; snapshot: RequirementSnapshot } & PrivateOperationMetadata);

function prependEntry<T>(current: readonly T[], entry: T): readonly T[] { return [entry, ...current].slice(0, MAX_TRACE_ENTRIES); }

export function createInitialSealedState(scenarioId: ScenarioId = "rental", demoSession = 0): SealedState {
  return {
    scenarioId,
    demoSession,
    workflow: createInitialWorkflow(scenarioId),
    currentStep: 1,
    reviewState: "not_requested",
    uncertainTopics: [],
    activity: [],
    privacyTrace: [],
    lastToolResponse: "No agent tool call yet.",
    pendingBindingApproval: null,
    bindingArtifacts: {},
    requirementSnapshots: {},
    reviewPacket: null,
  };
}

function applyAgentActivity(state: SealedState, action: AgentActivityMetadata): SealedState {
  return { ...state, activity: prependEntry(state.activity, action.activity), lastToolResponse: action.lastToolResponse };
}
function applyPrivateOperation(state: SealedState, action: PrivateOperationMetadata): SealedState {
  return { ...applyAgentActivity(state, action), privacyTrace: prependEntry(state.privacyTrace, action.boundaryLedgerEntry) };
}

export function sealedReducer(state: SealedState, action: SealedAction): SealedState {
  switch (action.type) {
    case "scenario_changed": return createInitialSealedState(action.scenarioId, action.demoSession);
    case "public_field_changed": {
      const scenario = getScenario(state.scenarioId);
      if (!scenario.publicFields.some((field) => field.id === action.field)) return state;
      return { ...state, workflow: { ...state.workflow, publicFields: { ...state.workflow.publicFields, [action.field]: action.value } }, reviewState: "not_requested", reviewPacket: null };
    }
    case "public_fields_set": return { ...state, workflow: { ...state.workflow, publicFields: { ...state.workflow.publicFields, ...action.fields } }, reviewState: "not_requested", reviewPacket: null };
    case "wizard_step_changed": return { ...state, currentStep: action.step };
    case "uncertainty_flagged": return { ...state, uncertainTopics: state.uncertainTopics.includes(action.topic) ? state.uncertainTopics : [...state.uncertainTopics, action.topic] };
    case "review_requested": return { ...state, reviewState: "requested", reviewPacket: action.packet };
    case "agent_activity_recorded": return applyAgentActivity(state, action);
    case "private_binding_approval_requested": return { ...state, pendingBindingApproval: action.approval };
    case "private_binding_approval_resolved": return { ...state, pendingBindingApproval: null };
    case "private_binding_completed":
      return applyPrivateOperation({
        ...state,
        workflow: { ...state.workflow, privateBindings: { ...state.workflow.privateBindings, [action.field]: "bound" } },
        bindingArtifacts: { ...state.bindingArtifacts, [action.field]: action.artifact },
        pendingBindingApproval: null,
      }, action);
    case "private_requirement_evaluated":
      return applyPrivateOperation({
        ...state,
        workflow: { ...state.workflow, requirementResults: { ...state.workflow.requirementResults, [action.requirement]: action.result } },
        requirementSnapshots: { ...state.requirementSnapshots, [action.requirement]: action.snapshot },
      }, action);
  }
}

export type SealedStore = Readonly<{
  getSnapshot: () => SealedState;
  getServerSnapshot: () => SealedState;
  subscribe: (listener: () => void) => () => void;
  dispatch: (action: SealedAction) => void;
  setScenario: (scenarioId: ScenarioId) => void;
  setPublicField: (field: PublicFieldId, value: PublicFieldValue) => void;
  setPublicFields: (fields: Partial<Record<PublicFieldId, PublicFieldValue>>) => void;
  setWizardStep: (step: WorkflowStep) => void;
  flagUncertain: (topic: UncertaintyTopic) => void;
  requestReview: (packet: ReviewPacket) => void;
  recordAgentActivity: (metadata: AgentActivityMetadata) => void;
  requestPrivateBindingApproval: (field: PrivateFieldId) => Promise<boolean>;
  resolvePrivateBindingApproval: (approved: boolean) => void;
  reset: () => void;
}>;

let bindingApprovalSequence = 0;

export function createSealedStore(initialScenario: ScenarioId = "rental"): SealedStore {
  const serverState = createInitialSealedState(initialScenario);
  let state = serverState;
  let demoSessionSequence = 0;
  const listeners = new Set<() => void>();
  const approvalResolvers = new Map<string, (approved: boolean) => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const dispatch = (action: SealedAction) => { const nextState = sealedReducer(state, action); if (nextState !== state) { state = nextState; notify(); } };
  const cancelPendingApprovals = () => { approvalResolvers.forEach((resolve) => resolve(false)); approvalResolvers.clear(); };
  const assertDependenciesMutable = (fields: readonly PublicFieldId[]) => {
    const scenario = getScenario(state.scenarioId);
    if (state.requirementSnapshots[scenario.requirement.id] && fields.some((field) => scenario.requirement.publicDependencies.includes(field))) {
      throw new Error("Public dependency is locked after private evaluation; reset starts a new demo session");
    }
  };

  return {
    getSnapshot: () => state,
    getServerSnapshot: () => serverState,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    dispatch,
    setScenario: (scenarioId) => { cancelPendingApprovals(); dispatch({ type: "scenario_changed", scenarioId, demoSession: ++demoSessionSequence }); },
    setPublicField: (field, value) => { assertDependenciesMutable([field]); dispatch({ type: "public_field_changed", field, value }); },
    setPublicFields: (fields) => { assertDependenciesMutable(Object.keys(fields) as PublicFieldId[]); dispatch({ type: "public_fields_set", fields }); },
    setWizardStep: (step) => dispatch({ type: "wizard_step_changed", step }),
    flagUncertain: (topic) => dispatch({ type: "uncertainty_flagged", topic }),
    requestReview: (packet) => dispatch({ type: "review_requested", packet }),
    recordAgentActivity: (metadata) => dispatch({ type: "agent_activity_recorded", ...metadata }),
    requestPrivateBindingApproval: (field) => {
      if (state.pendingBindingApproval) return Promise.resolve(false);
      const approval = { requestId: `binding-approval-${++bindingApprovalSequence}`, field };
      const result = new Promise<boolean>((resolve) => approvalResolvers.set(approval.requestId, resolve));
      dispatch({ type: "private_binding_approval_requested", approval });
      return result;
    },
    resolvePrivateBindingApproval: (approved) => {
      const approval = state.pendingBindingApproval;
      if (!approval) return;
      const resolver = approvalResolvers.get(approval.requestId);
      approvalResolvers.delete(approval.requestId);
      dispatch({ type: "private_binding_approval_resolved" });
      resolver?.(approved);
    },
    reset: () => { cancelPendingApprovals(); state = createInitialSealedState(state.scenarioId, ++demoSessionSequence); notify(); },
  };
}

export const sealedStore = createSealedStore();
