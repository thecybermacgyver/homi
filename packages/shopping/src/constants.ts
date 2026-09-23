export const SHOPPING_MODULE_KEY = "shopping" as const;
export const SHOPPING_VERSION = "0.1.0" as const;

const AISLE_RULES: readonly [RegExp, string][] = [
  [/ice cream|frozen/i, "Frozen"],
  [/milk|egg|cheese|yogurt|butter|cream/i, "Dairy & eggs"],
  [/bread|bun|bagel|tortilla/i, "Bakery"],
  [/apple|banana|carrot|potato|lettuce|onion|fruit|vegetable/i, "Produce"],
  [/beef|hamburger|chicken|pork|fish|meat/i, "Meat & seafood"],
  [/aspirin|medicine|vitamin|pharmacy/i, "Pharmacy"],
  [/duct tape|battery|light bulb|hardware/i, "Hardware"],
  [/soap|detergent|cleaner|paper towel|toilet paper/i, "Household"],
];

export function inferAisle(name: string): string {
  return AISLE_RULES.find(([pattern]) => pattern.test(name))?.[1] ?? "Other";
}
