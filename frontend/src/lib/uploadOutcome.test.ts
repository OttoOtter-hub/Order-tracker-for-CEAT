import { test } from "node:test"
import assert from "node:assert/strict"
import { isOutcomeUnknown } from "./uploadOutcome.ts"

test("a gateway timeout or a gateway error: outcome unknown", () => {
  for (const status of [502, 503, 504]) {
    assert.equal(isOutcomeUnknown({ status, message: "Gateway Timeout" }), true)
  }
})

test("a dropped connection (fetch rejects with TypeError): outcome unknown", () => {
  assert.equal(isOutcomeUnknown(new TypeError("Failed to fetch")), true)
})

test("the server's own answer is a definite failure", () => {
  for (const status of [400, 401, 403, 404, 409, 413, 500]) {
    assert.equal(isOutcomeUnknown({ status, code: "X" }), false)
  }
  assert.equal(isOutcomeUnknown(new Error("something else")), false)
  assert.equal(isOutcomeUnknown(undefined), false)
})
