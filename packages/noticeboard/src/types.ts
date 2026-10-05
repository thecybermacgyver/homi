export interface ChecklistItem {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
}

export interface Notice {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly color: string;
  readonly image: string | null;
  readonly checklist: readonly ChecklistItem[];
  readonly pinned: boolean;
  // Position and width are fractions of the board, so a board of any size
  // shows the same arrangement. x and y locate the note's top-left corner.
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly rotation: number;
  readonly z: number;
  // null for a notice created on this device that has not synchronized yet.
  readonly authorPersonId: string | null;
  readonly revision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deleted: boolean;
}

export interface NoticeContent {
  readonly title: string;
  readonly body: string;
  readonly color: string;
  readonly image: string | null;
  readonly checklist: readonly ChecklistItem[];
}

export interface NoticePlacement {
  readonly pinned: boolean;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly rotation: number;
  readonly z: number;
}
