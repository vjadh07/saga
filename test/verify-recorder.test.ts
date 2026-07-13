import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { Recorder, wipeRecorder } from "../src/verify/recorder.js";

const fixedClock = () => "2026-07-10T00:00:00.000Z";

test("records structured events with increasing seq", () => {
  const rec = new Recorder(":memory:", { clock: fixedClock });
  const a = rec.record({ auditId: "aud1", type: "CLAIMS_EXTRACTED", detail: { count: 11 } });
  const b = rec.record({ auditId: "aud1", claimId: "c4", type: "PRIMARY_SOURCE_FOUND", detail: { sourceId: "s2" } });
  expect(a.seq).toBe(1);
  expect(b.seq).toBe(2);
  expect(a.at).toBe("2026-07-10T00:00:00.000Z");
  expect(a.claimId).toBe("");
  expect(b.claimId).toBe("c4");
  expect(b.detail).toEqual({ sourceId: "s2" });
  rec.close();
});

test("events() returns in order and filters by audit", () => {
  const rec = new Recorder(":memory:", { clock: fixedClock });
  rec.record({ auditId: "aud1", type: "CLAIMS_EXTRACTED" });
  rec.record({ auditId: "aud2", type: "CLAIMS_EXTRACTED" });
  rec.record({ auditId: "aud1", type: "AUDIT_COMPLETED" });
  expect(rec.events("aud1").map((e) => e.type)).toEqual(["CLAIMS_EXTRACTED", "AUDIT_COMPLETED"]);
  expect(rec.events()).toHaveLength(3);
  rec.close();
});

test("events survive reopening the database file", () => {
  const dir = mkdtempSync(join(tmpdir(), "saga-rec-"));
  const path = join(dir, "flight.db");
  const rec = new Recorder(path, { clock: fixedClock });
  rec.record({ auditId: "aud1", type: "INJECTION_QUARANTINED", detail: { sourceId: "s8" } });
  rec.close();

  const reopened = new Recorder(path);
  const events = reopened.events("aud1");
  expect(events).toHaveLength(1);
  expect(events[0]!.type).toBe("INJECTION_QUARANTINED");
  reopened.close();

  wipeRecorder(path);
  const wiped = new Recorder(path);
  expect(wiped.events()).toHaveLength(0);
  wiped.close();
});
