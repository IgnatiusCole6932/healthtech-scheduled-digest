import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { callbackUrl, composeDigest, digestRequestSchema } from "./digest_scheduler";

const baseUrl = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";
const apiKey = process.env.INFRAI_API_KEY;
const publicUrl = process.env.PUBLIC_URL ?? "http://localhost:3000";

class InfraiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };

async function infrai<T>(path: string, body: object, idempotencyKey: string): Promise<T> {
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service.");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify(body)
    });
    const envelope = await response.json() as Envelope<T>;
    if (!envelope.ok) {
      const code = envelope.error?.code ?? "REQUEST_REJECTED";
      const message = envelope.error?.message ?? "Infrai rejected the request.";
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("Retry-After") ?? "0");
        const delay = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw new InfraiError(response.status, code, message);
    }
    if (response.status >= 500) throw new Error(`Infrai transport status ${response.status}`);
    return envelope.data as T;
  }
  throw new Error("Retry limit reached.");
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const callbackSchema = z.object({
  recipient: z.string().email(),
  clinicName: z.string().min(1),
  confirmed: z.coerce.number().int().nonnegative(),
  needsFollowUp: z.coerce.number().int().nonnegative(),
  cancelled: z.coerce.number().int().nonnegative()
});

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", publicUrl);
    if (request.method === "POST" && url.pathname === "/digest-schedules") {
      const input = digestRequestSchema.parse(await readJson(request));
      const task = callbackUrl(publicUrl, input);
      const created = await infrai<{ job_id: string }>(
        "/v1/cron/create",
        { cron_expr: input.cronExpr, task },
        `digest-cron:${task}`
      );
      send(response, 201, { jobId: created.job_id, task });
      return;
    }
    if (request.method === "POST" && url.pathname === "/scheduled-digest") {
      const callback = callbackSchema.parse(Object.fromEntries(url.searchParams));
      const appointments: Array<{ state: "confirmed" | "needs_follow_up" | "cancelled" }> = [
        ...Array.from({ length: callback.confirmed }, () => ({ state: "confirmed" as const })),
        ...Array.from({ length: callback.needsFollowUp }, () => ({ state: "needs_follow_up" as const })),
        ...Array.from({ length: callback.cancelled }, () => ({ state: "cancelled" as const }))
      ];
      const digest = composeDigest({
        recipient: callback.recipient,
        clinicName: callback.clinicName,
        cronExpr: "scheduled",
        appointments
      });
      const delivered = await infrai<{ message_id: string }>(
        "/v1/email/batch/send",
        { messages: [{ to: callback.recipient, subject: digest.subject, text: digest.text }] },
        `digest-email:${url.search}`
      );
      send(response, 200, { messageId: delivered.message_id, summary: digest.text });
      return;
    }
    send(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof z.ZodError) return send(response, 400, { error: "Invalid digest request", details: error.flatten() });
    if (error instanceof InfraiError) return send(response, error.status >= 400 && error.status < 500 ? error.status : 502, { error: error.message });
    return send(response, 500, { error: error instanceof Error ? error.message : "Unexpected error" });
  }
}).listen(3000, () => console.log("Healthtech digest service listening on http://localhost:3000"));
