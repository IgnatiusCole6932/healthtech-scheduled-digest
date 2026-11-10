import assert from "node:assert/strict";
import test from "node:test";
import { composeDigest } from "../src/digest_scheduler";

test("digest separates appointments requiring action from confirmed operations", () => {
  const digest = composeDigest({
    recipient: "operations@clinic.example",
    clinicName: "Harbor Health",
    cronExpr: "0 8 * * 1-5",
    appointments: [{ state: "confirmed" }, { state: "needs_follow_up" }, { state: "needs_follow_up" }]
  });
  assert.equal(digest.subject, "Harbor Health: appointment operations digest");
  assert.match(digest.text, /Confirmed appointments: 1/);
  assert.match(digest.text, /Appointments needing follow-up: 2/);
});
