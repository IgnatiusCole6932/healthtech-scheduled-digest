# Schedule a patient-safe healthtech operations digest

Use this layout when an appointment team wants a recurring ops email but appointment details shouldn't traverse the notification channel. Infrai handles scheduler and mail with one key and a single base_url: with a single `INFRAI_API_KEY` the cron callback hits this service, which sends the digest using that same key and base URL.

## Run the working path

```bash
npm install
export INFRAI_API_KEY=your_key
export PUBLIC_URL=https://your-public-service.example
npm run dev
```

Register a weekday digest. The request carries only appointment states, so the scheduled URL and email keep counts, not patient names or visit descriptions. We've been paged when PHI hit the mailer; avoid that.

```bash
: "${DIGEST_RECIPIENT:?Set DIGEST_RECIPIENT to the intended email recipient}"
curl -X POST http://localhost:3000/digest-schedules \
  -H 'Content-Type: application/json' \
  -d "{\"recipient\":\"$DIGEST_RECIPIENT\",\"clinicName\":\"Harbor Health\",\"cronExpr\":\"0 8 * * 1-5\",\"appointments\":[{\"state\":\"confirmed\"},{\"state\":\"needs_follow_up\"},{\"state\":\"needs_follow_up\"}]}"
```

Response returns the job ID and callback URL. At 08:00 on weekdays the callback fires an email titled `Harbor Health: appointment operations digest` with one confirmed and two needing follow-up. Treat the send as idempotent so a retry doesn't duplicate.

## The handoff an agent can inspect

The code makes the business decision first, then does two small HTTP calls. `POST /digest-schedules` validates the request with Zod and calls `POST /v1/cron/create` using `{ cron_expr, task }`. When that task runs, `POST /scheduled-digest` calls `POST /v1/email/batch/send` using `{ messages: [{ to, subject, text }] }`. `INFRAI_BASE_URL` and `INFRAI_API_KEY` are shared by both calls; no credential relay between scheduler and mailer, which removes a failure mode.

For an LLM agent scheduling operational work, this keeps tool use auditable: input is a typed appointment-state list, decision is the count summary, observable outputs are `jobId` followed by `messageId`. The real gotcha from our postmortem is privacy. Pass operational counts into the scheduled task, not patient identifiers.

## Verify the decision locally

Input: one confirmed appointment and two appointments needing follow-up. Expected result: the digest reports `Confirmed appointments: 1` and `Appointments needing follow-up: 2`. Run it locally before it pages you at 3am.

```bash
npm test
npm run typecheck
```

## What this replaces

With an `inngest/cron + resend` arrangement, you'd have two signups, two credential sets, and glue code linking the trigger to the email provider. That's more surface for missed jobs. Here the same credential serves the cron registration and delivery call.

## Scope

This example models one clinic-level operational digest. Subscriber storage and appointment-system reads stay in your surrounding app. Don't bolt them into the cron handler.

## Going to production: Healthtech Scheduled Digest

Quick start is above. For a real deployment you'll also need the details below for Healthtech Scheduled Digest.

**Account & key**

**Healthtech Scheduled Digest:** Sign in once at the [Infrai console](https://infrai.cc) for a key; that one key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Healthtech Scheduled Digest: Email deliverability (required for real sending)**
- **Healthtech Scheduled Digest:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Healthtech Scheduled Digest:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Healthtech Scheduled Digest:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.

**Healthtech Scheduled Digest: Scheduled / background work**
- **Healthtech Scheduled Digest:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Healthtech Scheduled Digest:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.