import {
  type ApplicationStep,
  bindPrivateField,
  createInitialRentalApplication,
  type PublicApplicationField,
  type PublicApplicationFields,
  setRequirementResult,
  type PrivateField,
  type RentalApplicationState,
  type ReviewState,
  type UncertaintyTopic,
} from "@/lib/rental-application";
import type { AgentActivityEntry, PrivacyTraceEntry } from "@/lib/observability";

export type { PublicApplicationField } from "@/lib/rental-application";

const MAX_TRACE_ENTRIES = 8;

type PublicFieldAction = {
  [K in PublicApplicationField]: {
    type: "public_field_changed";
    field: K;
    value: RentalApplicationState[K];
  };
}[PublicApplicationField];

type PublicFieldsSetAction = {
  type: "public_fields_set";
  fields: Partial<PublicApplicationFields>;
};

type WizardStepChangedAction = {
  type: "wizard_step_changed";
  step: ApplicationStep;
};

type UncertaintyFlaggedAction = {
  type: "uncertainty_flagged";
  topic: UncertaintyTopic;
};

type ReviewRequestedAction = {
  type: "review_requested";
};

type AgentActivityMetadata = {
  activity: AgentActivityEntry;
  lastToolResponse: string;
};

type AgentActivityRecordedAction = AgentActivityMetadata & {
  type: "agent_activity_recorded";
};

type PrivateOperationMetadata = AgentActivityMetadata & {
  privacyTrace: PrivacyTraceEntry;
};

export type PendingPrivateBindingApproval = Readonly<{
  requestId: string;
  field: PrivateField;
}>;

type PrivateBindingApprovalRequestedAction = {
  type: "private_binding_approval_requested";
  approval: PendingPrivateBindingApproval;
};

type PrivateBindingApprovalResolvedAction = {
  type: "private_binding_approval_resolved";
};

export type SealedAction =
  | PublicFieldAction
  | PublicFieldsSetAction
  | WizardStepChangedAction
  | UncertaintyFlaggedAction
  | ReviewRequestedAction
  | AgentActivityRecordedAction
  | PrivateBindingApprovalRequestedAction
  | PrivateBindingApprovalResolvedAction
  | (PrivateOperationMetadata & {
      type: "private_binding_completed";
      field: PrivateField;
    })
  | (PrivateOperationMetadata & {
      type: "private_requirement_evaluated";
      result: Exclude<RentalApplicationState["requirementResult"], "not_checked">;
    });

export type SealedState = Readonly<{
  application: RentalApplicationState;
  currentStep: ApplicationStep;
  reviewState: ReviewState;
  uncertainTopics: readonly UncertaintyTopic[];
  activity: readonly AgentActivityEntry[];
  privacyTrace: readonly PrivacyTraceEntry[];
  lastToolResponse: string;
  pendingBindingApproval: PendingPrivateBindingApproval | null;
}>;

function prependEntry<T>(current: readonly T[], entry: T): readonly T[] {
  return [entry, ...current].slice(0, MAX_TRACE_ENTRIES);
}

function updatePublicApplication(
  application: RentalApplicationState,
  action: PublicFieldAction,
): RentalApplicationState {
  switch (action.field) {
    case "fullName":
      return { ...application, fullName: action.value };
    case "email":
      return { ...application, email: action.value };
    case "propertyAddress":
      return { ...application, propertyAddress: action.value };
    case "monthlyRent":
      return {
        ...application,
        monthlyRent: action.value,
        requirementResult: "not_checked",
      };
    case "moveInDate":
      return { ...application, moveInDate: action.value };
  }
}

function updatePublicFields(
  application: RentalApplicationState,
  fields: Partial<PublicApplicationFields>,
): RentalApplicationState {
  const nextApplication = { ...application };

  if (typeof fields.fullName === "string") {
    nextApplication.fullName = fields.fullName;
  }
  if (typeof fields.email === "string") {
    nextApplication.email = fields.email;
  }
  if (typeof fields.propertyAddress === "string") {
    nextApplication.propertyAddress = fields.propertyAddress;
  }
  if (typeof fields.monthlyRent === "number") {
    nextApplication.monthlyRent = fields.monthlyRent;
    nextApplication.requirementResult = "not_checked";
  }
  if (typeof fields.moveInDate === "string") {
    nextApplication.moveInDate = fields.moveInDate;
  }

  return nextApplication;
}

function applyAgentActivity(
  state: SealedState,
  action: AgentActivityMetadata,
): SealedState {
  return {
    ...state,
    activity: prependEntry(state.activity, action.activity),
    lastToolResponse: action.lastToolResponse,
  };
}

function applyPrivateOperation(
  state: SealedState,
  action: PrivateOperationMetadata,
): SealedState {
  return {
    ...applyAgentActivity(state, action),
    privacyTrace: prependEntry(state.privacyTrace, action.privacyTrace),
  };
}

export function createInitialSealedState(): SealedState {
  return {
    application: createInitialRentalApplication(),
    currentStep: 1,
    reviewState: "not_requested",
    uncertainTopics: [],
    activity: [],
    privacyTrace: [],
    lastToolResponse: "No agent tool call yet.",
    pendingBindingApproval: null,
  };
}

export function sealedReducer(
  state: SealedState,
  action: SealedAction,
): SealedState {
  switch (action.type) {
    case "public_field_changed":
      return {
        ...state,
        application: updatePublicApplication(state.application, action),
        reviewState: "not_requested",
      };
    case "public_fields_set":
      return {
        ...state,
        application: updatePublicFields(state.application, action.fields),
        reviewState: "not_requested",
      };
    case "wizard_step_changed":
      return {
        ...state,
        currentStep: action.step,
      };
    case "uncertainty_flagged":
      return {
        ...state,
        uncertainTopics: state.uncertainTopics.includes(action.topic)
          ? state.uncertainTopics
          : [...state.uncertainTopics, action.topic],
      };
    case "review_requested":
      return {
        ...state,
        reviewState: "requested",
      };
    case "agent_activity_recorded":
      return applyAgentActivity(state, action);
    case "private_binding_approval_requested":
      return {
        ...state,
        pendingBindingApproval: action.approval,
      };
    case "private_binding_approval_resolved":
      return {
        ...state,
        pendingBindingApproval: null,
      };
    case "private_binding_completed":
      return applyPrivateOperation(
        {
          ...state,
          application: bindPrivateField(state.application, action.field),
          pendingBindingApproval: null,
        },
        action,
      );
    case "private_requirement_evaluated":
      return applyPrivateOperation(
        {
          ...state,
          application: setRequirementResult(state.application, action.result),
        },
        action,
      );
  }
}

export type SealedStore = Readonly<{
  getSnapshot: () => SealedState;
  getServerSnapshot: () => SealedState;
  subscribe: (listener: () => void) => () => void;
  dispatch: (action: SealedAction) => void;
  setPublicField: <K extends PublicApplicationField>(
    field: K,
    value: RentalApplicationState[K],
  ) => void;
  setPublicFields: (fields: Partial<PublicApplicationFields>) => void;
  setWizardStep: (step: ApplicationStep) => void;
  flagUncertain: (topic: UncertaintyTopic) => void;
  requestReview: () => void;
  recordAgentActivity: (metadata: AgentActivityMetadata) => void;
  requestPrivateBindingApproval: (field: PrivateField) => Promise<boolean>;
  resolvePrivateBindingApproval: (approved: boolean) => void;
  reset: () => void;
}>;

let bindingApprovalSequence = 0;

export function createSealedStore(): SealedStore {
  const initialState = createInitialSealedState();
  let state = initialState;
  const listeners = new Set<() => void>();
  const approvalResolvers = new Map<string, (approved: boolean) => void>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const dispatch = (action: SealedAction) => {
    const nextState = sealedReducer(state, action);
    if (nextState === state) return;

    state = nextState;
    notify();
  };

  const setPublicField = <K extends PublicApplicationField>(
    field: K,
    value: RentalApplicationState[K],
  ) => {
    dispatch({
      type: "public_field_changed",
      field,
      value,
    } as PublicFieldAction);
  };

  const setPublicFields = (fields: Partial<PublicApplicationFields>) => {
    dispatch({
      type: "public_fields_set",
      fields,
    });
  };

  const setWizardStep = (step: ApplicationStep) => {
    dispatch({
      type: "wizard_step_changed",
      step,
    });
  };

  const flagUncertain = (topic: UncertaintyTopic) => {
    dispatch({
      type: "uncertainty_flagged",
      topic,
    });
  };

  const requestReview = () => {
    dispatch({ type: "review_requested" });
  };

  const recordAgentActivity = (metadata: AgentActivityMetadata) => {
    dispatch({
      type: "agent_activity_recorded",
      ...metadata,
    });
  };

  const requestPrivateBindingApproval = (field: PrivateField) => {
    if (state.pendingBindingApproval) return Promise.resolve(false);

    const approval = {
      requestId: `binding-approval-${++bindingApprovalSequence}`,
      field,
    } satisfies PendingPrivateBindingApproval;

    const approvalResult = new Promise<boolean>((resolve) => {
      approvalResolvers.set(approval.requestId, resolve);
    });

    dispatch({
      type: "private_binding_approval_requested",
      approval,
    });

    return approvalResult;
  };

  const resolvePrivateBindingApproval = (approved: boolean) => {
    const approval = state.pendingBindingApproval;
    if (!approval) return;

    const resolver = approvalResolvers.get(approval.requestId);
    approvalResolvers.delete(approval.requestId);
    dispatch({ type: "private_binding_approval_resolved" });
    resolver?.(approved);
  };

  return {
    getSnapshot: () => state,
    getServerSnapshot: () => initialState,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch,
    setPublicField,
    setPublicFields,
    setWizardStep,
    flagUncertain,
    requestReview,
    recordAgentActivity,
    requestPrivateBindingApproval,
    resolvePrivateBindingApproval,
    reset: () => {
      approvalResolvers.forEach((resolve) => resolve(false));
      approvalResolvers.clear();
      state = initialState;
      notify();
    },
  };
}

export const sealedStore = createSealedStore();
