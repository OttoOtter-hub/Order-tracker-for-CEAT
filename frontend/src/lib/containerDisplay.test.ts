import { test } from "node:test"
import assert from "node:assert/strict"
import { moveTargetOrder, withContainerName } from "./containerDisplay.ts"

const c = (label: string, isOkToMix = false) => ({ label, isOkToMix })

test("the move dialog lists OK to mix first, the rest in the server's order", () => {
  // The server's (and the card list's) order: numbered ones, OK to mix last.
  const server = [c("Контейнер 1"), c("Контейнер 2"), c("Контейнер 10"), c("OK to mix", true)]

  assert.deepEqual(
    moveTargetOrder(server).map((x) => x.label),
    ["OK to mix", "Контейнер 1", "Контейнер 2", "Контейнер 10"]
  )
  // The card list's own array is left as it is.
  assert.equal(server.at(-1)?.label, "OK to mix")
})

test("the move dialog order works without an OK to mix container", () => {
  assert.deepEqual(
    moveTargetOrder([c("Контейнер 2"), c("Контейнер 1")]).map((x) => x.label),
    ["Контейнер 2", "Контейнер 1"]
  )
})

test("a container's name is shown as 'label: name'", () => {
  assert.equal(withContainerName("Контейнер 3", "Ростов"), "Контейнер 3: Ростов")
  assert.equal(withContainerName("Container 3", "  Rostov "), "Container 3: Rostov")
})

test("no name (null, empty, blank) leaves the label alone", () => {
  assert.equal(withContainerName("Контейнер 3", null), "Контейнер 3")
  assert.equal(withContainerName("Контейнер 3", undefined), "Контейнер 3")
  assert.equal(withContainerName("Контейнер 3", "   "), "Контейнер 3")
})
