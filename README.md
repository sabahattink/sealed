# Sealed

> **The agent gets the decision — not the secret.**

Sealed is a reusable WebMCP privacy boundary for agentic web applications.
It lets an AI agent evaluate private information, request human-approved local
bindings, and advance a workflow without receiving the underlying raw values.

The page owns the private context and exposes only narrow, state-aware
capabilities. Guarded egress allows safe decisions and opaque references to
cross the WebMCP boundary while raw private values remain withheld.

**Live demo:** https://sealed-ten-chi.vercel.app

## Why WebMCP?

Sealed is not an autofill demo with a privacy label.

A conventional agent integration often moves sensitive context into the agent,
an extension, or a remote service before the agent can act on it. Sealed
reverses that model: the page already holds the private context, so the page
exposes narrowly scoped operations instead of the secret itself.

```text
private value
    ↓
page-local operation
    ↓
guarded WebMCP egress
    ↓
safe decision / opaque reference
    ↓
agent
```

WebMCP is therefore load-bearing in Sealed. The page owns the tool runtime,
human approval happens in the same browser session, and the active tool surface
changes with workflow state. The tool surface is part of the authorization
model, not just a transport layer.

## Two scenarios, one privacy primitive

Sealed intentionally ships with two small workflows that reuse the same privacy
architecture:

- **Rental application — primary demo:** a fixed private `income_3x_rent`
  predicate plus a human-approved passport binding.
- **Membership enrollment — reuse example:** a fixed private `age_18_plus`
  predicate plus a human-approved identity binding.

The second scenario exists to show that the mechanism is reusable rather than
hardcoded to rental screening.

## WebMCP tool surface

The page registers six state-aware tools through `document.modelContext`:

- `get_application_context` — read the active workflow context with private
  values redacted.
- `set_public_fields` — update only allowlisted public fields.
- `flag_uncertain` — record a fixed topic for human attention.
- `evaluate_private_requirement` — evaluate the active private predicate
  locally and return only the decision.
- `request_private_binding` — request a local private binding that requires
  explicit human approval.
- `request_review` — move the workflow to human review without submitting it.

There is deliberately **no submit or enrollment tool**.

The registered surface changes with workflow state:

| Workflow state | Available capabilities |
| --- | --- |
| Step 1 | context, public fields, uncertainty, binding, predicate |
| Step 2 | Step 1 plus review |
| Step 3 | context, uncertainty, review, binding, predicate |
| Review requested | context and uncertainty only |

An `AbortController` retires the previous registration surface when state
changes. Handlers also validate the active scenario, demo session, workflow
step, review state, and current surface again at execution time so stale
handlers fail closed.

## Fixed predicates and anti-probing

Private predicates are not arbitrary threshold or query APIs.
`evaluate_private_requirement` accepts only the active scenario's fixed
requirement enum.

Each demo session allows one private evaluation. On first evaluation, the
public dependencies used by the predicate are snapshotted; for the rental
scenario, `monthly_rent` is then locked for that session. Duplicate evaluation,
old handlers, and handlers from another scenario fail sealed.

`Reset demo` starts a new demo session with a new session-local private context.
There is no agent-facing reset capability.

## Human-approved opaque binding

`request_private_binding` does not immediately mutate the workflow. It opens a
page-owned approval dialog and waits for an explicit human decision.

Before approval, no binding artifact exists. After approval, the private
credential is consumed locally to create an opaque, session-bound binding
artifact. The agent receives only safe metadata such as:

```json
{
  "status": "bound",
  "value": "withheld",
  "binding_ref": "opaque-session-reference"
}
```

The raw credential is not returned.

The binding has a real downstream consequence: `request_review` requires both
a private predicate verdict and an approved binding artifact. It consumes only
their safe local metadata to create a review packet and always returns
`submitted: false`.

Nothing is sent to a landlord, membership provider, verifier, or backend.

## Guarded egress and Boundary Ledger

All successful WebMCP responses pass through one guarded-egress chokepoint.
The guard checks `content`, `structuredContent`, tool metadata, and sanitized
error paths for the current session's raw private values and fails closed if a
raw value would cross the boundary.

The UI's **Boundary Ledger** makes the otherwise invisible privacy behavior
visible by showing the sanitized payload released by private operations:

```text
local private value → guarded WebMCP boundary → agent-visible safe result
```

The ledger is an application-level audit surface, not an independent browser
transport attestation and not a cryptographic proof.

## Architecture

- **Next.js 16 + React 19** client application.
- **WebMCP:** state-aware tools registered with `document.modelContext`.
- **Declarative scenarios:** public-field allowlists, fixed private predicates,
  private bindings, sections, and uncertainty topics are scenario-defined.
- **Shared external store/reducer:** the human UI and WebMCP handlers operate on
  the same workflow state.
- **Session-local demo private context:** demo values are generated in browser
  memory for each session; production source does not ship fixed private
  canary values.
- **Guarded egress:** one central boundary checks agent-visible results and
  sanitizes error paths.
- **Boundary Ledger + Activity:** show the safe operations and agent calls used
  during the demo.

## Threat model and limitations

Sealed demonstrates **selective disclosure and page-local private execution**.
Its goal is to prevent raw private values from entering agent-visible WebMCP
payloads and the demo's agent-facing activity paths.

It also reduces a simple repeated-query inference attack by using fixed,
one-shot, session-bound predicates and locking their public dependencies after
evaluation.

Sealed does **not** claim to protect against:

- malicious JavaScript executing on the page,
- browser extensions, DevTools, direct profile access, or page-memory access,
- compromised dependencies,
- transformed or semantic information-flow leakage in the general case,
- cryptographic verification, zero-knowledge proofs, TEEs, attestation, or
  hardware isolation,
- identity assurance, landlord/verifier trust, or signed eligibility evidence.

This is a hackathon prototype, not a production secret vault or real eligibility
system. It has no backend, authentication, database, multi-user isolation, real
credential provider, or submission flow.

## Run locally

Requirements: a current Node.js installation and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

No environment variables are required.

### Verification

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## ChatGPT Desktop demo

Open the production URL inside a WebMCP-capable ChatGPT Desktop built-in browser
and confirm **Site tools ready**.

### Rental — primary flow

1. Ask the agent to read the current workflow context.
2. Ask it to set the public name and email fields.
3. Move to the rental-details step.
4. Ask it to evaluate `income_3x_rent` without revealing income.
5. Confirm the returned result is a decision with the raw value withheld.
6. Ask it to request the `passport_number` binding.
7. Approve the page-owned human approval dialog.
8. Request human review.
9. Confirm the review packet says `submitted: false` and the registered tool
   surface reduces to two safe tools.

### Membership — reuse flow

1. Click **Reset demo** and switch to **Membership**.
2. Ask the agent to evaluate `age_18_plus` without revealing date of birth.
3. Request the `identity_number` binding and approve it on the page.
4. Request review and confirm the same guarded-egress, opaque-binding, and
   post-review tool-reduction behavior.

## What to watch in the demo

These are the judge-facing moments that demonstrate the architecture:

1. **Public work is ordinary:** the agent can safely update public workflow
   fields through an allowlist.
2. **The private predicate is different from autofill:** the raw income or date
   of birth never has to become an agent-visible field; the agent gets only the
   decision.
3. **Human approval is inside the tool execution path:** a sensitive binding
   pauses until the person approves it in the page.
4. **The binding is consequential:** the opaque local artifact is required
   before review can continue.
5. **The Boundary Ledger shows guarded egress:** safe payloads are visible while
   the raw value remains withheld.
6. **Capabilities shrink with state:** after review, the surface becomes two
   safe tools.
7. **The agent cannot finish the irreversible action:** no submit/enroll tool is
   ever registered.

## License

MIT — see [`LICENSE`](./LICENSE).
