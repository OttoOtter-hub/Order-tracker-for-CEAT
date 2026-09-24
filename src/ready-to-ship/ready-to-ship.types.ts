export interface UnallocatedLineView {
  piLineItemId: string;
  piId: string;
  piNumber: string;
  /** The card's client-given name, null when none. */
  piLabel: string | null;
  soNumber: string | null;
  materialNum: string | null;
  materialDesc: string | null;
  loadability: number | null;
  currentWeekDispatchQty: number;
  allocatedQty: number;
  remainingQty: number;
}

export interface AllocationView {
  id: string;
  piLineItemId: string;
  piId: string;
  piNumber: string;
  piLabel: string | null;
  soNumber: string | null;
  materialNum: string | null;
  materialDesc: string | null;
  loadability: number | null;
  allocatedQty: number;
  /** Phase 16: locked/unlocked lives per position now, not on the whole container. */
  isLocked: boolean;
  fillContribution: number;
  markingFile: { id: string; uploadedAt: Date } | null;
}

export interface ContainerView {
  id: string;
  label: string;
  /**
   * Phase 21: the "OK to mix" container — always last, fillPercent 0 and
   * never overfilled; totalQty/totalLines are its whole summary.
   */
  isOkToMix: boolean;
  /** Σ allocatedQty over the container's positions. */
  totalQty: number;
  /** How many positions (allocation rows) the container holds. */
  totalLines: number;
  /** Derived: at least one position, and every one of them locked. */
  isConfirmed: boolean;
  /** Derived: a mix — some positions locked, at least one not. */
  isPartiallyUnlocked: boolean;
  confirmedAt: Date | null;
  confirmedById: string | null;
  fillPercent: number;
  isOverfilled: boolean;
  markingFilesUploaded: number;
  markingFilesTotal: number;
  allocations: AllocationView[];
}

export interface ReadyToShipView {
  customerId: string;
  totalPossibleContainers: number;
  /** True when there is something to confirm and no unconfirmed container is over 100%. */
  canConfirm: boolean;
  /**
   * How many logged actions "undo" can still roll back (those on containers
   * that are not confirmed). Lets the client show the undo controls even when
   * every allocation was taken back out and the containers look empty.
   */
  undoableActions: number;
  unallocatedLines: UnallocatedLineView[];
  containers: ContainerView[];
}

export interface UnlockedContainerView {
  id: string;
  label: string;
  customerId: string;
  isConfirmed: boolean;
}

/** Response of the Phase 16 single-position unlock (POST /container-allocations/:id/unlock). */
export interface UnlockedAllocationView {
  id: string;
  containerId: string;
  containerLabel: string;
  customerId: string;
  isLocked: boolean;
}
