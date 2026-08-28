# Sealed

Sealed is a focused rental application demo for the OpenAI WebMCP Challenge. It
demonstrates a narrow contract:

> The page may use private data to complete an approved operation, while the
> agent receives only a safe decision or status.

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

Useful checks:

```bash
npm test
npm run lint
npm run build
```

## Deploy to Vercel

This is a standard Next.js app and does not require environment variables for
the demo. From this directory, authenticate with Vercel and create a preview
deployment:

```bash
npx vercel login
npx vercel --yes
```

Use `npx vercel --yes --prod` only when a production deployment is intended.

## WebMCP proof

The client component feature-detects `document.modelContext` and registers a
step-aware tool surface through the current imperative API:

- `get_application_context`: reads the current public draft, fixed section
  requirements, open question IDs, and redacted private statuses in one response.
- `set_public_fields`: updates only public application fields.
- `flag_uncertain`: records one fixed topic for human attention.
- `request_review`: moves the draft to human review; it never submits anything.

- `request_private_binding`: asks for human approval, marks the passport field as
  locally bound, and returns `value: "withheld"`.
- `evaluate_private_requirement`: compares private monthly income with the
  public monthly rent and returns only `satisfied` or `not_satisfied`.

Step 1 keeps the two validated private tools available for the real ChatGPT
demo, Step 2 adds `request_review`, and Step 3 removes public-field mutation
while keeping the private checks available. After `request_review`, only the
context read and uncertainty flag remain. The active surface never exceeds six
tools. Each surface is owned by a fresh `AbortController`; aborting the previous
signal removes the old registrations before the current surface is exposed.

Browsers without WebMCP support show that status in the header. The user-facing
private cards explain the agent-first flow; a private passport binding opens the
same human approval modal before the shared state changes. Developer-only
handler controls are available only in development mode.

The application is presented as a three-step rental wizard. The Agent access
card shows the active site-tool count and current surface, while the WebMCP
Activity panel records every agent call with redacted input/output. The Privacy
Trace panel records only private operations.

The application state, activity log, privacy trace, and last tool response live
in one external store (`lib/sealed-store.ts`). Both the developer debug controls
and the native WebMCP `execute` handlers dispatch through that same reducer, so
a real agent call updates the visible page without a refresh.

## Privacy invariant

The tests verify that the mock vault values do not appear in:

- tool inputs or structured/text tool outputs;
- rendered page text;
- HTML input values.

The vault is intentionally a client-side mock for a hackathon demo. It is not
a production secret store: anyone with browser developer tools can inspect the
demo bundle. A production version would replace it with a browser-managed
credential/vault boundary and explicit user approval.

## Deliberate MVP boundary

There is no backend, LLM integration, application submission, authentication,
or real vault. The page models one rental application template, exposes six
allowlisted tools through a dynamic surface, and deliberately has no
`submit_application` tool.
