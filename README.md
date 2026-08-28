# Sealed

Sealed is a privacy-boundary demo for the OpenAI WebMCP Challenge. It shows how
an agent can use a private value through a narrow page-owned capability while
the raw value is withheld from agent-visible WebMCP payloads.

- **Rental:** fixed private `income_3x_rent` predicate and approved passport binding.
- **Membership:** fixed private `age_18_plus` predicate and approved identity binding.

Production demo: [sealed-ten-chi.vercel.app](https://sealed-ten-chi.vercel.app)

## Privacy architecture

The page registers six state-aware tools with `document.modelContext`, the
WebMCP surface available in compatible builds of ChatGPT Desktop. An
`AbortController` retires the previous registration surface when workflow state
changes, while every handler also validates the active scenario and demo
session at execution time.

All successful tool responses pass through one guarded-egress chokepoint. It
checks both `content` and `structuredContent` for the session's raw private
values and fails closed. Errors are reduced to an allowlisted message or a
generic boundary error. Tool schemas and descriptions are checked as well.

The UI's **Boundary Ledger** displays the actual sanitized payload released by
each private operation:

`local private value → guarded WebMCP boundary → agent-visible safe result`

This is selective disclosure through application architecture, not a claim of
cryptographic proof.

## Fixed predicates and anti-probing

`evaluate_private_requirement` accepts only the active fixed enum. Each demo
session permits one evaluation. On first use, public predicate dependencies are
snapshotted; rental's `monthly_rent` is then immutable. Duplicate evaluation,
old handlers, and handlers from a previous scenario fail sealed. **Reset demo**
starts a fresh session and evaluation budget.

## Consequential local binding

`request_private_binding` opens a human approval dialog. Before approval there
is no artifact. After approval, the raw credential is consumed locally with a
random salt and nonce to create an opaque, session-bound binding artifact. The
agent receives only `bound`, `value: withheld`, and a non-secret reference.

`request_review` requires both that artifact and the private predicate verdict.
It consumes their safe local metadata to create a review packet with
`submitted: false`. It does not submit, send, enroll, or contact a verifier.
There is no submit/enroll tool. After review, only context and uncertainty tools
remain registered.

## Tool surface

| Workflow state | Tools |
| --- | --- |
| Step 1 | context, public fields, uncertainty, binding, predicate |
| Step 2 | Step 1 plus review |
| Step 3 | context, uncertainty, review, binding, predicate |
| Review requested | context and uncertainty only |

Tool names: `get_application_context`, `set_public_fields`, `flag_uncertain`,
`request_review`, `request_private_binding`, and
`evaluate_private_requirement`.

## Threat model and limitations

This demo protects against raw private values entering agent-visible WebMCP
tool payloads and the demo's redacted activity/ledger paths. It also limits a
simple predicate-probing attack by fixing the predicate and allowing one
session-bound evaluation.

It does **not** protect against malicious page JavaScript, browser developer
tools, direct browser/profile access, compromised dependencies, or a user who
can inspect page memory. It provides no cryptographic verification, zero-
knowledge proof, TEE, attestation, identity assurance, landlord/verifier trust,
or production vault guarantee. There is no backend, authentication, database,
multi-user isolation, or real submission workflow. Demo private values are
generated in browser memory for each session and must not be treated as real
credentials.

## Local verification

```bash
npm install
npm test
npm run lint
npm run typecheck
npm run build
```

Open `http://localhost:3000` after `npm run dev`.

## ChatGPT Desktop demo

1. Open the production URL in the ChatGPT Desktop built-in browser and confirm
   **Site tools ready**.
2. In Rental, set public name/email, evaluate `income_3x_rent`, request the
   passport binding, and approve it in the page.
3. Move to Step 2 or Step 3 and call `request_review`. Confirm the returned
   review packet says `submitted: false` and the surface becomes two tools.
4. Confirm the Boundary Ledger shows the guarded predicate and binding payloads.
5. Reset, switch to Membership, and repeat with `age_18_plus` and
   `identity_number`.
6. Confirm reset/session invalidation and a clean browser console.
