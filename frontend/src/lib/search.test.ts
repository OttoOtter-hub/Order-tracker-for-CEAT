import { test } from "node:test"
import assert from "node:assert/strict"
import { groupSearchResults, isSearchTruncated, matchesSearch } from "./search.ts"
import type { SearchResult } from "../api/search.ts"

const DESC = "205/55 R16 SecuraDrive"

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    query: "107071",
    pi: { items: [], truncated: false },
    readyToShip: { items: [], truncated: false },
    shipped: { items: [], truncated: false },
    ...overrides,
  }
}

const piHit = (piId: string, materialNum: string | null, materialDesc = DESC) => ({
  piId,
  piNumber: `1000${piId}`,
  piLabel: null,
  status: "signed" as const,
  isShippedOnly: false,
  customerId: "cust-1",
  materialNum,
  materialDesc,
})
const rtsHit = (containerId: string, materialNum: string) => ({
  containerId,
  containerLabel: "1",
  containerName: null,
  isOkToMix: false,
  isConfirmed: false,
  customerId: "cust-1",
  materialNum,
  materialDesc: DESC,
})
const shippedHit = (id: string, materialNum: string) => ({
  actualContainerId: id,
  containerNumber: `MSKU${id}`,
  customerId: "cust-1",
  materialNum,
  materialDesc: DESC,
})

test("a material found in one place is a single target with its path", () => {
  const groups = groupSearchResults(
    result({ pi: { items: [piHit("p1", "107071")], truncated: false } }),
    "/client",
    false
  )
  assert.equal(groups.length, 1)
  assert.equal(groups[0].targets.length, 1)
  assert.equal(groups[0].targets[0].path, "/client/pi/p1?q=107071")
})

test("a material in several sections gets one target per section, in section order", () => {
  const groups = groupSearchResults(
    result({
      shipped: { items: [shippedHit("a1", "107071")], truncated: false },
      readyToShip: { items: [rtsHit("c1", "107071")], truncated: false },
      pi: { items: [piHit("p1", "107071")], truncated: false },
    }),
    "/client",
    false
  )
  assert.equal(groups.length, 1)
  assert.deepEqual(
    groups[0].targets.map((t) => [t.section, t.path]),
    [
      ["pi", "/client/pi/p1?q=107071"],
      ["readyToShip", "/client/ready-to-ship?container=c1"],
      ["shipped", "/client/actual-containers/a1?q=107071"],
    ]
  )
})

test("ops opens Ready to ship of the hit's own customer", () => {
  const [group] = groupSearchResults(
    result({ readyToShip: { items: [rtsHit("c1", "107071")], truncated: false } }),
    "/ops",
    true
  )
  assert.equal(
    group.targets[0].path,
    "/ops/ready-to-ship?customerId=cust-1&container=c1"
  )
})

test("groups by material: the exact match first, then by material number", () => {
  const groups = groupSearchResults(
    result({
      query: "107071",
      pi: {
        items: [piHit("p1", "1070712"), piHit("p2", "0107071"), piHit("p3", "107071")],
        truncated: false,
      },
    }),
    "/client",
    false
  )
  assert.deepEqual(
    groups.map((g) => g.materialNum),
    ["107071", "0107071", "1070712"]
  )
})

test("a line without a material number is grouped by its description and links without ?q", () => {
  const [group] = groupSearchResults(
    result({ pi: { items: [piHit("p1", null, "Tube R16")], truncated: false } }),
    "/client",
    false
  )
  assert.equal(group.materialNum, null)
  assert.equal(group.materialDesc, "Tube R16")
  assert.equal(group.targets[0].path, "/client/pi/p1")
})

test("truncated if any section says so", () => {
  assert.equal(isSearchTruncated(result()), false)
  assert.equal(
    isSearchTruncated(result({ shipped: { items: [], truncated: true } })),
    true
  )
})

test("matchesSearch: any field, any case; empty matches all", () => {
  assert.equal(matchesSearch("r16", ["107071", DESC]), true)
  assert.equal(matchesSearch("0707", ["107071", null]), true)
  assert.equal(matchesSearch("r17", ["107071", DESC, undefined]), false)
  assert.equal(matchesSearch("  ", []), true)
})
