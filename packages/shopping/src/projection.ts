import type { ShoppingItem } from "./types.js";
import { inferAisle, normalized } from "./constants.js";

export function placement(name: string, store: string, aisle: string, items: readonly ShoppingItem[]) {
  const matches = items.filter(item => normalized(item.name) === normalized(name))
    .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  const chosenStore = store.trim() || matches[0]?.store || "Any store";
  const known = matches.find(item => normalized(item.store) === normalized(chosenStore));
  return { store: chosenStore, aisle: aisle.trim() || known?.aisle || inferAisle(name) };
}

export function payload(item: ShoppingItem, checked = item.checked): Record<string, unknown> {
  return {name:item.name, quantity:item.quantity, store:item.store, aisle:item.aisle,
    assignedTo:item.assignedTo, checked};
}
