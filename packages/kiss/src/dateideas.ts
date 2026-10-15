export type Budget = 0 | 1 | 2;
export type Span = "quick" | "evening" | "weekend";
export type Vibe = "cozy" | "adventurous" | "romantic" | "spicy";

export interface DateIdea {
  readonly id: string;
  readonly title: string;
  readonly budget: Budget;
  readonly span: Span;
  readonly vibe: Vibe;
  readonly steps: readonly string[];
}

export const BUDGET_LABEL: Record<Budget, string> = { 0: "Free", 1: "$", 2: "$$" };
export const SPAN_LABEL: Record<Span, string> = { quick: "Quick 30 min", evening: "Evening out", weekend: "Weekend staycation" };
export const VIBE_LABEL: Record<Vibe, string> = { cozy: "Cozy", adventurous: "Adventurous", romantic: "Romantic", spicy: "Spicy" };

type Row = [string, Budget, Span, Vibe, string[]];
const rows: Row[] = [
  ["Blanket fort movie night", 0, "evening", "cozy", ["Build the fort", "Pick the movie together", "Make popcorn"]],
  ["Phone-free walk around the block", 0, "quick", "cozy", ["Leave phones at home", "Take turns choosing the route"]],
  ["Slow dance in the kitchen", 0, "quick", "romantic", ["Pick one song each", "Dim the lights"]],
  ["Stargazing from the yard or balcony", 0, "evening", "romantic", ["Check the clear-sky forecast", "Bring blankets and a warm drink"]],
  ["Cook a new recipe together", 1, "evening", "cozy", ["Choose a recipe", "Shop for ingredients", "Set the table nicely"]],
  ["Breakfast in bed", 1, "quick", "romantic", ["Decide the menu", "Set an early alarm"]],
  ["Picnic in the park", 1, "evening", "romantic", ["Pack the basket", "Pick the spot", "Bring a blanket"]],
  ["Sunrise coffee date", 1, "quick", "adventurous", ["Find a view", "Fill the flask the night before"]],
  ["Board game tournament", 0, "evening", "cozy", ["Choose three games", "Agree on a silly prize"]],
  ["Write each other letters", 0, "evening", "romantic", ["Pick paper and pens", "Swap and read aloud"]],
  ["Candlelit bath for two", 1, "evening", "spicy", ["Candles and music", "Towels and a warm drink"]],
  ["Couples massage swap", 0, "evening", "spicy", ["Warm the oil", "Take ten minutes each"]],
  ["Dessert crawl", 2, "evening", "adventurous", ["Choose three places", "Share one dessert at each"]],
  ["Day trip to a town you have never visited", 2, "weekend", "adventurous", ["Pick the town", "Plan one lunch spot", "Leave early"]],
  ["Hike to a lookout", 0, "weekend", "adventurous", ["Check the trail", "Pack water and snacks"]],
  ["Pottery or art class", 2, "evening", "adventurous", ["Book the class", "Decide who makes what for whom"]],
  ["Karaoke night at home", 0, "evening", "cozy", ["Make a shared playlist", "Pick a duet"]],
  ["Recreate your first date", 1, "evening", "romantic", ["Remember the details", "Dress as you did"]],
  ["Spa night at home", 1, "evening", "cozy", ["Face masks and tea", "Phones away"]],
  ["Museum or gallery wander", 1, "evening", "adventurous", ["Choose an exhibit", "Pick one favourite each"]],
  ["Cocktail or mocktail tasting", 1, "evening", "spicy", ["Pick three recipes", "Rate them together"]],
  ["Fancy dinner at home", 2, "evening", "romantic", ["Plan three courses", "Dress up", "Candles"]],
  ["Weekend cabin or hotel getaway", 2, "weekend", "romantic", ["Book the stay", "Pack a surprise for the other"]],
  ["Staycation: tourists in your own city", 1, "weekend", "adventurous", ["Make a bucket list", "Take photos"]],
  ["Bake something sweet together", 1, "quick", "cozy", ["Pick the recipe", "Share the first warm bite"]],
  ["Plan a dream trip", 0, "quick", "romantic", ["Open a map", "Pick three places", "Rank them"]],
  ["Sunset drive with a playlist", 1, "evening", "romantic", ["Fill the tank", "Make the playlist together"]],
  ["Sing and swap favourite songs", 0, "quick", "cozy", ["Choose three songs each", "Say why each matters"]],
  ["Truth or dare, tender edition", 0, "evening", "spicy", ["Write 10 prompts", "Only kind dares"]],
  ["Midnight snack run", 1, "quick", "adventurous", ["Pick a place", "Order one thing neither has tried"]],
  ["Volunteer together for an afternoon", 0, "weekend", "adventurous", ["Find a cause you both like", "Sign up"]],
  ["Garden or plant day", 1, "weekend", "cozy", ["Pick a plant each", "Name them"]],
  ["Photo scavenger hunt", 0, "evening", "adventurous", ["Write a list of ten", "Set a one-hour timer"]],
  ["Wine or tea tasting at home", 1, "evening", "romantic", ["Choose three", "Take tasting notes"]],
  ["Read to each other", 0, "quick", "cozy", ["Choose a chapter", "Take turns"]],
  ["Build something together", 1, "weekend", "cozy", ["Choose a project", "Share the tools"]],
  ["Try a new cuisine", 2, "evening", "adventurous", ["Pick the restaurant", "Order for each other"]],
  ["Rainy day pillow-and-puzzle", 0, "evening", "cozy", ["Pick a puzzle", "Hot chocolate"]],
  ["Massage and music, lights low", 0, "quick", "spicy", ["Pick the playlist", "Agree on a timer"]],
  ["Lingerie-and-candles night in", 1, "evening", "spicy", ["Set the mood", "Pick the music"]],
  ["Outdoor movie under blankets", 1, "evening", "romantic", ["Hang a sheet or use a laptop", "Snacks and a thermos"]],
  ["Bookshop browse and swap", 1, "quick", "cozy", ["Pick one for the other", "Read the first page aloud"]],
  ["Dance class or YouTube lesson", 0, "evening", "adventurous", ["Pick a style", "Laugh a lot"]],
  ["Long bath and slow playlist", 0, "evening", "spicy", ["Warm water", "Candles"]],
  ["Memory-lane photo evening", 0, "evening", "romantic", ["Pick a year", "Tell the story behind each photo"]],
  ["Farmers market and cook", 1, "weekend", "cozy", ["Pick ingredients", "Cook what you find"]],
  ["Surprise date planned by one partner", 1, "evening", "adventurous", ["Choose who plans", "Only reveal the dress code"]],
  ["Weekend of no plans, together", 0, "weekend", "cozy", ["Silence notifications", "Say yes to whatever feels good"]],
  ["Revisit a place that matters to you both", 0, "evening", "romantic", ["Choose the place", "Bring a small token"]],
  ["Games arcade or mini-golf", 1, "evening", "adventurous", ["Set the stakes", "Loser plans the next date"]],
  ["Breakfast for dinner", 0, "quick", "cozy", ["Pick pancakes or eggs", "Candles anyway"]],
];

export const DATE_IDEAS: readonly DateIdea[] = rows.map(([title, budget, span, vibe, steps], i) => ({
  id: `d${i + 1}`, title, budget, span, vibe, steps,
}));

export function ideaById(id: string | null): DateIdea | null {
  return DATE_IDEAS.find((d) => d.id === id) ?? null;
}
