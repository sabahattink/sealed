# Sealed

Sealed is a rental-application prototype built for the OpenAI WebMCP Challenge.
It demonstrates a privacy boundary in which an agent can use a private value to
reach an approved decision or binding without receiving the raw value itself.

**Production demo:** [https://sealed-ten-chi.vercel.app](https://sealed-ten-chi.vercel.app)

## Core WebMCP insight

The page owns a small local mock vault. WebMCP gives the agent narrow,
state-aware capabilities over that page:

- `evaluate_private_requirement` compares private income with public rent and
  returns only `satisfied` or `not_satisfied`; income is returned as `withheld`.
- `request_private_binding` asks the user to approve a local passport binding
  and returns only `bound`; the passport number is never returned.

WebMCP is essential because the agent calls capabilities implemented by the
page that already holds the private context. A normal chat or form integration
would need the value to cross into the agent's context. Sealed instead exposes
the operation and its safe result, not the secret.

## Human approval boundary

A passport binding does not change state immediately. The agent can request it,
but the page opens a human approval dialog. Only **Approve binding** completes
the local operation. Moving the draft to human review is also deliberately not
submission: `request_review` returns `submitted: false`, and there is no
`submit_application` tool.

## Dynamic tool surface

The registered tool set follows the application state, reducing accidental or
irrelevant actions:

| State | Available tools |
| --- | --- |
| Step 1 — applicant | context, public fields, uncertainty, passport binding, private eligibility |
| Step 2 — property | Step 1 tools plus human review |
| Step 3 — review | context, uncertainty, human review, passport binding, private eligibility |
| Review requested | context and uncertainty only |

Current tool names:

- `get_application_context` — reads public draft data, requirements, open
  questions, and redacted private statuses.
- `set_public_fields` — updates allowlisted public fields only.
- `flag_uncertain` — records a fixed topic for human attention.
- `request_review` — moves the draft to human review without submitting it.
- `request_private_binding` — requests an approved local passport binding.
- `evaluate_private_requirement` — evaluates income eligibility locally and
  returns only the decision.

## Architecture

- Next.js 16 and React 19 client application.
- `document.modelContext` registers the active WebMCP tools; an
  `AbortController` removes the previous surface when state changes.
- One external store and reducer back the human UI, WebMCP handlers, activity
  log, privacy trace, and last safe tool response.
- A client-side mock vault supplies demo-only private values.
- WebMCP Activity records redacted agent calls; Privacy Trace records private
  operations and whether values crossed the DOM or WebMCP boundary.

## Privacy invariants

- Raw income and passport values never appear in tool inputs or outputs.
- Raw private values are not rendered into the page or HTML inputs.
- `set_public_fields` rejects private or sealed fields.
- Private eligibility returns only a decision.
- Passport binding requires human approval and returns only status.
- Review never submits or sends an application.

These invariants are covered by automated tests, but this remains a browser
prototype rather than a production security boundary.

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
3. Ask: `Use get_application_context and tell me which public fields are missing.`
4. Ask: `Use set_public_fields to set full name to "Aylin Mammadova" and email to "aylin@example.com".`
5. Continue to the property step, then ask:
   `Use evaluate_private_requirement to check income_3x_rent without revealing income.`
6. Ask: `Use request_private_binding for passport_number without revealing the raw value.`
   Approve the page's binding dialog.
7. Continue to review and ask:
   `Use request_review. Do not submit or send the application.`
8. Confirm the WebMCP Activity entries, two private Privacy Trace operations,
   `submitted: false`, and the two-tool post-review surface.

## Prototype scope

Sealed is a hackathon demo, not real rental screening, a production secret
vault, or a system for making housing decisions. It has no backend,
authentication, real credential storage, landlord integration, or submission
flow. The bundled private values are inspectable demo fixtures and must not be
treated as production secrets.
