import { test } from "node:test"
import assert from "node:assert/strict"
import { formatRemainingPercent } from "./remainingPercent.ts"

test("null (nothing to measure) is a dash", () => {
  assert.equal(formatRemainingPercent(null), "—")
  assert.equal(formatRemainingPercent(undefined), "—")
})

test("below 1 but above 0 is <1%; exactly 0 is 0%", () => {
  assert.equal(formatRemainingPercent(0.1), "<1%")
  assert.equal(formatRemainingPercent(0.9), "<1%")
  assert.equal(formatRemainingPercent(0), "0%")
})

test("whole percent otherwise; something left never shows as 100%", () => {
  assert.equal(formatRemainingPercent(37.5), "38%")
  assert.equal(formatRemainingPercent(1), "1%")
  assert.equal(formatRemainingPercent(99.6), "99%")
  assert.equal(formatRemainingPercent(100), "100%")
})
