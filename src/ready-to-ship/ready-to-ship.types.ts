import type { Role } from "../common/enums/role.enum";
import type { LoadListStatus } from "./load-list.entity";
import type { LoadListAdjustment } from "./load-list.types";

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
  /**
   * The line's card is archived (fully shipped, or gone from the backorder):
   * the position stays until the client removes it — marked "Proforma
   * archived" on screen.
   */
  piArchived: boolean;
  fillContribution: number;
  markingFile: { id: string; uploadedAt: Date } | null;
}

export interface ContainerView {
  id: string;
  label: string;
  /** Phase 22: the client's name for a numbered container; null when unset. */
  name: string | null;
  /**
   * Phase 21: the "OK to mix" container — always last, fillPercent 0 and
   * never overfilled; totalQty/totalLines are its whole summary.
   */
  isOkToMix: boolean;
  /** Added by the client by hand — not one of the plan's slots. */
  isManual: boolean;
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
  /**
   * Containers the client added by hand, on top of the plan's slots —
   * counted apart from totalPossibleContainers, never as part of it.
   */
  manualContainers: number;
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
  /**
   * Only on the reply to "undo last": removals that were passed over because
   * their card is archived (still in the log, not undone), newest first.
   */
  undoSkipped?: UndoSkippedView[];
  /** Phase 25: where the load list stands and who may edit it now. */
  loadList: LoadListView;
}

export interface LoadListView {
  status: LoadListStatus;
  /** The role that edits in this status ("ops" in draft_ceat, "client" in client_editing). */
  editor: Role | null;
  /** The viewer is that role. */
  canEdit: boolean;
  sentAt: Date | null;
  editRequestedAt: Date | null;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  rejectedAt: Date | null;
  rejectionComment: string | null;
  rejectionAdjustments: LoadListAdjustment[];
  hasClientVersion: boolean;
}

export interface UndoSkippedView {
  code: "UNDO_SKIPPED_ARCHIVED_PI";
  piNumber: string;
  materialNum: string | null;
  /** The container's number ("3"), or "OK to mix". */
  container: string;
  qty: number;
}

export interface UnlockedContainerView {
  id: string;
  label: string;
  customerId: string;
  isConfirmed: boolean;
}

/**
 * Response of POST /ready-to-ship/unlock-all: what was actually reopened.
 * All zeros and an empty list when nothing was locked (not an error).
 */
export interface UnlockedAllView {
  customerId: string;
  containersUnlocked: number;
  positionsUnlocked: number;
  containers: { id: string; label: string; positionsUnlocked: number }[];
}

/** Response of the Phase 16 single-position unlock (POST /container-allocations/:id/unlock). */
export interface UnlockedAllocationView {
  id: string;
  containerId: string;
  containerLabel: string;
  customerId: string;
  isLocked: boolean;
}
