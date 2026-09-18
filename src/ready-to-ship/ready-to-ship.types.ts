export interface UnallocatedLineView {
  piLineItemId: string;
  piId: string;
  piNumber: string;
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
  soNumber: string | null;
  materialNum: string | null;
  materialDesc: string | null;
  loadability: number | null;
  allocatedQty: number;
  fillContribution: number;
  markingFile: { id: string; uploadedAt: Date } | null;
}

export interface ContainerView {
  id: string;
  label: string;
  isConfirmed: boolean;
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
