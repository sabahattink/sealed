import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelContext } from "@mcp-b/webmcp-types";
import { SealedApplication } from "@/components/SealedApplication";
import { createMockPrivateVault } from "@/lib/private-vault";
import { createTestPrivateVault, DEMO_CANARY_SECRET, MEMBERSHIP_BIRTH_DATE, MEMBERSHIP_CANARY_SECRET } from "@/tests/fixtures/private-vault";
import {
  ACTIVE_TOOL_NAMES_BY_STEP,
  ACTIVE_TOOL_NAMES_BY_SCENARIO,
  createSealedToolset,
  getActiveSealedToolNames,
  registerSealedTools,
  SEALED_TOOL_NAMES,
} from "@/lib/sealed-tools";
import { createSealedStore, sealedStore } from "@/lib/sealed-store";

beforeEach(() => {
  sealedStore.setScenario("rental");
  sealedStore.reset();
  delete (document as Document & { modelContext?: ModelContext }).modelContext;
});

describe("reusable scenario privacy architecture", () => {
  function createMembershipToolset() {
    const store = createSealedStore("membership");
    const vault = createTestPrivateVault();
    return { store, vault, tools: createSealedToolset({ store, vault }) };
  }

  it("derives membership schemas and policies from the active scenario", () => {
    const { tools } = createMembershipToolset();
    const publicSchema = JSON.stringify(tools.set_public_fields.inputSchema);

    expect(publicSchema).toContain("display_name");
    expect(publicSchema).toContain("membership_plan");
    expect(publicSchema).not.toContain("monthly_rent");
    expect(publicSchema).not.toContain("identity_number");
    expect(tools.evaluate_private_requirement.inputSchema).toMatchObject({
      properties: { requirement: { enum: ["age_18_plus"] } },
    });
    expect(tools.request_private_binding.inputSchema).toMatchObject({
      properties: { field: { enum: ["identity_number"] } },
    });
  });

  it("executes membership age evaluation and approved identity binding without disclosure", async () => {
    const { store, vault, tools } = createMembershipToolset();
    const requirement = await tools.evaluate_private_requirement.execute({
      requirement: "age_18_plus",
    });
    const bindingPromise = tools.request_private_binding.execute({
      field: "identity_number",
    });
    store.resolvePrivateBindingApproval(true);
    const binding = await bindingPromise;
    const serialized = JSON.stringify({ requirement, binding, snapshot: store.getSnapshot() });

    expect(requirement.structuredContent).toMatchObject({
      status: "satisfied",
      requirement: "age_18_plus",
      value: "withheld",
    });
    expect(binding.structuredContent).toMatchObject({
      status: "bound",
      field: "identity_number",
      value: "withheld",
    });
    expect(store.getSnapshot().privacyTrace.map((entry) => entry.scenario)).toEqual([
      "membership",
      "membership",
    ]);
    expect(serialized).not.toContain(vault.identityNumber);
    expect(serialized).not.toContain(vault.dateOfBirth);
  });

  it("rejects cross-scenario fields, requirements, and bindings", async () => {
    const { store, tools } = createMembershipToolset();
    const before = store.getSnapshot();

    expect(() => tools.set_public_fields.execute({
      fields: { monthly_rent: 1200 },
    })).toThrow("active-scenario public fields only");
    expect(() => tools.evaluate_private_requirement.execute({
      requirement: "income_3x_rent",
    })).toThrow("active scenario");
    await expect(tools.request_private_binding.execute({
      field: "passport_number",
    })).rejects.toThrow("active scenario");
    expect(store.getSnapshot()).toEqual(before);
  });

  it("keeps dynamic surfaces and the no-submit invariant in both scenarios", () => {
    for (const scenarioId of ["rental", "membership"] as const) {
      const store = createSealedStore(scenarioId);
      expect(getActiveSealedToolNames(store.getSnapshot())).toEqual(
        ACTIVE_TOOL_NAMES_BY_SCENARIO[scenarioId][1],
      );
      store.setWizardStep(2);
      expect(getActiveSealedToolNames(store.getSnapshot())).toEqual(
        ACTIVE_TOOL_NAMES_BY_SCENARIO[scenarioId][2],
      );
      store.requestReview({ ref: "test-review", scenarioId, demoSession: store.getSnapshot().demoSession, requirement: scenarioId === "rental" ? "income_3x_rent" : "age_18_plus", requirementStatus: "satisfied", bindingRef: "test-binding", submitted: false });
      expect(getActiveSealedToolNames(store.getSnapshot())).toEqual([
        "get_application_context",
        "flag_uncertain",
      ]);
    }
    expect(JSON.stringify(ACTIVE_TOOL_NAMES_BY_SCENARIO)).not.toContain("submit");
    expect(SEALED_TOOL_NAMES).not.toContain("submit_application");
  });

  it("resets the active demo scenario, logs, review state, and pending approval", async () => {
    const { store, tools } = createMembershipToolset();
    await tools.evaluate_private_requirement.execute({ requirement: "age_18_plus" });
    const pending = tools.request_private_binding.execute({ field: "identity_number" });
    store.setPublicField("display_name", "Aylin");
    store.setWizardStep(3);

    store.reset();
    await expect(pending).rejects.toThrow("stale for the active demo session");
    expect(store.getSnapshot()).toMatchObject({
      scenarioId: "membership",
      currentStep: 1,
      reviewState: "not_requested",
      activity: [],
      privacyTrace: [],
      pendingBindingApproval: null,
    });
    expect(store.getSnapshot().workflow.publicFields.display_name).toBe("");
  });

  it("switches the visible workflow and re-registers a scenario-specific surface", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool },
    });
    render(<SealedApplication />);
    await waitFor(() => expect(screen.getByTestId("site-tools-status")).toHaveTextContent("5 tools"));

    fireEvent.click(screen.getByRole("button", { name: "Membership" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Create your public profile" })).toBeVisible());
    await waitFor(() => {
      const requirementRegistrations = registerTool.mock.calls.filter(
        ([tool]) => tool.name === "evaluate_private_requirement",
      );
      expect(requirementRegistrations.at(-1)?.[0].inputSchema).toMatchObject({
        properties: { requirement: { enum: ["age_18_plus"] } },
      });
    });
    expect(screen.getByText("Date of birth")).toBeVisible();
    expect(screen.getByText("Identity number")).toBeVisible();
  });

  it("keeps both membership canaries out of rendered and observable state", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool },
    });
    render(<SealedApplication />);
    fireEvent.click(screen.getByRole("button", { name: "Membership" }));
    await waitFor(() => expect(screen.getByTestId("site-tools-status")).toHaveTextContent("5 tools"));
    const requirementTool = registerTool.mock.calls.filter(
      ([tool]) => tool.name === "evaluate_private_requirement",
    ).at(-1)?.[0];
    const bindingTool = registerTool.mock.calls.filter(
      ([tool]) => tool.name === "request_private_binding",
    ).at(-1)?.[0];
    const requirement = await requirementTool.execute({ requirement: "age_18_plus" });
    const bindingPromise = bindingTool.execute({ field: "identity_number" });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: /approve binding/i }));
    const binding = await bindingPromise;
    const observable = JSON.stringify({
      requirement,
      binding,
      snapshot: sealedStore.getSnapshot(),
      html: document.documentElement.outerHTML,
      registrations: registerTool.mock.calls,
    });

    expect(observable).not.toContain(MEMBERSHIP_CANARY_SECRET);
    expect(observable).not.toContain(MEMBERSHIP_BIRTH_DATE);
    expect(document.body.textContent).toContain("Boundary Ledger");
    expect(document.body.textContent).toContain("age_18_plus");
  });
});

function createTestToolset() {
  const store = createSealedStore();
  const vault = createMockPrivateVault();
  return {
    store,
    vault,
    tools: createSealedToolset({ vault, store }),
  };
}

describe("sealed WebMCP tool contracts", () => {
  it("exposes exactly the six allowed tools and never submit_application", () => {
    const { tools } = createTestToolset();

    expect(Object.keys(tools)).toEqual([...SEALED_TOOL_NAMES]);
    expect(SEALED_TOOL_NAMES).not.toContain("submit_application");
    expect(Object.keys(tools)).not.toContain("submit_application");
    for (const names of Object.values(ACTIVE_TOOL_NAMES_BY_STEP)) {
      expect(names.length).toBeLessThanOrEqual(6);
      expect(names).not.toContain("submit_application");
    }
  });

  it("marks read tools read-only and every mutation as state-changing", () => {
    const { tools } = createTestToolset();
    const readOnlyTools = [tools.get_application_context];
    const mutationTools = [
      tools.set_public_fields,
      tools.flag_uncertain,
      tools.request_review,
      tools.request_private_binding,
      tools.evaluate_private_requirement,
    ];

    for (const tool of readOnlyTools) {
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        untrustedContentHint: false,
      });
    }
    for (const tool of mutationTools) {
      expect(tool.annotations).toEqual({
        readOnlyHint: false,
        untrustedContentHint: false,
      });
    }
  });

  it("keeps every schema deterministic and keeps sealed fields out of public writes", () => {
    const { tools } = createTestToolset();

    expect(tools.get_application_context.inputSchema).toMatchObject({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
    expect(tools.flag_uncertain.inputSchema).toMatchObject({
      properties: {
        topic: {
          enum: ["income_eligibility", "passport_number", "property_details"],
        },
      },
      required: ["topic"],
      additionalProperties: false,
    });
    expect(tools.set_public_fields.inputSchema).toMatchObject({
      properties: {
        fields: {
          minProperties: 1,
          additionalProperties: false,
        },
      },
      required: ["fields"],
      additionalProperties: false,
    });
    expect(JSON.stringify(tools.set_public_fields.inputSchema)).not.toContain(
      "passport_number",
    );
    expect(JSON.stringify(tools.set_public_fields.inputSchema)).not.toContain(
      "monthly_income",
    );
  });

  it("keeps private-tool selection guidance explicit", () => {
    const { tools } = createTestToolset();

    expect(tools.get_application_context.description).toContain("guarded egress");
    expect(tools.evaluate_private_requirement.description).toContain("once per demo session");
    expect(tools.evaluate_private_requirement.description).toContain("duplicate evaluation is rejected");
    expect(tools.request_private_binding.description).toContain("opaque session-bound artifact");
    expect(tools.request_review.description).toContain("never submits");
  });

  it("executes every non-approval contract through the shared store", async () => {
    const { store, tools, vault } = createTestToolset();

    const context = await tools.get_application_context.execute({});
    const publicFields = await tools.set_public_fields.execute({
      fields: {
        email: "aylin@example.com",
        full_name: "Aylin Mammadova",
      },
    });
    const uncertainty = await tools.flag_uncertain.execute({
      topic: "property_details",
    });
    store.setWizardStep(2);
    const stepTwoTools = createSealedToolset({ store, vault });
    const income = await stepTwoTools.evaluate_private_requirement.execute({
      requirement: "income_3x_rent",
    });
    const bindingPromise = stepTwoTools.request_private_binding.execute({ field: "passport_number" });
    store.resolvePrivateBindingApproval(true);
    await bindingPromise;
    const review = await stepTwoTools.request_review.execute({});

    expect(context.structuredContent).toMatchObject({
      status: "ok",
      private_fields: { income: "withheld" },
      sections: {
        applicant_details: {
          required_public_fields: ["full_name", "email"],
        },
        home_details: {
          required_public_fields: [
            "property_address",
            "monthly_rent",
            "move_in_date",
          ],
        },
        privacy_review: {
          private_capabilities: ["income_3x_rent", "passport_number"],
        },
      },
      open_questions: expect.arrayContaining(["income_3x_rent"]),
    });
    expect(publicFields.structuredContent).toEqual({
      status: "updated",
      updated_fields: ["email", "full_name"],
      private_fields: "unchanged",
    });
    expect(uncertainty.structuredContent).toEqual({
      status: "flagged",
      topic: "property_details",
    });
    expect(review.structuredContent).toMatchObject({
      status: "review_requested",
      submitted: false,
    });
    expect(income.structuredContent).toMatchObject({
      status: "satisfied",
      requirement: "income_3x_rent",
      value: "withheld",
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.workflow.publicFields.full_name).toBe("Aylin Mammadova");
    expect(snapshot.reviewState).toBe("requested");
    expect(snapshot.uncertainTopics).toEqual(["property_details"]);
    expect(snapshot.activity).toHaveLength(6);
    expect(snapshot.privacyTrace).toHaveLength(2);
    expect(JSON.stringify({ context, publicFields, uncertainty, review, income, snapshot })).not.toContain(
      DEMO_CANARY_SECRET,
    );
    expect(JSON.stringify({ context, publicFields, uncertainty, review, income, snapshot })).not.toContain(
      String(vault.monthlyIncome),
    );
  });

  it("rejects sealed-field attempts through set_public_fields before state changes", async () => {
    const { store, tools, vault } = createTestToolset();
    const before = store.getSnapshot();

    expect(() =>
      tools.set_public_fields.execute({
        fields: {
          passport_number: "attempted-write",
        },
      } as never),
    ).toThrow("sealed fields cannot be edited");

    const after = store.getSnapshot();
    expect(after.workflow).toEqual(before.workflow);
    expect(after.activity).toHaveLength(0);
    expect(JSON.stringify(after)).not.toContain(vault.passportNumber);
  });

  it("requests human review without creating a submission state", async () => {
    const { store, vault } = createTestToolset();
    store.setWizardStep(2);
    const stepTwoTools = createSealedToolset({ store, vault });
    await stepTwoTools.evaluate_private_requirement.execute({ requirement: "income_3x_rent" });
    const bindingPromise = stepTwoTools.request_private_binding.execute({ field: "passport_number" });
    store.resolvePrivateBindingApproval(true);
    await bindingPromise;
    const result = await stepTwoTools.request_review.execute({});

    expect(result.structuredContent).toMatchObject({
      status: "review_requested",
      submitted: false,
    });
    expect(store.getSnapshot().reviewState).toBe("requested");
    expect(store.getSnapshot()).not.toHaveProperty("submitted");
    expect(store.getSnapshot().activity[0]).toMatchObject({
      toolName: "request_review",
      redactedOutput: { status: "review_requested", submitted: false },
    });
    expect(SEALED_TOOL_NAMES).not.toContain("submit_application");
  });

  it("records all agent calls while privacy trace stays private-operation-only", async () => {
    const { store, tools } = createTestToolset();
    await tools.get_application_context.execute({});
    await tools.set_public_fields.execute({
      fields: { property_address: "24 River Road, Baku" },
    });
    await tools.flag_uncertain.execute({ topic: "income_eligibility" });
    await tools.evaluate_private_requirement.execute({
      requirement: "income_3x_rent",
    });
    const bindingPromise = tools.request_private_binding.execute({ field: "passport_number" });
    store.resolvePrivateBindingApproval(true);
    await bindingPromise;

    expect(store.getSnapshot().activity.map((entry) => entry.toolName)).toEqual([
      "request_private_binding",
      "evaluate_private_requirement",
      "flag_uncertain",
      "set_public_fields",
      "get_application_context",
    ]);
    expect(store.getSnapshot().privacyTrace).toHaveLength(2);
    expect(store.getSnapshot().privacyTrace.map((entry) => entry.capability)).toEqual(["passport_number", "income_3x_rent"]);
  });

  it("changes the tool surface by step and after human review is requested", () => {
    const store = createSealedStore();

    expect(getActiveSealedToolNames(store.getSnapshot())).toEqual(
      ACTIVE_TOOL_NAMES_BY_STEP[1],
    );
    store.setWizardStep(2);
    expect(getActiveSealedToolNames(store.getSnapshot())).toEqual(
      ACTIVE_TOOL_NAMES_BY_STEP[2],
    );
    store.setWizardStep(3);
    expect(getActiveSealedToolNames(store.getSnapshot())).toEqual(
      ACTIVE_TOOL_NAMES_BY_STEP[3],
    );
    store.requestReview({ ref: "test-review", scenarioId: "rental", demoSession: store.getSnapshot().demoSession, requirement: "income_3x_rent", requirementStatus: "satisfied", bindingRef: "test-binding", submitted: false });
    expect(getActiveSealedToolNames(store.getSnapshot())).toEqual([
      "get_application_context",
      "flag_uncertain",
    ]);
  });

  it("uses AbortSignal ownership for the current registration surface", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    const modelContext = { registerTool } as unknown as ModelContext;
    const { tools } = createTestToolset();
    const controller = new AbortController();

    await registerSealedTools(
      modelContext,
      tools,
      controller.signal,
      ACTIVE_TOOL_NAMES_BY_STEP[3],
    );

    expect(registerTool).toHaveBeenCalledTimes(5);
    expect(registerTool.mock.calls.map(([tool]) => tool.name)).toEqual(
      [...ACTIVE_TOOL_NAMES_BY_STEP[3]],
    );
    expect(registerTool.mock.calls.every(([, options]) => options.signal === controller.signal)).toBe(
      true,
    );
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
    expect(registerTool.mock.calls.map(([tool]) => tool.name)).not.toContain(
      "submit_application",
    );
  });

  it("keeps the registered private handlers on the shared state path", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    const modelContext = { registerTool } as unknown as ModelContext;
    const { store, tools, vault } = createTestToolset();

    await registerSealedTools(modelContext, tools, undefined, ACTIVE_TOOL_NAMES_BY_STEP[1]);
    const registeredRequirement = registerTool.mock.calls.find(
      ([tool]) => tool.name === "evaluate_private_requirement",
    )?.[0];
    const registeredBinding = registerTool.mock.calls.find(
      ([tool]) => tool.name === "request_private_binding",
    )?.[0];
    expect(registeredRequirement).toBeDefined();
    expect(registeredBinding).toBeDefined();
    if (!registeredRequirement || !registeredBinding) {
      throw new Error("Expected both private handlers to be registered");
    }

    const requirement = await registeredRequirement.execute({
      requirement: "income_3x_rent",
    });
    const bindingPromise = registeredBinding.execute({
      field: "passport_number",
    });
    expect(store.getSnapshot().pendingBindingApproval?.field).toBe(
      "passport_number",
    );
    store.resolvePrivateBindingApproval(true);
    const binding = await bindingPromise;

    expect(requirement.structuredContent).toMatchObject({
      status: "satisfied",
      requirement: "income_3x_rent",
      value: "withheld",
    });
    expect(binding.structuredContent).toMatchObject({
      status: "bound",
      field: "passport_number",
      value: "withheld",
    });
    expect(store.getSnapshot().workflow.requirementResults.income_3x_rent).toBe("satisfied");
    expect(store.getSnapshot().workflow.privateBindings.passport_number).toBe(
      "bound",
    );
    expect(store.getSnapshot().activity).toHaveLength(2);
    expect(store.getSnapshot().privacyTrace).toHaveLength(2);
    expect(JSON.stringify({ requirement, binding, snapshot: store.getSnapshot() })).not.toContain(
      DEMO_CANARY_SECRET,
    );
    expect(JSON.stringify({ requirement, binding, snapshot: store.getSnapshot() })).not.toContain(
      String(vault.monthlyIncome),
    );
  });
});

describe("sealed application UI and native registration", () => {
  it("shows the current step surface count only after registration resolves", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool },
    });

    render(<SealedApplication />);

    await waitFor(() =>
      expect(screen.getByTestId("site-tools-status")).toHaveTextContent(
        "Site tools ready · 5 tools",
      ),
    );
    expect(screen.getByTestId("active-tool-count")).toHaveTextContent("5");
    expect(registerTool.mock.calls.map(([tool]) => tool.name)).toEqual(
      [...ACTIVE_TOOL_NAMES_BY_STEP[1]],
    );
  });

  it("unregisters the old surface and registers the new surface as the wizard advances", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool },
    });

    render(<SealedApplication />);
    await waitFor(() =>
      expect(screen.getByTestId("site-tools-status")).toHaveTextContent(
        "Site tools ready · 5 tools",
      ),
    );
    const firstSignal = registerTool.mock.calls[0][1].signal as AbortSignal;

    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Aylin Mammadova" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /email address/i }), {
      target: { value: "aylin@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(screen.getByTestId("site-tools-status")).toHaveTextContent(
        "Site tools ready · 6 tools",
      ),
    );
    expect(firstSignal.aborted).toBe(true);
    const secondSignal = registerTool.mock.calls[5][1].signal as AbortSignal;

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(screen.getByTestId("site-tools-status")).toHaveTextContent(
        "Site tools ready · 5 tools",
      ),
    );
    expect(secondSignal.aborted).toBe(true);
    expect(screen.getByRole("heading", { name: "Review before you finish" })).toBeVisible();
    expect(registerTool.mock.calls.map(([tool]) => tool.name)).toEqual([
      ...ACTIVE_TOOL_NAMES_BY_STEP[1],
      ...ACTIVE_TOOL_NAMES_BY_STEP[2],
      ...ACTIVE_TOOL_NAMES_BY_STEP[3],
    ]);
  });

  it("keeps the three-step wizard public-only and makes private actions agent-first", () => {
    render(<SealedApplication />);

    expect(screen.getByRole("heading", { name: "Tell us about you" })).toBeVisible();
    expect(screen.getByRole("button", { name: /your details/i })).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.getByText("Ask the connected agent to check")).toBeVisible();
    expect(screen.getByText("Agent can request a binding")).toBeVisible();
    expect(screen.queryByRole("button", { name: /check income eligibility/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /bind passport locally/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /passport/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Aylin Mammadova" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /email address/i }), {
      target: { value: "aylin@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("heading", { name: "Review before you finish" })).toBeVisible();
    expect(screen.getByText("Private checks are ready")).toBeVisible();
    expect(screen.queryByText("Application copilot")).not.toBeInTheDocument();
    expect(screen.queryByTestId("debug-controls")).not.toBeInTheDocument();
  });

  it("reflects a registered requirement handler in the visible shared state", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool },
    });

    render(<SealedApplication />);
    await waitFor(() =>
      expect(screen.getByTestId("site-tools-status")).toHaveTextContent(
        "Site tools ready · 5 tools",
      ),
    );
    const registeredTool = registerTool.mock.calls.find(
      ([tool]) => tool.name === "evaluate_private_requirement",
    )?.[0];
    expect(registeredTool).toBeDefined();
    if (!registeredTool) throw new Error("Requirement tool was not registered");

    const result = await registeredTool.execute({
      requirement: "income_3x_rent",
    });

    await waitFor(() => {
      expect(screen.getByTestId("income-requirement-result")).toHaveTextContent(
        "Qualified",
      );
      expect(screen.getByTestId("activity-count")).toHaveTextContent("1 call");
      expect(screen.getByTestId("privacy-count")).toHaveTextContent("1 op");
      expect(screen.getByTestId("last-tool-response")).toHaveTextContent(
        "Requirement satisfied",
      );
    });
    expect(result.structuredContent).toMatchObject({
      status: "satisfied",
      requirement: "income_3x_rent",
      value: "withheld",
    });
    expect(screen.getByTestId("actual-income-status")).toHaveTextContent(
      "Withheld from agent",
    );
  });

  it("opens approval for a registered binding handler and then updates both panels", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool },
    });

    render(<SealedApplication />);
    await waitFor(() =>
      expect(screen.getByTestId("site-tools-status")).toHaveTextContent(
        "Site tools ready · 5 tools",
      ),
    );
    const registeredTool = registerTool.mock.calls.find(
      ([tool]) => tool.name === "request_private_binding",
    )?.[0];
    expect(registeredTool).toBeDefined();
    if (!registeredTool) throw new Error("Binding tool was not registered");

    const resultPromise = registeredTool.execute({ field: "passport_number" });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: /approve binding/i }));
    const result = await resultPromise;

    await waitFor(() => {
      expect(screen.getByTestId("passport-binding-status")).toHaveTextContent(
        "Bound locally",
      );
      expect(screen.getByTestId("activity-count")).toHaveTextContent("1 call");
      expect(screen.getByTestId("privacy-count")).toHaveTextContent("1 op");
    });
    expect(result.structuredContent).toMatchObject({
      status: "bound",
      field: "passport_number",
      value: "withheld",
    });
  });
});

describe("rental application privacy boundary", () => {
  it("keeps vault values out of every registered payload, rendered DOM, input, and trace", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool },
    });
    const vault = createTestPrivateVault();

    render(<SealedApplication />);
    await waitFor(() =>
      expect(screen.getByTestId("site-tools-status")).toHaveTextContent(
        "Site tools ready · 5 tools",
      ),
    );
    const bindingTool = registerTool.mock.calls.find(
      ([tool]) => tool.name === "request_private_binding",
    )?.[0];
    const requirementTool = registerTool.mock.calls.find(
      ([tool]) => tool.name === "evaluate_private_requirement",
    )?.[0];
    expect(bindingTool).toBeDefined();
    expect(requirementTool).toBeDefined();
    if (!bindingTool || !requirementTool) {
      throw new Error("Expected both private tools");
    }

    const bindingPromise = bindingTool.execute({ field: "passport_number" });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: /approve binding/i }));
    const bindingResult = await bindingPromise;
    const requirementResult = await requirementTool.execute({
      requirement: "income_3x_rent",
    });

    const inputValues = Array.from(document.querySelectorAll("input")).map(
      (input) => input.value,
    );
    const renderedHtml = document.documentElement.outerHTML;
    const registeredPayload = JSON.stringify(registerTool.mock.calls);
    const visibleText = document.body.textContent ?? "";
    const boundarySnapshot = JSON.stringify(sealedStore.getSnapshot());

    expect(JSON.stringify({ bindingResult, requirementResult, registeredPayload })).not.toContain(
      vault.passportNumber,
    );
    expect(JSON.stringify({ bindingResult, requirementResult, registeredPayload })).not.toContain(
      String(vault.monthlyIncome),
    );
    expect(visibleText).not.toContain(vault.passportNumber);
    expect(visibleText).not.toContain(String(vault.monthlyIncome));
    expect(renderedHtml).not.toContain(vault.passportNumber);
    expect(renderedHtml).not.toContain(String(vault.monthlyIncome));
    expect(inputValues).not.toContain(vault.passportNumber);
    expect(inputValues).not.toContain(String(vault.monthlyIncome));
    expect(boundarySnapshot).not.toContain(DEMO_CANARY_SECRET);
    expect(boundarySnapshot).not.toContain(String(vault.monthlyIncome));
    expect(visibleText).toContain("WebMCP activity");
    expect(visibleText).toContain("Boundary Ledger");
    expect(visibleText).toContain("Guarded WebMCP payload");
    expect(visibleText).toContain("Actual income");
    expect(visibleText).toContain("Withheld from agent");
    expect(visibleText).toContain("actor · agent");
    expect(visibleText).toContain('"value":"withheld"');
    expect(visibleText).not.toContain("submit_application");
    expect(
      screen.getByText("Raw private values remain withheld.", { exact: true }),
    ).toBeVisible();
  });
});
