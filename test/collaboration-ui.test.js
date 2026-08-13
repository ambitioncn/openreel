import test from "node:test";
import assert from "node:assert/strict";
import { collaborationConflictView } from "../src/collaboration-ui.js";

test("CO-01 browser conflict state preserves the winner and offers an explicit reload", () => {
  assert.equal(collaborationConflictView({ code: "INVALID_INPUT" }), null);
  assert.deepEqual(collaborationConflictView({ code: "VERSION_CONFLICT", details: { expectedVersion: 7 } }), {
    title: "A newer collaborative edit is available.",
    message: "Your edit was not applied. The shared document is now at version 7.",
    action: "Load latest version"
  });
  assert.match(collaborationConflictView({ code: "VERSION_CONFLICT" }).message, /not applied/);
});
