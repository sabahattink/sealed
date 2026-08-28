"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createMockPrivateVault } from "@/lib/private-vault";
import type {
  ApplicationStep,
  RequirementResult,
  RentalApplicationState,
} from "@/lib/rental-application";
import {
  createSealedToolset,
  getActiveSealedToolNames,
  registerSealedTools,
  type SealedToolName,
  type SealedToolset,
} from "@/lib/sealed-tools";
import {
  sealedStore,
  type PublicApplicationField,
} from "@/lib/sealed-store";

type WebMcpStatus =
  | "checking"
  | "registering"
  | "ready"
  | "unsupported"
  | "error";

type WizardStep = ApplicationStep;

type IconName =
  | "activity"
  | "arrow-left"
  | "arrow-right"
  | "calendar"
  | "check"
  | "check-circle"
  | "close"
  | "file"
  | "home"
  | "lock"
  | "shield"
  | "user"
  | "warning";

const wizardSteps: ReadonlyArray<{
  id: WizardStep;
  label: string;
  detail: string;
}> = [
  { id: 1, label: "Your details", detail: "Applicant" },
  { id: 2, label: "Your home", detail: "Property" },
  { id: 3, label: "Review & verify", detail: "Privacy check" },
];

const requirementCopy: Record<RequirementResult, string> = {
  not_checked: "Awaiting check",
  satisfied: "Qualified",
  not_satisfied: "Not qualified",
};

function Icon({
  name,
  size = 18,
  strokeWidth = 1.8,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}) {
  const commonProps = {
    "aria-hidden": true,
    fill: "none",
    height: size,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth,
    viewBox: "0 0 24 24",
    width: size,
  };

  switch (name) {
    case "activity":
      return (
        <svg {...commonProps}>
          <path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" />
        </svg>
      );
    case "arrow-left":
      return (
        <svg {...commonProps}>
          <path d="M19 12H5" />
          <path d="m12 19-7-7 7-7" />
        </svg>
      );
    case "arrow-right":
      return (
        <svg {...commonProps}>
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...commonProps}>
          <rect height="16" rx="2.5" width="17" x="3.5" y="5" />
          <path d="M8 3v4M16 3v4M3.5 10h17" />
        </svg>
      );
    case "check":
      return (
        <svg {...commonProps}>
          <path d="m5 12 4.2 4.2L19 6.5" />
        </svg>
      );
    case "check-circle":
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="m8.3 12 2.5 2.5 4.9-5" />
        </svg>
      );
    case "close":
      return (
        <svg {...commonProps}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      );
    case "file":
      return (
        <svg {...commonProps}>
          <path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V3.5Z" />
          <path d="M14 3.5V8h4M9 12h6M9 15.5h6" />
        </svg>
      );
    case "home":
      return (
        <svg {...commonProps}>
          <path d="m4 10 8-6 8 6" />
          <path d="M6 9.5V20h12V9.5M10 20v-5h4v5" />
        </svg>
      );
    case "lock":
      return (
        <svg {...commonProps}>
          <rect height="10" rx="2" width="14" x="5" y="10" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      );
    case "shield":
      return (
        <svg {...commonProps}>
          <path d="M12 3.5 19 6v5c0 4.3-2.8 7.7-7 10-4.2-2.3-7-5.7-7-10V6l7-2.5Z" />
          <path d="m8.5 12 2.2 2.2 4.8-5" />
        </svg>
      );
    case "user":
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="8" r="3.2" />
          <path d="M5.5 20c.6-3.2 2.8-4.8 6.5-4.8s5.9 1.6 6.5 4.8" />
        </svg>
      );
    case "warning":
      return (
        <svg {...commonProps}>
          <path d="m12 4 8.2 15a1 1 0 0 1-.9 1.5H4.7a1 1 0 0 1-.9-1.5L12 4Z" />
          <path d="M12 9v4M12 16.5v.1" />
        </svg>
      );
  }
}

function statusLabel(status: WebMcpStatus, registeredToolCount: number): string {
  switch (status) {
    case "ready":
      return `Site tools ready · ${registeredToolCount} tools`;
    case "registering":
      return "Registering site tools";
    case "unsupported":
      return "Site tools unavailable · 0 tools";
    case "error":
      return "Site tools registration failed";
    default:
      return "Checking site tools";
  }
}

const toolLabels: Record<SealedToolName, string> = {
  evaluate_private_requirement: "Private eligibility",
  flag_uncertain: "Flag uncertainty",
  get_application_context: "Application context",
  request_private_binding: "Passport binding",
  request_review: "Human review",
  set_public_fields: "Public fields",
};

function formatTimestamp(timestamp: string): string {
  return `${timestamp.slice(11, 19)} UTC`;
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatDate(value: string): string {
  if (!value) return "Not selected";

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function isStepComplete(
  step: WizardStep,
  application: RentalApplicationState,
): boolean {
  if (step === 1) {
    return application.fullName.trim().length > 1 && application.email.includes("@");
  }

  if (step === 2) {
    return (
      application.propertyAddress.trim().length > 3 &&
      application.monthlyRent > 0 &&
      application.moveInDate.length > 0
    );
  }

  return true;
}

function resultDescription(result: RequirementResult): string {
  switch (result) {
    case "satisfied":
      return "The private income check passed locally.";
    case "not_satisfied":
      return "The private income check did not pass locally.";
    default:
      return "Ask the connected agent to check private income eligibility.";
  }
}

function bindingStatusLabel(
  binding: RentalApplicationState["privateBindings"]["passport_number"],
  approvalPending: boolean,
): string {
  if (binding === "bound") return "Bound locally";
  if (approvalPending) return "Approval requested";
  return "Not connected";
}

export function SealedApplication() {
  const {
    application,
    currentStep,
    reviewState,
    uncertainTopics,
    activity,
    privacyTrace,
    lastToolResponse,
    pendingBindingApproval,
  } = useSyncExternalStore(
    sealedStore.subscribe,
    sealedStore.getSnapshot,
    sealedStore.getServerSnapshot,
  );
  const activeToolNames = getActiveSealedToolNames(
    sealedStore.getSnapshot(),
  );
  const activeToolSurfaceKey = activeToolNames.join("|");
  const toolsRef = useRef<SealedToolset | null>(null);
  const approvalDialogRef = useRef<HTMLDivElement>(null);
  const [webMcpStatus, setWebMcpStatus] = useState<WebMcpStatus>("checking");
  const [registeredToolCount, setRegisteredToolCount] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const showDeveloperControls = process.env.NODE_ENV === "development";

  useEffect(() => {
    let cancelled = false;
    const currentToolNames = getActiveSealedToolNames(
      sealedStore.getSnapshot(),
    );
    const vault = createMockPrivateVault();
    const tools = createSealedToolset({
      vault,
      store: sealedStore,
    });
    toolsRef.current = tools;
    queueMicrotask(() => {
      if (!cancelled) {
        setRegisteredToolCount(0);
        setWebMcpStatus("registering");
      }
    });

    const modelContext = document.modelContext;
    if (!modelContext) {
      queueMicrotask(() => {
        if (!cancelled) setWebMcpStatus("unsupported");
      });
      return () => {
        cancelled = true;
        toolsRef.current = null;
      };
    }

    const controller = new AbortController();

    registerSealedTools(
      modelContext,
      tools,
      controller.signal,
      currentToolNames,
    )
      .then(() => {
        if (!cancelled && !controller.signal.aborted) {
          setRegisteredToolCount(currentToolNames.length);
          setWebMcpStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRegisteredToolCount(0);
          setWebMcpStatus("error");
        }
      });

    return () => {
      cancelled = true;
      toolsRef.current = null;
      controller.abort();
    };
  }, [activeToolSurfaceKey]);

  useEffect(() => {
    if (!pendingBindingApproval) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      approvalDialogRef.current
        ?.querySelector<HTMLButtonElement>("[data-autofocus]")
        ?.focus();
    }, 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        sealedStore.resolvePrivateBindingApproval(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [pendingBindingApproval]);

  const handlePublicChange = <K extends PublicApplicationField>(
    field: K,
    value: RentalApplicationState[K],
  ) => {
    sealedStore.setPublicField(field, value);
    setStepError(null);
  };

  const runPrivateBinding = () => {
    const tool = toolsRef.current?.request_private_binding;
    if (!tool || pendingBindingApproval) return;

    void Promise.resolve(
      tool.execute({
        field: "passport_number",
      }),
    ).catch(() => undefined);
  };

  const runPrivateRequirement = () => {
    const tool = toolsRef.current?.evaluate_private_requirement;
    if (!tool) return;

    void Promise.resolve(
      tool.execute({
        requirement: "income_3x_rent",
      }),
    ).catch(() => undefined);
  };

  const moveToStep = (targetStep: WizardStep) => {
    if (targetStep <= currentStep) {
      sealedStore.setWizardStep(targetStep);
      setStepError(null);
      return;
    }

    if (!isStepComplete(currentStep, application)) {
      setStepError(
        currentStep === 1
          ? "Add your name and a valid email to continue."
          : "Complete the home details to continue.",
      );
      return;
    }

    setStepError(null);
    sealedStore.setWizardStep(targetStep);
  };

  const goNext = () => {
    if (currentStep < 3) moveToStep((currentStep + 1) as WizardStep);
  };

  const goBack = () => {
    if (currentStep > 1) moveToStep((currentStep - 1) as WizardStep);
  };

  const isPassportBound = application.privateBindings.passport_number === "bound";
  const isQualified = application.requirementResult === "satisfied";
  const isNotQualified = application.requirementResult === "not_satisfied";

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Sealed home">
          <span className="wordmark-mark" aria-hidden="true">
            <Icon name="shield" size={19} strokeWidth={2} />
          </span>
          <span>sealed</span>
        </a>
        <div className="topbar-meta">
          <span className="trust-pill">
            <Icon name="lock" size={13} /> Private by default
          </span>
          <span
            className={`mcp-status mcp-status-${webMcpStatus}`}
            data-testid="site-tools-status"
          >
            <span className="status-dot" aria-hidden="true" />
            <span className="mcp-status-label">
              {statusLabel(webMcpStatus, registeredToolCount)}
            </span>
          </span>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Secure rental application</p>
          <h1>
            Apply with
            <span>confidence.</span>
          </h1>
          <p className="hero-lede">
            Complete the details for your next home while private checks stay inside
            this page. The connected agent gets useful decisions, never the values
            behind them.
          </p>
        </div>
        <div className="hero-promise">
          <span className="hero-promise-icon">
            <Icon name="shield" size={22} />
          </span>
          <div>
            <p className="hero-promise-label">The Sealed promise</p>
            <p>
              Private values stay local. Only an approved status or decision can cross
              the WebMCP boundary.
            </p>
          </div>
        </div>
      </section>

      <section className="workspace-grid" aria-label="Rental application workspace">
        <form
          className="wizard-card"
          noValidate
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="wizard-card-header">
            <div>
              <p className="section-kicker">Rental application</p>
              <h2>Let&apos;s get your application started.</h2>
              <p className="card-lede">
                Three short steps. Public details stay editable; private fields stay
                sealed.
              </p>
            </div>
             <span className={`draft-badge${reviewState === "requested" ? " draft-badge-review" : ""}`}>
               <span className="draft-dot" aria-hidden="true" />
               {reviewState === "requested" ? "Review requested" : "Draft"}
             </span>
          </div>

          <nav className="stepper" aria-label="Application steps">
            {wizardSteps.map((step) => {
              const isCurrent = currentStep === step.id;
              const isComplete = step.id < currentStep;
              const isAvailable = step.id <= currentStep + 1;

              return (
                <button
                  className={`stepper-item${isCurrent ? " stepper-item-current" : ""}${isComplete ? " stepper-item-complete" : ""}`}
                  disabled={!isAvailable}
                  key={step.id}
                  onClick={() => moveToStep(step.id)}
                  type="button"
                  aria-current={isCurrent ? "step" : undefined}
                >
                  <span className="stepper-number">
                    {isComplete ? <Icon name="check" size={14} strokeWidth={2.2} /> : `0${step.id}`}
                  </span>
                  <span className="stepper-copy">
                    <strong>{step.label}</strong>
                    <span>{step.detail}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="step-content">
            {currentStep === 1 && (
              <section className="step-panel" aria-labelledby="step-one-title">
                <div className="step-panel-heading">
                  <span className="step-panel-icon">
                    <Icon name="user" size={20} />
                  </span>
                  <div>
                    <p className="step-index">Step 01</p>
                    <h3 id="step-one-title">Tell us about you</h3>
                    <p>We&apos;ll use these public details to identify your draft application.</p>
                  </div>
                </div>
                <div className="form-grid">
                  <label className="field field-wide" htmlFor="full-name">
                    <span>Full name</span>
                    <input
                      autoComplete="name"
                      id="full-name"
                      placeholder="e.g. Aylin Mammadova"
                      type="text"
                      value={application.fullName}
                      onChange={(event) =>
                        handlePublicChange("fullName", event.target.value)
                      }
                    />
                  </label>
                  <label className="field field-wide" htmlFor="email">
                    <span>Email address</span>
                    <input
                      autoComplete="email"
                      id="email"
                      placeholder="you@example.com"
                      type="email"
                      value={application.email}
                      onChange={(event) =>
                        handlePublicChange("email", event.target.value)
                      }
                    />
                    <small>We&apos;ll keep your contact details in this application draft.</small>
                  </label>
                </div>
              </section>
            )}

            {currentStep === 2 && (
              <section className="step-panel" aria-labelledby="step-two-title">
                <div className="step-panel-heading">
                  <span className="step-panel-icon">
                    <Icon name="home" size={20} />
                  </span>
                  <div>
                    <p className="step-index">Step 02</p>
                    <h3 id="step-two-title">Choose your next home</h3>
                    <p>Share the property details the application needs to assess.</p>
                  </div>
                </div>
                <div className="form-grid">
                  <label className="field field-wide" htmlFor="property-address">
                    <span>Property address</span>
                    <input
                      autoComplete="street-address"
                      id="property-address"
                      placeholder="Street, city"
                      type="text"
                      value={application.propertyAddress}
                      onChange={(event) =>
                        handlePublicChange("propertyAddress", event.target.value)
                      }
                    />
                  </label>
                  <label className="field" htmlFor="monthly-rent">
                    <span>Monthly rent</span>
                    <div className="input-with-prefix">
                      <span aria-hidden="true">$</span>
                      <input
                        id="monthly-rent"
                        inputMode="decimal"
                        min="0"
                        step="50"
                        type="number"
                        value={application.monthlyRent}
                        onChange={(event) =>
                          handlePublicChange(
                            "monthlyRent",
                            event.target.value === ""
                              ? 0
                              : Number(event.target.value),
                          )
                        }
                      />
                    </div>
                  </label>
                  <label className="field" htmlFor="move-in-date">
                    <span>Move-in date</span>
                    <div className="input-with-suffix">
                      <input
                        id="move-in-date"
                        type="date"
                        value={application.moveInDate}
                        onChange={(event) =>
                          handlePublicChange("moveInDate", event.target.value)
                        }
                      />
                      <Icon name="calendar" size={16} />
                    </div>
                  </label>
                </div>
                <div className="public-note">
                  <Icon name="shield" size={16} />
                  <span>These are public application details. Your income and passport number are never entered here.</span>
                </div>
              </section>
            )}

            {currentStep === 3 && (
              <section className="step-panel" aria-labelledby="step-three-title">
                <div className="step-panel-heading">
                  <span className="step-panel-icon">
                    <Icon name="file" size={20} />
                  </span>
                  <div>
                    <p className="step-index">Step 03</p>
                    <h3 id="step-three-title">Review before you finish</h3>
                    <p>Check the public summary, then ask for a private eligibility check.</p>
                  </div>
                </div>
                <div className="review-grid">
                  <div className="review-item">
                    <span>Applicant</span>
                    <strong>{application.fullName || "Not provided"}</strong>
                    <small>{application.email || "Add an email address"}</small>
                  </div>
                  <div className="review-item">
                    <span>Home</span>
                    <strong>{application.propertyAddress || "Not provided"}</strong>
                    <small>
                      {formatCurrency(application.monthlyRent)} / month · Move in {formatDate(application.moveInDate)}
                    </small>
                  </div>
                </div>
                 <div className={`review-callout${reviewState === "requested" ? " review-callout-requested" : ""}`}>
                   <span className="review-callout-icon">
                     <Icon name={reviewState === "requested" ? "check-circle" : "lock"} size={17} />
                   </span>
                   <div>
                     <strong>
                       {reviewState === "requested"
                         ? "Human review requested"
                         : "Private checks are ready"}
                     </strong>
                     <p>
                       {reviewState === "requested"
                         ? "Your draft is queued for a person to review. Nothing was submitted."
                         : "The agent can check eligibility without learning your income. Any passport binding still needs your approval."}
                     </p>
                   </div>
                 </div>
                 {uncertainTopics.length > 0 && (
                   <p className="uncertainty-note" data-testid="uncertainty-count">
                     <Icon name="warning" size={15} /> {uncertainTopics.length} topic{uncertainTopics.length === 1 ? "" : "s"} flagged for human attention.
                   </p>
                 )}
               </section>
            )}

            {stepError && (
              <p className="step-error" role="alert">
                <Icon name="warning" size={16} /> {stepError}
              </p>
            )}
          </div>

          <div className="wizard-footer">
            <p className="wizard-footnote">
              <Icon name="lock" size={14} /> No submission is made in this demo.
            </p>
            <div className="wizard-actions">
              {currentStep > 1 && (
                <button className="button button-quiet" onClick={goBack} type="button">
                  <Icon name="arrow-left" size={16} /> Back
                </button>
              )}
              {currentStep < 3 ? (
                <button className="button button-primary" onClick={goNext} type="button">
                  Continue <Icon name="arrow-right" size={16} />
                </button>
              ) : (
                <button
                  className="button button-quiet"
                  onClick={() => moveToStep(1)}
                  type="button"
                >
                  Edit application
                </button>
              )}
            </div>
          </div>
        </form>

        <aside className="trust-rail" aria-label="Privacy and WebMCP status">
          <section className="rail-card connection-card">
            <div className="rail-card-heading">
              <span className="rail-icon rail-icon-blue">
                <Icon name="activity" size={19} />
              </span>
              <div>
                <p className="section-kicker">WebMCP connection</p>
                <h2>Agent access</h2>
              </div>
            </div>
            <div className={`connection-status connection-status-${webMcpStatus}`}>
              <span className="connection-status-dot" aria-hidden="true" />
              <div>
                <strong>{statusLabel(webMcpStatus, registeredToolCount)}</strong>
                <span>
                  {webMcpStatus === "ready"
                    ? "Available to the connected agent"
                    : webMcpStatus === "unsupported"
                      ? "Open this page in a WebMCP-capable browser"
                      : "Checking the page connection"}
                </span>
              </div>
            </div>
             <div className="active-tools-summary" data-testid="active-tool-count">
               <span className="active-tools-number">{registeredToolCount}</span>
               <div>
                 <strong>Active site tools</strong>
                 <span>Changes with this application step</span>
               </div>
             </div>
             <div className="tool-surface" aria-label="Current site tool surface">
               <span className="tool-surface-label">Current surface</span>
               <div className="tool-surface-list">
                 {activeToolNames.map((toolName) => (
                   <span className="tool-chip" key={toolName}>
                     {toolLabels[toolName]}
                   </span>
                 ))}
               </div>
             </div>
             <div className="access-list">
              <div className="access-row access-row-allowed">
                <span><Icon name="check" size={14} /></span>
                <div>
                  <strong>Check private eligibility</strong>
                  <small>Decision only</small>
                </div>
              </div>
              <div className="access-row access-row-allowed">
                <span><Icon name="check" size={14} /></span>
                <div>
                  <strong>Request a sealed binding</strong>
                  <small>Human approval required</small>
                </div>
              </div>
              <div className="access-row access-row-blocked">
                <span><Icon name="close" size={14} /></span>
                <div>
                  <strong>Read raw private values</strong>
                  <small>Never available to the agent</small>
                </div>
              </div>
            </div>
          </section>

          <section
            className={`rail-card eligibility-card${isQualified ? " eligibility-card-qualified" : ""}${isNotQualified ? " eligibility-card-not-qualified" : ""}`}
            data-testid="eligibility-card"
          >
            <div className="eligibility-topline">
              <p className="section-kicker">Private requirement</p>
              <span className="eligibility-badge">
                <Icon name="lock" size={12} /> Local only
              </span>
            </div>
            <div className="eligibility-main">
              <div>
                <span className="result-label">Income requirement</span>
                <strong data-testid="income-requirement-result">
                  {requirementCopy[application.requirementResult]}
                </strong>
                <p>{resultDescription(application.requirementResult)}</p>
              </div>
              <span
                className={`result-icon result-${application.requirementResult}`}
                aria-label={requirementCopy[application.requirementResult]}
              >
                {isQualified ? (
                  <Icon name="check" size={22} strokeWidth={2.4} />
                ) : isNotQualified ? (
                  <Icon name="warning" size={20} />
                ) : (
                  <Icon name="activity" size={20} />
                )}
              </span>
            </div>
            <div className="income-boundary">
              <span>Actual income</span>
              <strong data-testid="actual-income-status">
                <Icon name="lock" size={13} /> Withheld from agent
              </strong>
            </div>
             <div className="agent-action-note">
               <span className="agent-action-note-icon"><Icon name="activity" size={16} /></span>
               <div>
                 <strong>Ask the connected agent to check</strong>
                 <span>It returns only a qualification decision.</span>
               </div>
             </div>
            <p className="eligibility-note">
              Uses the private <code>income_3x_rent</code> requirement. The value never
              enters the DOM or the tool response.
            </p>
            <div className="last-response">
              <div className="last-response-heading">
                <span>Last tool response</span>
                <span>Redacted</span>
              </div>
              <p data-testid="last-tool-response">{lastToolResponse}</p>
            </div>
          </section>

          <section className="rail-card sealed-card">
            <div className="rail-card-heading">
              <span className="rail-icon rail-icon-amber">
                <Icon name="lock" size={19} />
              </span>
              <div>
                <p className="section-kicker">Private field</p>
                <h2>Passport number</h2>
              </div>
              <span className={`field-status${isPassportBound ? " field-status-bound" : ""}`} data-testid="passport-binding-status">
                {bindingStatusLabel(
                  application.privateBindings.passport_number,
                  Boolean(pendingBindingApproval),
                )}
              </span>
            </div>
            <div className="sealed-field" aria-label="Passport number sealed; raw value withheld">
              <span className="sealed-field-icon"><Icon name="shield" size={18} /></span>
              <div>
                <strong>Value sealed</strong>
                <span>Stored locally · never rendered</span>
              </div>
              <span className="sealed-field-state">
                {isPassportBound ? "Bound" : "Approval needed"}
              </span>
            </div>
             <div className="agent-action-note agent-action-note-amber">
               <span className="agent-action-note-icon"><Icon name="lock" size={16} /></span>
               <div>
                 <strong>Agent can request a binding</strong>
                 <span>You approve it here before anything changes.</span>
               </div>
             </div>
            <p className="sealed-note">
              The agent can request this binding, but the page asks you first. The raw
              passport value is never placed in an input or sent across WebMCP.
            </p>
          </section>
        </aside>
      </section>

      <section className="observability-section" aria-labelledby="observability-title">
        <div className="observability-heading">
          <div>
            <p className="section-kicker">Proof, in plain sight</p>
            <h2 id="observability-title">See the boundary, not the secret.</h2>
          </div>
          <p className="observability-summary">
            Every private operation leaves a redacted trail so a human can verify what
            happened.
          </p>
        </div>

        <div className="observability-grid">
          <article className="trace-card" data-testid="webmcp-activity-panel">
            <div className="trace-card-heading">
              <div className="trace-title-group">
                <span className="trace-icon trace-icon-blue"><Icon name="activity" size={17} /></span>
                <div>
                  <p className="section-kicker">Agent-visible record</p>
                  <h3>WebMCP activity</h3>
                </div>
              </div>
              <span className="trace-count" data-testid="activity-count">
                {formatCount(activity.length, "call", "calls")}
              </span>
            </div>
             <p className="trace-intro">
               Every agent call is recorded with allowlisted inputs and redacted outputs.
            </p>

            {activity.length === 0 ? (
              <div className="trace-empty">
                <span className="empty-icon"><Icon name="activity" size={17} /></span>
                 <div>
                   <strong>No agent calls yet</strong>
                   <p>The next connected-agent action will appear here.</p>
                </div>
              </div>
            ) : (
              <div className="activity-list">
                {activity.map((entry) => (
                  <div className="activity-entry" data-testid="activity-entry" key={entry.id}>
                    <div className="activity-entry-top">
                      <div className="entry-tool-name">
                        <span className="entry-status-dot" aria-hidden="true" />
                        <code>{entry.toolName}</code>
                      </div>
                      <span>{formatTimestamp(entry.timestamp)}</span>
                    </div>
                    <span className="actor-chip">actor · {entry.actor}</span>
                    <div className="payload-row">
                      <span>Redacted input</span>
                      <code>{JSON.stringify(entry.redactedInput)}</code>
                    </div>
                    <div className="payload-row">
                      <span>Redacted output</span>
                      <code>{JSON.stringify(entry.redactedOutput)}</code>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="trace-card" data-testid="privacy-trace-panel">
            <div className="trace-card-heading">
              <div className="trace-title-group">
                <span className="trace-icon trace-icon-green"><Icon name="shield" size={17} /></span>
                <div>
                  <p className="section-kicker">Boundary evidence</p>
                  <h3>Privacy trace</h3>
                </div>
              </div>
              <span className="trace-count" data-testid="privacy-count">
                {formatCount(privacyTrace.length, "op", "ops")}
              </span>
            </div>
            <p className="trace-intro">
              A compact proof of what happened locally and what stayed private.
            </p>

            {privacyTrace.length === 0 ? (
              <div className="trace-empty">
                <span className="empty-icon empty-icon-green"><Icon name="shield" size={17} /></span>
                <div>
                  <strong>No private operation traced yet</strong>
                  <p>The next approved operation will create the first record.</p>
                </div>
              </div>
            ) : (
              <div className="privacy-list">
                {privacyTrace.map((entry) => (
                  <div className="privacy-entry" data-testid="privacy-entry" key={entry.id}>
                    <div className="activity-entry-top">
                      <div className="entry-tool-name">
                        <span className="entry-status-dot entry-status-dot-green" aria-hidden="true" />
                        <code>{entry.capability}</code>
                      </div>
                      <span>{formatTimestamp(entry.timestamp)}</span>
                    </div>
                    <div className="privacy-check-grid">
                      <div>
                        <span>Local vault access</span>
                        <strong className="trace-yes">{entry.localVaultAccess}</strong>
                      </div>
                      <div>
                        <span>DOM exposure</span>
                        <strong>{entry.domExposure}</strong>
                      </div>
                      <div>
                        <span>WebMCP input exposure</span>
                        <strong>{entry.webmcpInputExposure}</strong>
                      </div>
                      <div>
                        <span>WebMCP output exposure</span>
                        <strong>{entry.webmcpOutputExposure}</strong>
                      </div>
                    </div>
                    <div className="returned-result">
                      <span>Returned result</span>
                      <strong>{entry.returnedResult}</strong>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>
      </section>

      {showDeveloperControls && (
        <details className="developer-controls" data-testid="debug-controls">
          <summary>Developer controls</summary>
          <p>
            Local-only controls for testing the exact registered handlers. They use the
            same domain/store path as a real agent call.
          </p>
          <div className="developer-controls-actions">
            <button className="button button-quiet" onClick={runPrivateBinding} type="button">
              Run binding handler
            </button>
            <button className="button button-quiet" onClick={runPrivateRequirement} type="button">
              Run requirement handler
            </button>
          </div>
        </details>
      )}

      <footer className="page-footer">
        <span className="footer-brand"><span className="footer-mark"><Icon name="shield" size={13} /></span> Sealed</span>
        <span>Local vault · no backend · no submission</span>
        <span>Raw private values remain withheld.</span>
      </footer>

      {pendingBindingApproval && (
        <div className="modal-backdrop" role="presentation">
          <div
            aria-describedby="approval-dialog-description"
            aria-labelledby="approval-dialog-title"
            aria-modal="true"
            className="approval-dialog"
            ref={approvalDialogRef}
            role="dialog"
          >
            <div className="approval-dialog-header">
              <span className="approval-dialog-icon"><Icon name="lock" size={22} /></span>
              <button
                aria-label="Close approval dialog"
                className="icon-button"
                onClick={() => sealedStore.resolvePrivateBindingApproval(false)}
                type="button"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <p className="section-kicker">Human approval required</p>
            <h2 id="approval-dialog-title">Bind your passport number?</h2>
            <p id="approval-dialog-description" className="approval-dialog-copy">
              The connected agent requested a local binding for your passport number.
              Sealed will keep the value on this page and return only a bound status.
            </p>
            <div className="approval-dialog-proof">
              <div><Icon name="check" size={15} /> Stays inside the local page</div>
              <div><Icon name="check" size={15} /> Never placed in a rendered input</div>
              <div><Icon name="check" size={15} /> Agent receives no raw value</div>
            </div>
            <div className="approval-dialog-actions">
              <button
                className="button button-quiet"
                onClick={() => sealedStore.resolvePrivateBindingApproval(false)}
                type="button"
              >
                Not now
              </button>
              <button
                className="button button-primary"
                data-autofocus
                onClick={() => sealedStore.resolvePrivateBindingApproval(true)}
                type="button"
              >
                Approve binding <Icon name="check" size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
