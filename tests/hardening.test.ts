import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardSafeEgress, guardToolExecution, SAFE_EGRESS_ERROR, sanitizeBoundaryError } from "@/lib/safe-egress";
import { createSealedToolset, getActiveSealedToolNames } from "@/lib/sealed-tools";
import { createSealedStore } from "@/lib/sealed-store";
import { createTestPrivateVault, DEMO_CANARY_SECRET, MEMBERSHIP_BIRTH_DATE, MEMBERSHIP_CANARY_SECRET } from "@/tests/fixtures/private-vault";

afterEach(() => vi.useRealTimers());

function runtime(scenario: "rental" | "membership" = "rental") {
  const store = createSealedStore(scenario);
  const vault = createTestPrivateVault();
  return { store, vault, tools: createSealedToolset({ store, vault }) };
}

async function approveBinding(store: ReturnType<typeof createSealedStore>, tools: ReturnType<typeof createSealedToolset>, field: "passport_number" | "identity_number") {
  const pending = tools.request_private_binding.execute({ field });
  store.resolvePrivateBindingApproval(true);
  return pending;
}

describe("central safe egress", () => {
  it("fails closed when text content contains a raw private value", () => {
    const vault = createTestPrivateVault();
    expect(() => guardSafeEgress({ content: [{ type: "text", text: vault.passportNumber }], structuredContent: { status: "ok" } }, vault)).toThrow(SAFE_EGRESS_ERROR);
  });

  it("fails closed when structuredContent contains a raw private value", () => {
    const vault = createTestPrivateVault();
    expect(() => guardSafeEgress({ content: [{ type: "text", text: "safe" }], structuredContent: { leaked: vault.identityNumber } }, vault)).toThrow(SAFE_EGRESS_ERROR);
  });

  it("sanitizes raw private values from synchronous and async errors", async () => {
    const vault = createTestPrivateVault();
    expect(sanitizeBoundaryError(new Error(vault.passportNumber), vault).message).toBe(SAFE_EGRESS_ERROR);
    expect(() => guardToolExecution(vault, () => { throw new Error(vault.identityNumber); })).toThrow(SAFE_EGRESS_ERROR);
    await expect(guardToolExecution(vault, async () => { throw new Error(vault.dateOfBirth); })).rejects.toThrow(SAFE_EGRESS_ERROR);
  });

  it("keeps schemas, descriptions, outputs, activity, ledger, and snapshots canary-free", async () => {
    const { store, vault, tools } = runtime();
    const metadata = JSON.stringify(Object.values(tools).map(({ description, inputSchema }) => ({ description, inputSchema })));
    await tools.evaluate_private_requirement.execute({ requirement: "income_3x_rent" });
    await approveBinding(store, tools, "passport_number");
    const observable = JSON.stringify({ metadata, snapshot: store.getSnapshot() });
    expect(observable).not.toContain(vault.passportNumber);
    expect(observable).not.toContain(vault.identityNumber);
    expect(observable).not.toContain(vault.dateOfBirth);
    expect(observable).not.toContain(String(vault.monthlyIncome));
  });
});

describe("predicate anti-probing and lifecycle", () => {
  it("locks rent after one evaluation and rejects duplicate predicate calls", async () => {
    const { store, tools } = runtime();
    const first = await tools.evaluate_private_requirement.execute({ requirement: "income_3x_rent" });
    const snapshot = store.getSnapshot().requirementSnapshots.income_3x_rent;
    expect(first.structuredContent.status).toBe("satisfied");
    expect(snapshot?.publicDependencies).toEqual({ monthly_rent: 2000 });
    expect(() => store.setPublicField("monthly_rent", 2_900)).toThrow("locked after private evaluation");
    expect(() => tools.set_public_fields.execute({ fields: { monthly_rent: 2_900 } })).toThrow("locked after private evaluation");
    expect(() => tools.evaluate_private_requirement.execute({ requirement: "income_3x_rent" })).toThrow("already sealed for this demo session");
    expect(store.getSnapshot().workflow.publicFields.monthly_rent).toBe(2000);
  });

  it("reset creates a fresh evaluation budget and makes old handlers stale", async () => {
    const { store, vault, tools } = runtime();
    await tools.evaluate_private_requirement.execute({ requirement: "income_3x_rent" });
    store.reset();
    expect(() => tools.evaluate_private_requirement.execute({ requirement: "income_3x_rent" })).toThrow("stale for the active demo session");
    const fresh = createSealedToolset({ store, vault });
    expect((await fresh.evaluate_private_requirement.execute({ requirement: "income_3x_rent" })).structuredContent.status).toBe("satisfied");
  });

  it("scenario switches invalidate old handlers before they can mutate shared state", () => {
    const { store, tools } = runtime();
    store.setScenario("membership");
    const before = store.getSnapshot();
    expect(() => tools.set_public_fields.execute({ fields: { full_name: "Stale" } })).toThrow("stale for the active demo session");
    expect(store.getSnapshot()).toEqual(before);
  });

  it("step changes and in-flight old handlers cannot mutate the new surface", async () => {
    const { store, tools } = runtime();
    const pending = tools.request_private_binding.execute({ field: "passport_number" });
    store.setWizardStep(2);
    store.resolvePrivateBindingApproval(true);
    await expect(pending).rejects.toThrow("stale for the active tool surface");
    expect(store.getSnapshot().bindingArtifacts.passport_number).toBeUndefined();
    expect(() => tools.set_public_fields.execute({ fields: { full_name: "Old handler" } })).toThrow("stale for the active tool surface");
    expect(store.getSnapshot().workflow.publicFields.full_name).toBe("");
  });

  it("computes the 18+ cutoff from the current UTC date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T12:00:00Z"));
    const vault = { ...createTestPrivateVault(), dateOfBirth: "2008-08-29" };
    const firstStore = createSealedStore("membership");
    const first = createSealedToolset({ store: firstStore, vault });
    expect((await first.evaluate_private_requirement.execute({ requirement: "age_18_plus" })).structuredContent.status).toBe("not_satisfied");
    vi.setSystemTime(new Date("2026-08-29T00:00:00Z"));
    const secondStore = createSealedStore("membership");
    const second = createSealedToolset({ store: secondStore, vault });
    expect((await second.evaluate_private_requirement.execute({ requirement: "age_18_plus" })).structuredContent.status).toBe("satisfied");
  });
});

describe("consequential binding and review packet", () => {
  it("creates no artifact before approval and an opaque artifact after approval", async () => {
    const { store, vault, tools } = runtime();
    const pending = tools.request_private_binding.execute({ field: "passport_number" });
    expect(store.getSnapshot().bindingArtifacts.passport_number).toBeUndefined();
    store.resolvePrivateBindingApproval(true);
    const result = await pending;
    const artifact = store.getSnapshot().bindingArtifacts.passport_number;
    expect(artifact?.ref).toMatch(/^binding_[a-f0-9]{32}$/);
    expect(artifact?.localCommitment).toBeTruthy();
    expect(result.structuredContent.binding_ref).toBe(artifact?.ref);
    expect(JSON.stringify({ result, artifact })).not.toContain(vault.passportNumber);
  });

  it("rejects duplicate binding and invalidates artifacts on reset and scenario change", async () => {
    const { store, tools } = runtime();
    await approveBinding(store, tools, "passport_number");
    await expect(tools.request_private_binding.execute({ field: "passport_number" })).rejects.toThrow("already sealed for this demo session");
    store.reset();
    expect(store.getSnapshot().bindingArtifacts.passport_number).toBeUndefined();
    const fresh = createSealedToolset({ store, vault: createTestPrivateVault() });
    await approveBinding(store, fresh, "passport_number");
    store.setScenario("membership");
    expect(store.getSnapshot().bindingArtifacts).toEqual({});
  });

  it("requires both local artifacts and returns a safe non-submitting review packet", async () => {
    const { store, vault } = runtime();
    store.setWizardStep(2);
    const stepTwoTools = createSealedToolset({ store, vault });
    expect(() => stepTwoTools.request_review.execute({})).toThrow("requires a private predicate verdict and approved binding");
    await stepTwoTools.evaluate_private_requirement.execute({ requirement: "income_3x_rent" });
    expect(() => stepTwoTools.request_review.execute({})).toThrow("requires a private predicate verdict and approved binding");
    await approveBinding(store, stepTwoTools, "passport_number");
    const review = await stepTwoTools.request_review.execute({});
    expect(review.structuredContent).toMatchObject({ status: "review_requested", submitted: false, requirement: { id: "income_3x_rent", status: "satisfied" }, binding: { field: "passport_number" } });
    expect(review.structuredContent.packet_ref).toMatch(/^review_/);
    expect(store.getSnapshot().reviewPacket?.submitted).toBe(false);
    expect(getActiveSealedToolNames(store.getSnapshot())).toEqual(["get_application_context", "flag_uncertain"]);
    expect(JSON.stringify({ review, snapshot: store.getSnapshot() })).not.toContain(vault.passportNumber);
  });
});

describe("production mock-vault credibility", () => {
  it("keeps test canaries only under tests fixtures and removes production literal secrets", () => {
    const productionFiles = ["lib/private-vault.ts", "lib/sealed-tools.ts", "lib/sealed-store.ts", "lib/scenarios.ts", "components/SealedApplication.tsx"];
    const productionSource = productionFiles.map((file) => readFileSync(resolve(process.cwd(), file), "utf8")).join("\n");
    expect(productionSource).not.toContain(DEMO_CANARY_SECRET);
    expect(productionSource).not.toContain(MEMBERSHIP_CANARY_SECRET);
    expect(productionSource).not.toContain(MEMBERSHIP_BIRTH_DATE);
    expect(productionSource).not.toContain("CANARY-");
  });
});
