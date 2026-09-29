// Pure (no React, no aliases at runtime — the type import is erased): tested
// by npm test (node --test).
import type {
  PiSearchHit,
  ReadyToShipSearchHit,
  SearchResult,
  ShippedSearchHit,
} from "@/api/search"

export type SearchSectionKey = "pi" | "readyToShip" | "shipped"

// One place a material was found, and where a click on it leads.
export type SearchTarget =
  | { section: "pi"; key: string; path: string; hit: PiSearchHit }
  | { section: "readyToShip"; key: string; path: string; hit: ReadyToShipSearchHit }
  | { section: "shipped"; key: string; path: string; hit: ShippedSearchHit }

export interface MaterialGroup {
  key: string
  materialNum: string | null
  materialDesc: string | null
  // In section order: PI cards, then "Ready to ship", then "Shipped".
  targets: SearchTarget[]
}

const SECTION_ORDER: SearchSectionKey[] = ["pi", "readyToShip", "shipped"]

function withMaterial(path: string, materialNum: string | null): string {
  return materialNum ? `${path}?q=${encodeURIComponent(materialNum)}` : path
}

/**
 * The header search's dropdown: the API's three flat sections regrouped by
 * material. A material found in exactly one place is one click; otherwise
 * each place is its own item under the material. A material that matches
 * the query exactly comes first, the rest by material number.
 *
 * `basePath` is "/ops" or "/client"; ops opens "Ready to ship" for the
 * hit's own customer (the page otherwise shows the first one).
 */
export function groupSearchResults(
  result: SearchResult,
  basePath: string,
  isOps: boolean
): MaterialGroup[] {
  const groups = new Map<string, MaterialGroup>()
  const add = (target: SearchTarget) => {
    const { materialNum, materialDesc } = target.hit
    const key = materialNum ?? `desc:${materialDesc ?? ""}`
    let group = groups.get(key)
    if (!group) {
      group = { key, materialNum, materialDesc, targets: [] }
      groups.set(key, group)
    }
    group.targets.push(target)
  }

  for (const hit of result.pi.items) {
    add({
      section: "pi",
      key: `pi:${hit.piId}`,
      path: withMaterial(`${basePath}/pi/${hit.piId}`, hit.materialNum),
      hit,
    })
  }
  for (const hit of result.readyToShip.items) {
    const params = new URLSearchParams()
    if (isOps) params.set("customerId", hit.customerId)
    params.set("container", hit.containerId)
    add({
      section: "readyToShip",
      key: `rts:${hit.containerId}`,
      path: `${basePath}/ready-to-ship?${params.toString()}`,
      hit,
    })
  }
  for (const hit of result.shipped.items) {
    add({
      section: "shipped",
      key: `shipped:${hit.actualContainerId}`,
      path: withMaterial(
        `${basePath}/actual-containers/${hit.actualContainerId}`,
        hit.materialNum
      ),
      hit,
    })
  }

  const exact = result.query.trim()
  return [...groups.values()]
    .map((group) => ({
      ...group,
      targets: [...group.targets].sort(
        (a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section)
      ),
    }))
    .sort(
      (a, b) =>
        Number(b.materialNum === exact) - Number(a.materialNum === exact) ||
        (a.materialNum ?? "").localeCompare(b.materialNum ?? "") ||
        (a.materialDesc ?? "").localeCompare(b.materialDesc ?? "")
    )
}

export function isSearchTruncated(result: SearchResult): boolean {
  return (
    result.pi.truncated || result.readyToShip.truncated || result.shipped.truncated
  )
}

/**
 * The lists' own search (data already on the page): does any of `fields`
 * contain `needle`, in any case? An empty needle matches everything.
 */
export function matchesSearch(
  needle: string,
  fields: readonly (string | null | undefined)[]
): boolean {
  const lowered = needle.trim().toLowerCase()
  if (!lowered) return true
  return fields.some((field) => field?.toLowerCase().includes(lowered))
}
