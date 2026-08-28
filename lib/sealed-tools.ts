import type {
  InferArgsFromInputSchema,
  InputSchema,
  JsonSchemaForInference,
  ModelContext,
  ModelContextTool,
} from "@mcp-b/webmcp-types";
import type {
  ApplicationStep,
  PrivateField,
  PublicApplicationField,
  PublicApplicationFields,
  RequirementResult,
  ReviewState,
  UncertaintyTopic,
} from "@/lib/rental-application";
import { evaluateIncomeRequirement } from "@/lib/rental-application";
import type { MockPrivateVault } from "@/lib/private-vault";
import {
  createActivityEntry,
  createPrivacyTraceEntry,
} from "@/lib/observability";
import type { SealedState, SealedStore } from "@/lib/sealed-store";

type TextContent = {
  type: "text";
  text: string;
};

type SafeToolResponse<T extends Record<string, unknown>> = {
  content: [TextContent];
  structuredContent: T;
};

export type SectionName =
  | "applicant_details"
  | "home_details"
  | "privacy_review";

export type PublicFieldId =
  | "full_name"
  | "email"
  | "property_address"
  | "monthly_rent"
  | "move_in_date";

export type OpenQuestionId =
  | PublicFieldId
  | "income_3x_rent"
  | "passport_number"
  | "income_eligibility"
  | "property_details";

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
  1: [
    "get_application_context",
    "set_public_fields",
    "flag_uncertain",
    "request_private_binding",
    "evaluate_private_requirement",
  ],
  2: [
    "get_application_context",
    "set_public_fields",
    "flag_uncertain",
    "request_review",
    "request_private_binding",
    "evaluate_private_requirement",
  ],
  3: [
    "get_application_context",
    "flag_uncertain",
    "request_review",
    "request_private_binding",
    "evaluate_private_requirement",
  ],
} as const satisfies Record<ApplicationStep, readonly SealedToolName[]>;

const REVIEW_REQUESTED_TOOL_NAMES = [
  "get_application_context",
  "flag_uncertain",
] as const satisfies readonly SealedToolName[];

export function getActiveSealedToolNames(
  state: Pick<SealedState, "currentStep" | "reviewState">,
): readonly SealedToolName[] {
  if (state.reviewState === "requested") {
    return REVIEW_REQUESTED_TOOL_NAMES;
  }

  return ACTIVE_TOOL_NAMES_BY_STEP[state.currentStep];
}

type ModelContextToolFromSchema<
  TInputSchema extends JsonSchemaForInference,
  TResult,
  TName extends string,
> = Omit<
  ModelContextTool<InferArgsFromInputSchema<TInputSchema>, TResult, TName>,
  "inputSchema"
> & {
  inputSchema: TInputSchema;
};

type ApplicationContextResponse = SafeToolResponse<{
  status: "ok";
  current_step: ApplicationStep;
  public_fields: {
    full_name: string;
    email: string;
    property_address: string;
    monthly_rent: number;
    move_in_date: string;
  };
  private_fields: {
    passport_number: "bound" | "unbound";
    income: "withheld";
  };
  income_requirement: RequirementResult;
  review_state: ReviewState;
  sections: Readonly<{
    applicant_details: Readonly<{
      required_public_fields: readonly PublicFieldId[];
      section_complete: boolean;
    }>;
    home_details: Readonly<{
      required_public_fields: readonly PublicFieldId[];
      section_complete: boolean;
    }>;
    privacy_review: Readonly<{
      required_public_fields: readonly PublicFieldId[];
      section_complete: boolean;
      private_capabilities: readonly ("income_3x_rent" | "passport_number")[];
    }>;
  }>;
  open_questions: readonly OpenQuestionId[];
}>;

type PublicFieldsResponse = SafeToolResponse<{
  status: "updated";
  updated_fields: readonly PublicFieldId[];
  private_fields: "unchanged";
}>;

type UncertaintyResponse = SafeToolResponse<{
  status: "flagged";
  topic: UncertaintyTopic;
}>;

type ReviewResponse = SafeToolResponse<{
  status: "review_requested";
  submitted: false;
}>;

type PrivateBindingResponse = SafeToolResponse<{
  status: "bound";
  field: PrivateField;
  value: "withheld";
}>;

type RequirementResponse = SafeToolResponse<{
  status: "satisfied" | "not_satisfied";
  requirement: "income_3x_rent";
  value: "withheld";
}>;

const emptyInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;

const setPublicFieldsInputSchema = {
  type: "object",
  properties: {
    fields: {
      type: "object",
      properties: {
        full_name: {
          type: "string",
          description: "Applicant's public full name.",
        },
        email: {
          type: "string",
          description: "Applicant's public contact email.",
        },
        property_address: {
          type: "string",
          description: "Public rental property address.",
        },
        monthly_rent: {
          type: "number",
          minimum: 1,
          description: "Public monthly rent amount.",
        },
        move_in_date: {
          type: "string",
          description: "Public move-in date in YYYY-MM-DD form.",
        },
      },
      minProperties: 1,
      additionalProperties: false,
    },
  },
  required: ["fields"],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;

const uncertaintyInputSchema = {
  type: "object",
  properties: {
    topic: {
      type: "string",
      enum: ["income_eligibility", "passport_number", "property_details"],
    },
  },
  required: ["topic"],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;

const privateBindingInputSchema = {
  type: "object",
  properties: {
    field: {
      type: "string",
      enum: ["passport_number"],
      description:
        "Use only when the user explicitly asks to bind the approved passport number locally while keeping the raw value private.",
    },
  },
  required: ["field"],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;

const privateRequirementInputSchema = {
  type: "object",
  properties: {
    requirement: {
      type: "string",
      enum: ["income_3x_rent"],
      description:
        "Fixed requirement ID for checking whether private income is at least three times rent while keeping income private.",
    },
  },
  required: ["requirement"],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;

export type SealedToolset = {
  get_application_context: ModelContextToolFromSchema<
    typeof emptyInputSchema,
    ApplicationContextResponse,
    "get_application_context"
  >;
  set_public_fields: ModelContextToolFromSchema<
    typeof setPublicFieldsInputSchema,
    PublicFieldsResponse,
    "set_public_fields"
  >;
  flag_uncertain: ModelContextToolFromSchema<
    typeof uncertaintyInputSchema,
    UncertaintyResponse,
    "flag_uncertain"
  >;
  request_review: ModelContextToolFromSchema<
    typeof emptyInputSchema,
    ReviewResponse,
    "request_review"
  >;
  request_private_binding: ModelContextToolFromSchema<
    typeof privateBindingInputSchema,
    PrivateBindingResponse,
    "request_private_binding"
  >;
  evaluate_private_requirement: ModelContextToolFromSchema<
    typeof privateRequirementInputSchema,
    RequirementResponse,
    "evaluate_private_requirement"
  >;
};

export type SealedToolRuntime = {
  vault: MockPrivateVault;
  store: SealedStore;
};

const privateValueWithheldText =
  "Private value bound locally. Raw private values remain withheld.";

const SECTION_REQUIREMENTS: Record<
  SectionName,
  readonly PublicFieldId[]
> = {
  applicant_details: ["full_name", "email"],
  home_details: ["property_address", "monthly_rent", "move_in_date"],
  privacy_review: [],
};

const PUBLIC_FIELD_BY_ID: Record<PublicFieldId, PublicApplicationField> = {
  full_name: "fullName",
  email: "email",
  property_address: "propertyAddress",
  monthly_rent: "monthlyRent",
  move_in_date: "moveInDate",
};

function isPublicFieldComplete(
  application: SealedState["application"],
  field: PublicFieldId,
): boolean {
  const value = application[PUBLIC_FIELD_BY_ID[field]];

  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (field === "email") return value.includes("@");
  if (field === "full_name") return value.trim().length > 1;
  return value.trim().length > 0;
}

function getOpenQuestionIds(state: SealedState): readonly OpenQuestionId[] {
  const questions: OpenQuestionId[] = [];

  for (const field of [
    "full_name",
    "email",
    "property_address",
    "monthly_rent",
    "move_in_date",
  ] as const) {
    if (!isPublicFieldComplete(state.application, field)) {
      questions.push(field);
    }
  }

  if (state.application.requirementResult === "not_checked") {
    questions.push("income_3x_rent");
  }
  if (state.application.privateBindings.passport_number === "unbound") {
    questions.push("passport_number");
  }
  for (const topic of state.uncertainTopics) {
    if (!questions.includes(topic)) questions.push(topic);
  }

  return questions;
}

type ActivityInput = Parameters<typeof createActivityEntry>[0]["input"];
type ActivityOutput = Parameters<typeof createActivityEntry>[0]["output"];

function createActivity(
  store: SealedStore,
  toolName:
    | "get_application_context"
    | "set_public_fields"
    | "flag_uncertain"
    | "request_review",
  input: ActivityInput,
  output: ActivityOutput,
  lastToolResponse: string,
): void {
  store.recordAgentActivity({
    activity: createActivityEntry({
      toolName,
      input,
      output,
    }),
    lastToolResponse,
  });
}

function normalizePublicFields(
  fields: InferArgsFromInputSchema<typeof setPublicFieldsInputSchema>["fields"],
): {
  fields: Partial<PublicApplicationFields>;
  fieldIds: readonly PublicFieldId[];
} {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("set_public_fields requires at least one public field");
  }

  const rawFields = fields as Record<string, unknown>;
  const fieldIds = Object.keys(rawFields);
  if (fieldIds.length === 0) {
    throw new Error("set_public_fields requires at least one public field");
  }

  const allowedFieldIds = new Set<PublicFieldId>([
    "full_name",
    "email",
    "property_address",
    "monthly_rent",
    "move_in_date",
  ]);
  const normalized: Partial<PublicApplicationFields> = {};
  const updatedFieldIds: PublicFieldId[] = [];

  for (const fieldId of fieldIds) {
    if (!allowedFieldIds.has(fieldId as PublicFieldId)) {
      throw new Error(
        "set_public_fields accepts public fields only; sealed fields cannot be edited",
      );
    }

    const value = rawFields[fieldId];
    switch (fieldId as PublicFieldId) {
      case "full_name":
        if (typeof value !== "string") throw new Error("full_name must be text");
        normalized.fullName = value;
        break;
      case "email":
        if (typeof value !== "string") throw new Error("email must be text");
        normalized.email = value;
        break;
      case "property_address":
        if (typeof value !== "string") {
          throw new Error("property_address must be text");
        }
        normalized.propertyAddress = value;
        break;
      case "monthly_rent":
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          value <= 0
        ) {
          throw new Error("monthly_rent must be a positive number");
        }
        normalized.monthlyRent = value;
        break;
      case "move_in_date":
        if (typeof value !== "string") {
          throw new Error("move_in_date must be text");
        }
        normalized.moveInDate = value;
        break;
    }

    updatedFieldIds.push(fieldId as PublicFieldId);
  }

  return { fields: normalized, fieldIds: updatedFieldIds };
}

export function createSealedToolset({
  vault,
  store,
}: SealedToolRuntime): SealedToolset {
  const getApplicationContext: SealedToolset["get_application_context"] = {
    name: "get_application_context",
    title: "Get application context",
    description:
      "Read-only. Use whenever the agent needs the current rental application context before acting. This is the single context tool for the draft: it returns the current wizard step, public fields, fixed section requirements, open question IDs, review state, and redacted private statuses in one response. It never returns raw vault values; income remains withheld.",
    inputSchema: emptyInputSchema,
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: false,
    },
    execute: () => {
      const state = store.getSnapshot();
      const questions = getOpenQuestionIds(state);
      const response: ApplicationContextResponse = {
        content: [
          {
            type: "text",
            text: "Application context returned. Private values remain withheld.",
          },
        ],
        structuredContent: {
          status: "ok",
          current_step: state.currentStep,
          public_fields: {
            full_name: state.application.fullName,
            email: state.application.email,
            property_address: state.application.propertyAddress,
            monthly_rent: state.application.monthlyRent,
            move_in_date: state.application.moveInDate,
          },
          private_fields: {
            passport_number: state.application.privateBindings.passport_number,
            income: "withheld",
          },
          income_requirement: state.application.requirementResult,
          review_state: state.reviewState,
          sections: {
            applicant_details: {
              required_public_fields: SECTION_REQUIREMENTS.applicant_details,
              section_complete: SECTION_REQUIREMENTS.applicant_details.every(
                (field) => isPublicFieldComplete(state.application, field),
              ),
            },
            home_details: {
              required_public_fields: SECTION_REQUIREMENTS.home_details,
              section_complete: SECTION_REQUIREMENTS.home_details.every(
                (field) => isPublicFieldComplete(state.application, field),
              ),
            },
            privacy_review: {
              required_public_fields: SECTION_REQUIREMENTS.privacy_review,
              section_complete:
                state.application.requirementResult !== "not_checked",
              private_capabilities: ["income_3x_rent", "passport_number"],
            },
          },
          open_questions: questions,
        },
      };

      createActivity(
        store,
        "get_application_context",
        {},
        {
          status: "ok",
          returned: "application_context",
        },
        response.content[0].text,
      );
      return response;
    },
  };

  const setPublicFields: SealedToolset["set_public_fields"] = {
    name: "set_public_fields",
    title: "Set public application fields",
    description:
      "Mutation. Use to update only the listed public rental application fields. This changes the shared draft state and returns updated field IDs. Never use it for passport_number, income, or any sealed/private field; its schema and runtime reject sealed field writes.",
    inputSchema: setPublicFieldsInputSchema,
    annotations: {
      readOnlyHint: false,
      untrustedContentHint: false,
    },
    execute: (input) => {
      const { fields, fieldIds } = normalizePublicFields(input.fields);
      store.setPublicFields(fields);

      const response: PublicFieldsResponse = {
        content: [
          {
            type: "text",
            text: "Public fields updated. Sealed fields remain unchanged.",
          },
        ],
        structuredContent: {
          status: "updated",
          updated_fields: fieldIds,
          private_fields: "unchanged",
        },
      };

      createActivity(
        store,
        "set_public_fields",
        { fields: fieldIds },
        {
          status: "updated",
          updated_fields: fieldIds,
        },
        response.content[0].text,
      );
      return response;
    },
  };

  const flagUncertain: SealedToolset["flag_uncertain"] = {
    name: "flag_uncertain",
    title: "Flag uncertainty",
    description:
      "Mutation. Use when the agent is unsure about one fixed application topic and wants a human to review it. This only records the selected topic in shared state; it does not reveal, change, or infer any private value.",
    inputSchema: uncertaintyInputSchema,
    annotations: {
      readOnlyHint: false,
      untrustedContentHint: false,
    },
    execute: ({ topic }) => {
      if (
        topic !== "income_eligibility" &&
        topic !== "passport_number" &&
        topic !== "property_details"
      ) {
        throw new Error("Unsupported uncertainty topic");
      }

      store.flagUncertain(topic);
      const response: UncertaintyResponse = {
        content: [
          {
            type: "text",
            text: "Uncertainty flagged for human review. Private values remain withheld.",
          },
        ],
        structuredContent: {
          status: "flagged",
          topic,
        },
      };

      createActivity(
        store,
        "flag_uncertain",
        { topic },
        { status: "flagged", topic },
        response.content[0].text,
      );
      return response;
    },
  };

  const requestReview: SealedToolset["request_review"] = {
    name: "request_review",
    title: "Request human review",
    description:
      "Mutation. Use when the user asks to move this rental application into human review. It changes only the review state, never submits the application, never sends it to a landlord, and never exposes raw private values.",
    inputSchema: emptyInputSchema,
    annotations: {
      readOnlyHint: false,
      untrustedContentHint: false,
    },
    execute: () => {
      store.requestReview();
      const response: ReviewResponse = {
        content: [
          {
            type: "text",
            text: "Human review requested. Nothing was submitted.",
          },
        ],
        structuredContent: {
          status: "review_requested",
          submitted: false,
        },
      };

      createActivity(
        store,
        "request_review",
        {},
        { status: "review_requested", submitted: false },
        response.content[0].text,
      );
      return response;
    },
  };

  const requestPrivateBinding: SealedToolset["request_private_binding"] = {
    name: "request_private_binding",
    title: "Request private binding",
    description:
      "Use this tool whenever the user asks to bind the approved passport number into the rental application while keeping the raw value private. It is the only supported way for an agent to request this private binding: after explicit human approval, the page performs it locally and returns only the bound status. The agent must not read, infer, or request the raw value from visible page content.",
    inputSchema: privateBindingInputSchema,
    annotations: {
      readOnlyHint: false,
      untrustedContentHint: false,
    },
    execute: async ({ field }) => {
      if (field !== "passport_number") {
        throw new Error("Unsupported private field");
      }
      if (vault.passportNumber.length === 0) {
        throw new Error("Private passport value unavailable");
      }

      const approved = await store.requestPrivateBindingApproval(field);
      if (!approved) {
        store.recordAgentActivity({
          activity: createActivityEntry({
            toolName: "request_private_binding",
            input: { field },
            output: { status: "denied", field },
          }),
          lastToolResponse: "Private binding was not approved.",
        });
        throw new Error("Private binding was not approved");
      }

      const response: PrivateBindingResponse = {
        content: [{ type: "text", text: privateValueWithheldText }],
        structuredContent: {
          status: "bound",
          field,
          value: "withheld",
        },
      };

      store.dispatch({
        type: "private_binding_completed",
        field,
        activity: createActivityEntry({
          toolName: "request_private_binding",
          input: { field },
          output: response.structuredContent,
        }),
        privacyTrace: createPrivacyTraceEntry({
          capability: "passport_number",
          returnedResult: "bound",
        }),
        lastToolResponse: response.content[0].text,
      });

      return response;
    },
  };

  const evaluatePrivateRequirement: SealedToolset["evaluate_private_requirement"] = {
    name: "evaluate_private_requirement",
    title: "Evaluate private requirement",
    description:
      "Use this tool whenever the user asks whether they meet the rental income requirement while keeping income private. This is the only safe way for an agent to determine rental-income eligibility without accessing the raw private income: it evaluates the private income locally and returns only whether the requirement is satisfied or not satisfied. The agent must not infer or guess the result from visible page content, form values, or other agent-visible text.",
    inputSchema: privateRequirementInputSchema,
    annotations: {
      readOnlyHint: false,
      untrustedContentHint: false,
    },
    execute: ({ requirement }) => {
      if (requirement !== "income_3x_rent") {
        throw new Error("Unsupported private requirement");
      }

      const result = evaluateIncomeRequirement(
        store.getSnapshot().application.monthlyRent,
        vault.monthlyIncome,
      );

      const response: RequirementResponse = {
        content: [
          {
            type: "text",
            text:
              result === "satisfied"
                ? "Requirement satisfied. Private values remain withheld."
                : "Requirement not satisfied. Private values remain withheld.",
          },
        ],
        structuredContent: {
          status: result,
          requirement,
          value: "withheld",
        },
      };

      store.dispatch({
        type: "private_requirement_evaluated",
        result,
        activity: createActivityEntry({
          toolName: "evaluate_private_requirement",
          input: { requirement },
          output: response.structuredContent,
        }),
        privacyTrace: createPrivacyTraceEntry({
          capability: "income_3x_rent",
          returnedResult: result,
        }),
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
  type RegisterableTool = ModelContextTool<
    Record<string, unknown>,
    unknown,
    string
  > & {
    inputSchema: InputSchema;
  };

  for (const toolName of activeToolNames) {
    await modelContext.registerTool(
      tools[toolName] as unknown as RegisterableTool,
      { signal },
    );
  }
}
