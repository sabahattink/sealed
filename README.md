# Sealed

Sealed is a reusable privacy boundary for agentic web applications, built for
the OpenAI WebMCP Challenge. It demonstrates that an agent can use a private
value to reach an approved decision or binding without receiving the raw value.
Two small workflows use the same six WebMCP capabilities and shared store:

- **Rental application (primary demo):** private income eligibility and an
  approved passport binding.
- **Membership enrollment:** private adult-age verification and an approved
  identity binding.

**Production demo:** [https://sealed-ten-chi.vercel.app](https://sealed-ten-chi.vercel.app)

## Core WebMCP insight

The page owns a small local mock vault. WebMCP gives the agent narrow,
state-aware capabilities over that page:

- `evaluate_private_requirement` executes the active scenario's declarative
  predicate locally and returns only `satisfied` or `not_satisfied`, with the
  underlying value marked `withheld`.
- `request_private_binding` asks the user to approve the active scenario's
  local binding and returns only `bound`; the private identifier is never
  returned.

WebMCP is essential because the agent calls capabilities implemented by the
page that already holds the private context. A normal chat or form integration
would need the value to cross into the agent's context. Sealed instead exposes
the operation and its safe result, not the secret.

## Human approval boundary

A private binding does not change state immediately. The agent can request it,
but the page opens a human approval dialog. Only **Approve binding** completes
the local operation. Moving either workflow to human review is deliberately not
submission: `request_review` returns `submitted: false`, and there is no submit
or enrollment tool.

## Dynamic tool surface

The registered tool set follows the application state, reducing accidental or
irrelevant actions:

| State (both scenarios) | Available tools |
| --- | --- |
| Step 1 — public profile | context, public fields, uncertainty, private binding, private predicate |
| Step 2 — workflow details | Step 1 tools plus human review |
| Step 3 — review | context, uncertainty, human review, private binding, private predicate |
| Review requested | context and uncertainty only |

Current tool names:

- `get_application_context` — reads the active scenario, public draft data, requirements, open
  questions, and redacted private statuses.
- `set_public_fields` — updates allowlisted public fields only.
- `flag_uncertain` — records a fixed topic for human attention.
- `request_review` — moves the draft to human review without submitting it.
- `request_private_binding` — requests the active declarative private binding.
- `evaluate_private_requirement` — evaluates the active declarative predicate
  locally and returns only the decision.

## Architecture

- Next.js 16 and React 19 client application.
- `document.modelContext` registers the active WebMCP tools; an
  `AbortController` removes the previous surface when state changes.
- Declarative scenario definitions provide public-field allowlists, sections,
  private predicates, private bindings, and uncertainty topics.
- One external store and reducer back the human UI, WebMCP handlers, activity
  log, privacy trace, and last safe tool response.
- A client-side mock vault supplies demo-only private values to both scenarios.
- WebMCP Activity records redacted agent calls; Privacy Trace records private
  operations and whether values crossed the DOM or WebMCP boundary.

## Privacy invariants

- Raw income, birth date, passport, and identity values never appear in tool
  inputs or outputs.
- Raw private values are not rendered into the page or HTML inputs.
- `set_public_fields` rejects private or sealed fields.
- Private predicates return only a decision.
- Private bindings require human approval and return only status.
- Review never submits or sends an application.

These invariants are covered by automated tests, but this remains a browser
prototype rather than a production security boundary. Sealed demonstrates
**selective disclosure and local private execution**; it is not cryptographic
zero-knowledge, and the bundled client-side fixtures are inspectable by a user
with developer access.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. No environment variables are required.

Verification commands:

```bash
npm test
npm run lint
npm run build
```

## Test with ChatGPT Desktop

1. Open the ChatGPT Desktop built-in browser.
2. Navigate to https://sealed-ten-chi.vercel.app and confirm that the page shows
   **Site tools ready**.
3. Keep **Rental** selected. Ask: `Use get_application_context and tell me which public fields are missing.`
4. Ask: `Use set_public_fields to set full name to "Aylin Mammadova" and email to "aylin@example.com".`
5. Continue to the property step, then ask:
   `Use evaluate_private_requirement to check income_3x_rent without revealing income.`
6. Ask: `Use request_private_binding for passport_number without revealing the raw value.`
   Approve the page's binding dialog.
7. Continue to review and ask:
   `Use request_review. Do not submit or send the application.`
8. Confirm the WebMCP Activity entries, two private Privacy Trace operations,
   `submitted: false`, and the two-tool post-review surface.
9. Click **Reset demo**, switch to **Membership**, and ask:
   `Check age_18_plus without revealing my date of birth, then request the identity_number binding.`
10. Approve the binding and confirm the same Activity, Privacy Trace, withheld
    responses, and dynamic tool behavior in the second workflow.

## Prototype scope

Sealed is a hackathon demo, not real rental screening, identity verification,
age assurance, a production secret vault, or an eligibility decision system. It has no backend,
authentication, real credential storage, landlord integration, or submission
flow. The bundled private values are inspectable demo fixtures and must not be
treated as production secrets.
