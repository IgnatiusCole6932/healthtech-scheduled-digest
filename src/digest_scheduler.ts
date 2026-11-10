import { z } from "zod";

const appointmentStates = z.enum(["confirmed", "needs_follow_up", "cancelled"]);

export const digestRequestSchema = z.object({
  recipient: z.string().email(),
  clinicName: z.string().min(1).max(80),
  cronExpr: z.string().min(1),
  appointments: z.array(z.object({ state: appointmentStates })).min(1)
});

export type DigestRequest = z.infer<typeof digestRequestSchema>;

export function summarizeAppointments(appointments: DigestRequest["appointments"]) {
  return appointments.reduce(
    (summary, appointment) => {
      summary[appointment.state] += 1;
      return summary;
    },
    { confirmed: 0, needs_follow_up: 0, cancelled: 0 }
  );
}

export function composeDigest(input: DigestRequest) {
  const summary = summarizeAppointments(input.appointments);
  return {
    subject: `${input.clinicName}: appointment operations digest`,
    text: [
      "Patient-safe appointment operations summary",
      `Confirmed appointments: ${summary.confirmed}`,
      `Appointments needing follow-up: ${summary.needs_follow_up}`,
      `Cancelled appointments: ${summary.cancelled}`
    ].join("\n")
  };
}

export function callbackUrl(publicUrl: string, input: DigestRequest) {
  const summary = summarizeAppointments(input.appointments);
  const url = new URL("/scheduled-digest", publicUrl);
  url.searchParams.set("recipient", input.recipient);
  url.searchParams.set("clinicName", input.clinicName);
  url.searchParams.set("confirmed", String(summary.confirmed));
  url.searchParams.set("needsFollowUp", String(summary.needs_follow_up));
  url.searchParams.set("cancelled", String(summary.cancelled));
  return url.toString();
}
