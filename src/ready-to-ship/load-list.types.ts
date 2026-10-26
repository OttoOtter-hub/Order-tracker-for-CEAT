/** A line as a snapshot names it — stable across backorder uploads (ids aren't). */
export interface LineKey {
  piNumber: string;
  materialNum: string | null;
  soNumber: string | null;
}

export interface SnapshotPosition extends LineKey {
  /** The line's id when the snapshot was taken — a hint, re-matched by key. */
  piLineItemId: string;
  piLabel: string | null;
  materialDesc: string | null;
  loadability: number | null;
  qty: number;
  locked: boolean;
}

export interface SnapshotContainer {
  /** Containers are matched by label — unique per customer, unlike a reused slot's id. */
  label: string;
  name: string | null;
  isOkToMix: boolean;
  isManual: boolean;
  positions: SnapshotPosition[];
}

/** A whole layout: container -> lines -> qty. */
export interface LoadListSnapshot {
  takenAt: string;
  takenBy: string;
  containers: SnapshotContainer[];
}

/** One cut the rollback to CEAT's version had to make (current stock is lower). */
export interface LoadListAdjustment extends LineKey {
  containerLabel: string;
  wanted: number;
  placed: number;
}
