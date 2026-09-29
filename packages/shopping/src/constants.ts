export const SHOPPING_MODULE_KEY = "shopping" as const;
export const SHOPPING_VERSION = "0.3.0" as const;
export const AISLES = ["Produce", "Bakery", "Dairy & eggs", "Meat & seafood", "Pantry", "Frozen", "Household", "Personal care", "Pharmacy", "Hardware", "Pets", "Other"] as const;
const RULES: readonly [RegExp, string][] = [
  [/\b(ice cream|frozen|popsicles?)\b/i, "Frozen"],
  [/\b(peanut butter|almond butter|coconut milk|oat milk|soy milk|rice|pasta|flour|sugar|salt|pepper|cereal|oats|beans|lentils|coffee|tea|oil|sauce|soup|canned|crackers|cinnamon)\b/i, "Pantry"],
  [/\b(milk|eggs?|cheese|yog[hu]?urt|butter|cream)\b/i, "Dairy & eggs"],
  [/\b(bread|buns?|bagels?|tortillas?|rolls|muffins?)\b/i, "Bakery"],
  [/\b(apples?|bananas?|carrots?|potato(?:es)?|lettuce|onions?|tomato(?:es)?|broccoli|spinach|oranges?|berries|strawberries|blueberries|grapes|lemons?|fruit|vegetables?|cucumber|avocado)\b/i, "Produce"],
  [/\b(beef|hamburger|chicken|pork|fish|salmon|tuna|meat|turkey|shrimp)\b/i, "Meat & seafood"],
  [/\b(aspirin|asprin|medicine|vitamins?|bandages?)\b/i, "Pharmacy"],
  [/\b(duct tape|batter(?:y|ies)|light bulbs?|hardware|screws?|nails?)\b/i, "Hardware"],
  [/\b(shampoo|toothpaste|toothbrush|deodorant)\b/i, "Personal care"],
  [/\b(cat food|dog food|cat litter|pet food)\b/i, "Pets"],
  [/\b(soap|detergent|cleaner|paper towels?|toilet paper|garbage bags?|laundry|dishwashing)\b/i, "Household"],
];
export function inferAisle(name: string): string {
  return RULES.find(([pattern]) => pattern.test(name))?.[1] ?? "Other";
}
export function normalized(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}
