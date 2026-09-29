import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../site/assets/forecast.mjs";

const NOW = "2026-09-29T12:00:00.000Z";

function snapshot(records = [], incidents = []) {
  return {
    schemaVersion: 1,
    checkedAt: "2026-09-29T11:50:00.000Z",
    sources: { recordsLastSuccessfulCheckAt: "2026-09-29T11:49:00.000Z" },
    records,
    incidents,
    status: { indicator: "none", description: "All Systems Operational" },
  };
}

function schedule(overrides = {}) {
  return {
    id: "s1", kind: "reset_scheduled", resetType: "global", scheduleState: "pending",
    scheduleBasis: "explicit", schedulePrecision: "datetime",
    scheduleWindow: { startAt: "2026-09-30T12:00:00.000Z", endAt: "2026-09-30T12:00:00.000Z" },
    ...overrides,
  };
}

test("a precise public global schedule inside 48 hours is a strong signal", () => {
  const result = evaluate(snapshot([schedule()]), NOW);
  assert.equal(result.tone, "announced");
  assert.equal(result.score, 88);
  assert.equal(result.stale, false);
});

test("banked resets and elapsed schedules do not imply a global reset", () => {
  const result = evaluate(snapshot([
    schedule({ resetType: "banked" }),
    schedule({ id: "s2", scheduleState: "elapsed", scheduleWindow: {
      startAt: "2026-09-27T00:00:00.000Z", endAt: "2026-09-28T00:00:00.000Z",
    } }),
  ]), NOW);
  assert.equal(result.tone, "quiet");
  assert.equal(result.score, 10);
  assert.equal(result.scheduled, null);
});

test("a recently completed global reset lowers the no-schedule index", () => {
  const result = evaluate(snapshot([{ id: "c1", kind: "reset_completed", resetType: "global",
    completedAt: "2026-09-29T10:00:00.000Z" }]), NOW);
  assert.equal(result.score, 4);
  assert.equal(result.latestCompleted.id, "c1");
});

test("a relevant unresolved incident is a weak, explicit signal", () => {
  const result = evaluate(snapshot([], [{ name: "Issues with Codex", status: "investigating" }]), NOW);
  assert.equal(result.tone, "watch");
  assert.equal(result.score, 15);
});

test("an old upstream check is marked stale even after a fresh site build", () => {
  const data = snapshot();
  data.sources.recordsLastSuccessfulCheckAt = "2026-09-28T00:00:00.000Z";
  assert.equal(evaluate(data, NOW).stale, true);
});
