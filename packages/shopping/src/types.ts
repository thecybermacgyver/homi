export interface ShoppingItem {
  readonly id: string;
  readonly name: string;
  readonly quantity: string;
  readonly store: string;
  readonly aisle: string;
  readonly assignedTo: string | null;
  readonly checked: boolean;
  readonly checkedBy: string | null;
  readonly checkedAt: string | null;
  readonly revision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deleted: boolean;
}
