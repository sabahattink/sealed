"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createMockPrivateVault } from "@/lib/private-vault";
import {
  getBindingStatus,
  getRequirementResult,
  getScenario,
  isStepComplete,
  SCENARIOS,
  type PublicFieldId,
  type PublicFieldValue,
  type ScenarioId,
  type WorkflowStep,
} from "@/lib/scenarios";
import {
  createSealedToolset,
  getActiveSealedToolNames,
  registerSealedTools,
  type SealedToolName,
  type SealedToolset,
} from "@/lib/sealed-tools";
import { sealedStore } from "@/lib/sealed-store";

type WebMcpStatus = "checking" | "registering" | "ready" | "unsupported" | "error";
type IconName = "activity" | "arrow-left" | "arrow-right" | "calendar" | "check" | "close" | "home" | "lock" | "shield" | "user" | "warning";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const props = { "aria-hidden": true, fill: "none", height: size, stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.9, viewBox: "0 0 24 24", width: size };
  switch (name) {
    case "activity": return <svg {...props}><path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" /></svg>;
    case "arrow-left": return <svg {...props}><path d="M19 12H5m7 7-7-7 7-7" /></svg>;
    case "arrow-right": return <svg {...props}><path d="M5 12h14m-7-7 7 7-7 7" /></svg>;
    case "calendar": return <svg {...props}><rect height="16" rx="2.5" width="17" x="3.5" y="5" /><path d="M8 3v4m8-4v4M3.5 10h17" /></svg>;
    case "check": return <svg {...props}><path d="m5 12 4.2 4.2L19 6.5" /></svg>;
    case "close": return <svg {...props}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case "home": return <svg {...props}><path d="m4 10 8-6 8 6M6 9.5V20h12V9.5M10 20v-5h4v5" /></svg>;
    case "lock": return <svg {...props}><rect height="10" rx="2" width="14" x="5" y="10" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
    case "shield": return <svg {...props}><path d="M12 3.5 19 6v5c0 4.3-2.8 7.7-7 10-4.2-2.3-7-5.7-7-10V6l7-2.5Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></svg>;
    case "user": return <svg {...props}><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20c.6-3.2 2.8-4.8 6.5-4.8s5.9 1.6 6.5 4.8" /></svg>;
    case "warning": return <svg {...props}><path d="m12 4 8.2 15a1 1 0 0 1-.9 1.5H4.7a1 1 0 0 1-.9-1.5L12 4Z" /><path d="M12 9v4m0 3.5v.1" /></svg>;
  }
}

function statusLabel(status: WebMcpStatus, count: number) {
  if (status === "ready") return `Site tools ready · ${count} tools`;
  if (status === "registering") return "Registering site tools";
  if (status === "unsupported") return "Site tools unavailable · 0 tools";
  if (status === "error") return "Site tools registration failed";
  return "Checking site tools";
}

const baseToolLabels: Record<SealedToolName, string> = {
  evaluate_private_requirement: "Private predicate",
  flag_uncertain: "Flag uncertainty",
  get_application_context: "Workflow context",
  request_private_binding: "Private binding",
  request_review: "Human review",
  set_public_fields: "Public fields",
};

function formatTimestamp(timestamp: string) { return `${timestamp.slice(11, 19)} UTC`; }
function formatCount(count: number, one: string, many: string) { return `${count} ${count === 1 ? one : many}`; }

function fieldValue(fields: Partial<Record<PublicFieldId, PublicFieldValue>>, id: PublicFieldId) {
  return fields[id] ?? "";
}

export function SealedApplication() {
  const state = useSyncExternalStore(sealedStore.subscribe, sealedStore.getSnapshot, sealedStore.getServerSnapshot);
  const { scenarioId, workflow, currentStep, reviewState, activity, privacyTrace, lastToolResponse, pendingBindingApproval } = state;
  const scenario = getScenario(scenarioId);
  const requirementResult = getRequirementResult(workflow, scenario);
  const bindingStatus = getBindingStatus(workflow, scenario);
  const activeToolNames = getActiveSealedToolNames(state);
  const activeToolSurfaceKey = `${scenarioId}:${activeToolNames.join("|")}`;
  const toolsRef = useRef<SealedToolset | null>(null);
  const approvalDialogRef = useRef<HTMLDivElement>(null);
  const [webMcpStatus, setWebMcpStatus] = useState<WebMcpStatus>("checking");
  const [registeredToolCount, setRegisteredToolCount] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const toolNames = getActiveSealedToolNames(sealedStore.getSnapshot());
    const tools = createSealedToolset({ vault: createMockPrivateVault(), store: sealedStore });
    toolsRef.current = tools;
    queueMicrotask(() => {
      if (!cancelled) { setRegisteredToolCount(0); setWebMcpStatus("registering"); }
    });
    const modelContext = document.modelContext;
    if (!modelContext) {
      queueMicrotask(() => { if (!cancelled) setWebMcpStatus("unsupported"); });
      return () => { cancelled = true; toolsRef.current = null; };
    }
    const controller = new AbortController();
    registerSealedTools(modelContext, tools, controller.signal, toolNames)
      .then(() => {
        if (!cancelled && !controller.signal.aborted) {
          setRegisteredToolCount(toolNames.length);
          setWebMcpStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) { setRegisteredToolCount(0); setWebMcpStatus("error"); }
      });
    return () => { cancelled = true; toolsRef.current = null; controller.abort(); };
  }, [activeToolSurfaceKey]);

  useEffect(() => {
    if (!pendingBindingApproval) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => approvalDialogRef.current?.querySelector<HTMLButtonElement>("[data-autofocus]")?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") sealedStore.resolvePrivateBindingApproval(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [pendingBindingApproval]);

  const changeScenario = (nextScenario: ScenarioId) => {
    if (nextScenario === scenarioId) return;
    sealedStore.setScenario(nextScenario);
    setStepError(null);
  };
  const resetDemo = () => { sealedStore.reset(); setStepError(null); };
  const moveToStep = (target: WorkflowStep) => {
    if (target <= currentStep || isStepComplete(scenario, workflow, currentStep)) {
      sealedStore.setWizardStep(target);
      setStepError(null);
    } else {
      setStepError(currentStep === 1 ? "Complete your public profile to continue." : "Complete the public workflow details to continue.");
    }
  };
  const runRequirement = () => {
    void Promise.resolve(toolsRef.current?.evaluate_private_requirement.execute({ requirement: scenario.requirement.id })).catch(() => undefined);
  };
  const runBinding = () => {
    if (pendingBindingApproval) return;
    void Promise.resolve(toolsRef.current?.request_private_binding.execute({ field: scenario.binding.id })).catch(() => undefined);
  };

  const currentSection = scenario.sections[Math.min(currentStep - 1, 2)];
  const currentFields = scenario.publicFields.filter((field) => currentSection.requiredPublicFields.includes(field.id));
  const isSatisfied = requirementResult === "satisfied";
  const isNotSatisfied = requirementResult === "not_satisfied";

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Sealed home"><span className="wordmark-mark"><Icon name="shield" size={19} /></span><span>sealed</span></a>
        <div className="topbar-meta">
          <button className="demo-reset" data-testid="reset-demo" onClick={resetDemo} type="button">Reset demo</button>
          <span className="trust-pill"><Icon name="lock" size={13} /> Private by default</span>
          <span className={`mcp-status mcp-status-${webMcpStatus}`} data-testid="site-tools-status"><span className="status-dot" /><span className="mcp-status-label">{statusLabel(webMcpStatus, registeredToolCount)}</span></span>
        </div>
      </header>

      <section className="primitive-banner" aria-label="Sealed architecture">
        <div>
          <span className="primitive-kicker">Reusable WebMCP primitive</span>
          <strong>Sealed is a privacy boundary for agentic web apps.</strong>
          <span>Same capabilities. Different workflow. Raw values stay local.</span>
        </div>
        <div className="scenario-switcher" role="group" aria-label="Demo scenario">
          {(Object.keys(SCENARIOS) as ScenarioId[]).map((id) => (
            <button key={id} className={id === scenarioId ? "scenario-button scenario-button-active" : "scenario-button"} aria-pressed={id === scenarioId} onClick={() => changeScenario(id)} type="button">
              {SCENARIOS[id].shortLabel}
            </button>
          ))}
        </div>
      </section>

      <section className="hero" id="top">
        <div className="hero-copy"><p className="eyebrow">{scenario.eyebrow}</p><h1>{scenario.title}</h1><p className="hero-lede">{scenario.lede}</p></div>
        <div className="hero-promise"><span className="hero-promise-icon"><Icon name="shield" size={22} /></span><div><p className="hero-promise-label">The Sealed promise</p><p>Private value → local operation → allowlisted result. The agent learns the outcome, not the secret.</p></div></div>
      </section>

      <section className="workspace-grid" aria-label={`${scenario.workflowLabel} workspace`}>
        <form className="wizard-card" noValidate onSubmit={(event) => event.preventDefault()}>
          <div className="wizard-card-header"><div><p className="section-kicker">{scenario.workflowLabel}</p><h2>{scenarioId === "rental" ? "Let's get your application started." : "Join with private verification."}</h2><p className="card-lede">Public details stay editable. Private predicates and bindings stay sealed.</p></div><span className={`draft-badge${reviewState === "requested" ? " draft-badge-review" : ""}`}><span className="draft-dot" />{reviewState === "requested" ? "Review requested" : "Draft"}</span></div>

          <nav className="stepper" aria-label="Application steps">
            {scenario.steps.map((step) => {
              const current = currentStep === step.id;
              const complete = step.id < currentStep;
              return <button className={`stepper-item${current ? " stepper-item-current" : ""}${complete ? " stepper-item-complete" : ""}`} disabled={step.id > currentStep + 1} key={step.id} onClick={() => moveToStep(step.id)} type="button" aria-current={current ? "step" : undefined}><span className="stepper-number">{complete ? <Icon name="check" size={14} /> : `0${step.id}`}</span><span className="stepper-copy"><strong>{step.label}</strong><span>{step.detail}</span></span></button>;
            })}
          </nav>

          <div className="step-content">
            {currentStep < 3 ? (
              <section className="step-panel" aria-labelledby="active-step-title">
                <div className="step-panel-heading"><span className="step-panel-icon"><Icon name={currentStep === 1 ? "user" : "home"} size={20} /></span><div><p className="step-index">Step 0{currentStep}</p><h3 id="active-step-title">{scenarioId === "rental" ? (currentStep === 1 ? "Tell us about you" : "Choose your next home") : (currentStep === 1 ? "Create your public profile" : "Choose your membership")}</h3><p>Only the public fields required for this workflow step appear here.</p></div></div>
                <div className="form-grid">
                  {currentFields.map((field) => (
                    <label className={`field${currentFields.length <= 2 ? " field-wide" : ""}`} htmlFor={field.id} key={field.id}>
                      <span>{field.label}</span>
                      {field.kind === "select" ? (
                        <select id={field.id} aria-label={field.label} value={String(fieldValue(workflow.publicFields, field.id))} onChange={(event) => sealedStore.setPublicField(field.id, event.target.value)}>{field.options?.map((option) => <option key={option}>{option}</option>)}</select>
                      ) : (
                        <input id={field.id} aria-label={field.label} type={field.kind === "number" ? "number" : field.kind} min={field.kind === "number" ? 1 : undefined} value={fieldValue(workflow.publicFields, field.id)} onChange={(event) => sealedStore.setPublicField(field.id, field.kind === "number" ? Number(event.target.value) : event.target.value)} />
                      )}
                      <small>{field.description}</small>
                    </label>
                  ))}
                </div>
                <div className="public-note"><Icon name="shield" size={16} /><span>These are public workflow details. {scenario.requirement.privateValueLabel} and {scenario.binding.label.toLowerCase()} are never entered here.</span></div>
              </section>
            ) : (
              <section className="step-panel" aria-labelledby="review-title">
                <div className="step-panel-heading"><span className="step-panel-icon"><Icon name="shield" size={20} /></span><div><p className="step-index">Step 03</p><h3 id="review-title">{scenarioId === "rental" ? "Review before you finish" : "Review membership verification"}</h3><strong>Private checks are ready</strong><p>The agent can request safe operations; only a human can take any final action.</p></div></div>
                <div className="review-banner"><span><Icon name="lock" size={17} /></span><div><strong>Human-only final action</strong><p>WebMCP can request review, but Sealed exposes no submit or enrollment tool.</p></div></div>
              </section>
            )}
            {stepError && <p className="step-error" role="alert">{stepError}</p>}
            <div className="wizard-footer"><span>{reviewState === "requested" ? "Locked to safe read/flag tools" : `Step ${currentStep} of 3`}</span><div className="wizard-actions">{currentStep > 1 && <button className="button button-quiet" onClick={() => moveToStep((currentStep - 1) as WorkflowStep)} type="button"><Icon name="arrow-left" size={16} /> Back</button>}{currentStep < 3 ? <button className="button button-primary" onClick={() => moveToStep((currentStep + 1) as WorkflowStep)} type="button">Continue <Icon name="arrow-right" size={16} /></button> : <button className="button button-quiet" onClick={() => moveToStep(1)} type="button">Edit {scenario.reviewLabel}</button>}</div></div>
          </div>
        </form>

        <aside className="trust-rail" aria-label="Privacy and WebMCP status">
          <section className="rail-card connection-card">
            <div className="rail-card-heading"><span className="rail-icon rail-icon-blue"><Icon name="activity" size={19} /></span><div><p className="section-kicker">WebMCP connection</p><h2>Agent access</h2></div></div>
            <div className={`connection-status connection-status-${webMcpStatus}`}><span className="connection-status-dot" /><div><strong>{statusLabel(webMcpStatus, registeredToolCount)}</strong><span>{webMcpStatus === "ready" ? "Available to the connected agent" : webMcpStatus === "unsupported" ? "Open in a WebMCP-capable browser" : "Checking the page connection"}</span></div></div>
            <div className="active-tools-summary" data-testid="active-tool-count"><span className="active-tools-number">{registeredToolCount}</span><div><strong>Active site tools</strong><span>Changes with scenario and workflow state</span></div></div>
            <div className="tool-surface"><span className="tool-surface-label">Current surface</span><div className="tool-surface-list">{activeToolNames.map((name) => <span className="tool-chip" key={name}>{baseToolLabels[name]}</span>)}</div></div>
            <div className="access-list"><div className="access-row access-row-allowed"><span><Icon name="check" size={14} /></span><div><strong>Evaluate a private predicate</strong><small>Decision only</small></div></div><div className="access-row access-row-allowed"><span><Icon name="check" size={14} /></span><div><strong>Request a sealed binding</strong><small>Human approval required</small></div></div><div className="access-row access-row-blocked"><span><Icon name="close" size={14} /></span><div><strong>Read raw private values</strong><small>Never available to the agent</small></div></div></div>
          </section>

          <section className={`rail-card eligibility-card${isSatisfied ? " eligibility-card-qualified" : ""}${isNotSatisfied ? " eligibility-card-not-qualified" : ""}`} data-testid="eligibility-card">
            <div className="eligibility-topline"><p className="section-kicker">Private predicate</p><span className="eligibility-badge"><Icon name="lock" size={12} /> Local only</span></div>
            <div className="eligibility-main"><div><span className="result-label">{scenario.requirement.label}</span><strong data-testid={scenarioId === "rental" ? "income-requirement-result" : "age-requirement-result"}>{requirementResult === "not_checked" ? "Awaiting check" : isSatisfied ? "Qualified" : "Not qualified"}</strong><p>{requirementResult === "not_checked" ? "Ask the connected agent to evaluate the private predicate." : `The ${scenario.requirement.id} predicate executed locally.`}</p></div><span className={`result-icon result-${requirementResult}`}>{isSatisfied ? <Icon name="check" size={22} /> : isNotSatisfied ? <Icon name="warning" size={20} /> : <Icon name="activity" size={20} />}</span></div>
            <div className="income-boundary"><span>{scenario.requirement.privateValueLabel}</span><strong data-testid={scenarioId === "rental" ? "actual-income-status" : "birth-date-status"}><Icon name="lock" size={13} /> Withheld from agent</strong></div>
            <div className="agent-action-note"><span className="agent-action-note-icon"><Icon name="activity" size={16} /></span><div><strong>Ask the connected agent to check</strong><span>It returns only an allowlisted decision.</span></div></div>
            <p className="eligibility-note">Uses <code>{scenario.requirement.id}</code>. The raw value never enters the DOM or tool response.</p>
            <div className="last-response"><div className="last-response-heading"><span>Last tool response</span><span>Redacted</span></div><p data-testid="last-tool-response">{lastToolResponse}</p></div>
          </section>

          <section className="rail-card sealed-card">
            <div className="rail-card-heading"><span className="rail-icon rail-icon-amber"><Icon name="lock" size={19} /></span><div><p className="section-kicker">Private binding</p><h2>{scenario.binding.label}</h2></div><span className={`field-status${bindingStatus === "bound" ? " field-status-bound" : ""}`} data-testid={scenarioId === "rental" ? "passport-binding-status" : "identity-binding-status"}>{bindingStatus === "bound" ? "Bound locally" : pendingBindingApproval ? "Approval requested" : "Not connected"}</span></div>
            <div className="sealed-field" aria-label={`${scenario.binding.label} sealed; raw value withheld`}><span className="sealed-field-icon"><Icon name="shield" size={18} /></span><div><strong>Value sealed</strong><span>Stored locally · never rendered</span></div><span className="sealed-field-state">{bindingStatus === "bound" ? "Bound" : "Approval needed"}</span></div>
            <div className="agent-action-note agent-action-note-amber"><span className="agent-action-note-icon"><Icon name="lock" size={16} /></span><div><strong>Agent can request a binding</strong><span>You approve it here before anything changes.</span></div></div>
            <p className="sealed-note">The page performs the binding locally and returns only <code>bound</code> with <code>value: withheld</code>.</p>
          </section>
        </aside>
      </section>

      <section className="observability-section" aria-labelledby="observability-title">
        <div className="observability-heading"><div><p className="section-kicker">Proof, in plain sight</p><h2 id="observability-title">See the boundary, not the secret.</h2></div><p className="observability-summary">Both scenarios emit the same redacted activity and privacy evidence.</p></div>
        <div className="observability-grid">
          <article className="trace-card" data-testid="webmcp-activity-panel"><div className="trace-card-heading"><div className="trace-title-group"><span className="trace-icon trace-icon-blue"><Icon name="activity" size={17} /></span><div><p className="section-kicker">Agent-visible record</p><h3>WebMCP activity</h3></div></div><span className="trace-count" data-testid="activity-count">{formatCount(activity.length, "call", "calls")}</span></div><p className="trace-intro">Every agent call records allowlisted inputs and redacted outputs.</p>{activity.length === 0 ? <div className="trace-empty"><span className="empty-icon"><Icon name="activity" size={17} /></span><div><strong>No agent calls yet</strong><p>The next connected-agent action will appear here.</p></div></div> : <div className="activity-list">{activity.map((entry) => <div className="activity-entry" data-testid="activity-entry" key={entry.id}><div className="activity-entry-top"><div className="entry-tool-name"><span className="entry-status-dot" /><code>{entry.toolName}</code></div><span>{formatTimestamp(entry.timestamp)}</span></div><span className="actor-chip">actor · {entry.actor}</span><div className="payload-row"><span>Redacted input</span><code>{JSON.stringify(entry.redactedInput)}</code></div><div className="payload-row"><span>Redacted output</span><code>{JSON.stringify(entry.redactedOutput)}</code></div></div>)}</div>}</article>
          <article className="trace-card" data-testid="privacy-trace-panel"><div className="trace-card-heading"><div className="trace-title-group"><span className="trace-icon trace-icon-green"><Icon name="shield" size={17} /></span><div><p className="section-kicker">Boundary evidence</p><h3>Privacy trace</h3></div></div><span className="trace-count" data-testid="privacy-count">{formatCount(privacyTrace.length, "op", "ops")}</span></div><p className="trace-intro">A compact proof of what executed locally and stayed private.</p>{privacyTrace.length === 0 ? <div className="trace-empty"><span className="empty-icon empty-icon-green"><Icon name="shield" size={17} /></span><div><strong>No private operation traced yet</strong><p>The next approved operation will create the first record.</p></div></div> : <div className="privacy-list">{privacyTrace.map((entry) => <div className="privacy-entry" data-testid="privacy-entry" key={entry.id}><div className="activity-entry-top"><div className="entry-tool-name"><span className="entry-status-dot entry-status-dot-green" /><code>{entry.capability}</code></div><span>{formatTimestamp(entry.timestamp)}</span></div><span className="actor-chip">scenario · {entry.scenario}</span><div className="privacy-check-grid"><div><span>Local vault access</span><strong className="trace-yes">{entry.localVaultAccess}</strong></div><div><span>DOM exposure</span><strong>{entry.domExposure}</strong></div><div><span>WebMCP input exposure</span><strong>{entry.webmcpInputExposure}</strong></div><div><span>WebMCP output exposure</span><strong>{entry.webmcpOutputExposure}</strong></div></div><div className="returned-result"><span>Returned result</span><strong>{entry.returnedResult}</strong></div></div>)}</div>}</article>
        </div>
      </section>

      {process.env.NODE_ENV === "development" && <details className="developer-controls" data-testid="debug-controls"><summary>Developer controls</summary><p>Local-only handler checks.</p><div className="developer-controls-actions"><button className="button button-quiet" onClick={runBinding} type="button">Run binding handler</button><button className="button button-quiet" onClick={runRequirement} type="button">Run requirement handler</button></div></details>}

      <footer className="page-footer"><span className="footer-brand"><span className="footer-mark"><Icon name="shield" size={13} /></span> Sealed</span><span>Two scenarios · one privacy boundary · no submission</span><span>Raw private values remain withheld.</span></footer>

      {pendingBindingApproval && <div className="modal-backdrop" role="presentation"><div aria-describedby="approval-dialog-description" aria-labelledby="approval-dialog-title" aria-modal="true" className="approval-dialog" ref={approvalDialogRef} role="dialog"><div className="approval-dialog-header"><span className="approval-dialog-icon"><Icon name="lock" size={22} /></span><button aria-label="Close approval dialog" className="icon-button" onClick={() => sealedStore.resolvePrivateBindingApproval(false)} type="button"><Icon name="close" size={18} /></button></div><p className="section-kicker">Human approval required</p><h2 id="approval-dialog-title">Bind your {scenario.binding.label.toLowerCase()}?</h2><p id="approval-dialog-description" className="approval-dialog-copy">The connected agent requested a local binding for your {scenario.binding.label.toLowerCase()}. Sealed keeps the raw value on this page and returns only a bound status.</p><div className="approval-dialog-proof"><div><Icon name="check" size={15} /> Stays inside the local page</div><div><Icon name="check" size={15} /> Never placed in a rendered input</div><div><Icon name="check" size={15} /> Agent receives no raw value</div></div><div className="approval-dialog-actions"><button className="button button-quiet" onClick={() => sealedStore.resolvePrivateBindingApproval(false)} type="button">Not now</button><button className="button button-primary" data-autofocus onClick={() => sealedStore.resolvePrivateBindingApproval(true)} type="button">Approve binding <Icon name="check" size={16} /></button></div></div></div>}
    </main>
  );
}
