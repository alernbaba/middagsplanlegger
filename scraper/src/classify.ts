import type { Allergen, Category, Nutrition, RecipeIngredient } from '../../shared/types.ts';
import type { Dictionary } from './dictionary.ts';

// Ord i ingredienslinjer som avslører kjøtt/fisk selv om linjen ikke ble tolket.
const MEAT_WORDS = /kjøtt|kylling|svin|storfe|okse|bacon|skinke|pølse|lam\b|lamme|kalkun|and\b|andebryst|vilt|hjort|elg|reinsdyr|biff|filet|karbonade|chorizo|salami|pancetta|chicken|pork|beef|lamb|goat|ham\b|sausage|liempo|oxtail|longganisa|tocino|meat/i;
const FISH_WORDS = /laks|torsk|fisk|sei\b|reke|scampi|tunfisk|makrell|ørret|skalldyr|krabbe|blåskjell|kamskjell|ansjos|sardin|hyse|kveite|lyr|røye|fish|shrimp|prawn|squid|crab|mussel|clam|tilapia|bangus|milkfish|salmon|tuna|bagoong|patis|anchov/i;
const ALLERGEN_WORDS: [Allergen, RegExp][] = [
  ['gluten', /hvete|mel\b|pasta|spaghetti|brød|bygg|rug|couscous|bulgur|nudler|panko|tortilla|lefse|pita|flour|bread|noodle|wrapper|macaroni|soy sauce/i],
  ['laktose', /melk|fløte|smør|ost\b|ost,|rømme|yoghurt|crème|creme|parmesan|mozzarella|feta|milk|cream|butter|cheese/i],
  ['notter', /nøtt|mandel|cashew|valnøtt|hasselnøtt|pistasj|pekan|pinjekjerne/i],
  ['peanotter', /peanøtt/i],
  ['skalldyr', /reke|scampi|krabbe|hummer|skalldyr|blåskjell|kamskjell|kreps|shrimp|prawn|crab|squid|mussel|clam|bagoong/i],
  ['fisk', /laks|torsk|fisk|sei\b|tunfisk|makrell|ørret|ansjos|sardin|hyse|kveite/i],
  ['egg', /\begg|majones|aioli|mayo/i],
  ['soya', /soya|tofu|edamame|miso|soy\b|tokwa|toyo/i],
  ['selleri', /selleri/i],
  ['sennep', /sennep|dijon/i],
  ['sesam', /sesam|tahini/i],
];

export interface Classification {
  categories: Category[];
  allergens: Allergen[];
  mainProtein: string;
}

export function energyShares(n: Nutrition) {
  const p = n.protein * 4;
  const f = n.fat * 9;
  const c = n.carbs * 4;
  const sum = p + f + c || 1;
  return { protein: p / sum, fat: f / sum, carbs: c / sum };
}

export function classify(ings: RecipeIngredient[], perServing: Nutrition, dict: Dictionary): Classification {
  const tags = new Set<string>();
  const allergens = new Set<Allergen>();
  const proteinBy = new Map<string, number>();
  let vegGrams = 0;
  let totalGrams = 0;
  let unmatchedMeat = false;
  let unmatchedFish = false;

  for (const ing of ings) {
    const d = ing.id ? dict.ingredients[ing.id] : undefined;
    if (d) {
      d.tags?.forEach((t) => tags.add(t));
      d.allergens?.forEach((a) => allergens.add(a));
      if (d.protein && ing.nutrition) proteinBy.set(d.protein, (proteinBy.get(d.protein) ?? 0) + ing.nutrition.protein);
      if (ing.grams) {
        totalGrams += ing.grams;
        if (d.tags?.includes('gronnsak')) vegGrams += ing.grams;
      }
    } else {
      if (MEAT_WORDS.test(ing.raw)) unmatchedMeat = true;
      if (FISH_WORDS.test(ing.raw)) unmatchedFish = true;
      for (const [a, re] of ALLERGEN_WORDS) if (re.test(ing.raw)) allergens.add(a);
    }
  }

  const hasMeat = tags.has('kjott') || unmatchedMeat;
  const hasFish = tags.has('fisk') || tags.has('skalldyr') || unmatchedFish;
  const sh = energyShares(perServing);
  const cats: Category[] = [];
  if (!hasMeat && !hasFish) {
    cats.push('vegetar');
    if (!tags.has('meieri') && !tags.has('egg') && !tags.has('honning')) cats.push('vegansk');
  }
  if (!hasMeat && hasFish) cats.push('pescetar');
  if (sh.carbs <= 0.26 || perServing.carbs <= 20) cats.push('lavkarbo');
  if (sh.carbs <= 0.1 && sh.fat >= 0.6) cats.push('keto');
  if (sh.protein >= 0.3 || perServing.protein >= 35) cats.push('hoyprotein');
  if (perServing.kcal > 0 && perServing.kcal <= 700 && sh.fat <= 0.4 && totalGrams > 0 && vegGrams / totalGrams >= 0.2) cats.push('sunt');
  const medCount = ings.filter((i) => i.id && dict.ingredients[i.id]?.tags?.includes('middelhav')).length;
  const redMeat = ings.some((i) => i.id && ['storfe', 'svin'].includes(dict.ingredients[i.id]?.protein ?? ''));
  if (medCount >= 3 && !redMeat) cats.push('middelhav');

  let mainProtein = [...proteinBy.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!mainProtein) mainProtein = hasMeat ? 'kjott' : hasFish ? 'fisk' : 'vegetar';
  return { categories: cats, allergens: [...allergens].sort(), mainProtein };
}

// Retter som ikke er middag (bakst, dessert, drikke osv.).
const NOT_DINNER_NAME = /muffins|\bkake|kaker\b|kakene|\bboller\b|bolle\b|cookies|småkaker|\bis\b|iskrem|smoothie|dessert|rundstykker|syltetøy|\bsaft\b|cocktail|\bdrink|mocktail|glasur|marengs|\bterte|brownies|cupcakes|sjokolade(?!saus)|konfekt|knekkebrød|granola|müsli|grøt\b|frokost|julekake|pepperkake|sirupssnipp|krumkake|kanelsnurr|snurrer|kringle|pai med (?:eple|bær|rabarbra)|eplekake|tiramisu|pudding(?!.*fisk)|sorbet|parfait|kompott|trifle|\bbrød\b$|^brød|loff\b|baguetter?\b|focaccia$|pizzadeig$|\bdip\b|dressing$|\bsaus\b$|marinade$|krydderblanding|smør\b$|pesto$|hummus$|guacamole$|salsa$/i;
const NOT_DINNER_TAG = /dessert|bakst|baking|kaker|søtt|drikke|drinker|frokost|kjeks|småkaker|snacks|godteri|tilbehør|sauser|brød og|is og|sylting|dipper|merienda|drinks|beverage|bread|condiment|kakanin|sweets/i;
// Engelske desserter, bakst og drikke (filippinske kilder).
const NOT_DINNER_NAME_EN = /\bcake|leche flan|\bflan\b|halo-halo|turon|bibingka|\bputo\b|kutsinta|suman|polvoron|ensaymada|pandesal|cookies?\b|ice cream|ice candy|smoothie|\bshake\b|\bjuice\b|\bdrink|\bbread\b|muffins?|brownies?|\bcandy|\bjam\b|syrup|champorado|maja blanca|\bbiko\b|kakanin|cupcakes?|pudding|buko pandan|\bsago\b|gulaman|\btaho\b|graham|cheesecake|donuts?|doughnuts?|pancakes?|waffles?|\btart|\bpie\b|ube halaya|yema|pastillas|banana cue|camote cue|maruya|crinkles|\bdip\b|dipping sauce|dressing$|\bsauce$|marinade$|vinaigrette|how to cook rice|\btea\b|coffee|lemonade|cocktail/i;

/** Gjetter om oppskriften er en middagsrett. */
export function looksLikeDinner(name: string, tags: string[], url: string): boolean {
  if (NOT_DINNER_NAME.test(name) || NOT_DINNER_NAME_EN.test(name)) return false;
  if (tags.some((t) => NOT_DINNER_TAG.test(t)) && !tags.some((t) => /middag|hovedrett|main|dinner|lunch|entree|entrée/i.test(t))) return false;
  if (/\/(?:bakst|baking|dessert|desserter|kaker|drikke|drinker|frokost|smakaker|is)\//i.test(url)) return false;
  return true;
}

const SWEDISH_WORD = /\b(och|sås|potatis|ugnsbakad|rostade?|krämig|köttbullar|purjolök|lök|salladsost|grönsaker|gräddsås)\b/i;
const ENGLISH_WORD = /\b(with|the|chicken|beef|pork|rice|salad|sauce|potatoes|roasted|creamy|spicy)\b/i;

/**
 * Svenske eller engelske titler tyder på at oppskriften ikke er oversatt (HelloFresh har mange slike).
 * «ä» brukes ikke på norsk, «ö» kan stå i lånord (köfte).
 */
export function looksForeign(name: string): boolean {
  return /ä/i.test(name) || SWEDISH_WORD.test(name) || ENGLISH_WORD.test(name);
}

/** Kjente filippinske retter, også når de står på norske sider («Kylling adobo»). */
const FILIPINO = /adobo|sinigang|pancit|lumpia|kare-?kare|\bsisig|tinola|afritada|\bmenudo|kaldereta|caldereta|bistek|lechon|longganisa|longanisa|tapsilog|arroz caldo|ginataa?n|\blaing\b|bicol express|pinakbet|pakbet|nilaga|bulalo|giniling|lugaw|kinilaw|tocino|embutido|dinuguan|paksiw|inasal|pochero|puchero|mechado|palabok|\bsopas\b|filippinsk|filipino|pinoy|tortang|batchoy|humba|igado|dinengdeng|chopsuey|chop suey|\blomi\b|misua|sotanghon|bihon|\bcanton\b|tinolang|sarciado|escabeche|relleno|picadillo|bopis|kilawin|binagoongan|ginisang|ginisa|monggo|\btapa\b|tokwa|\bsiopao|siomai|pinangat|sinampalukan|nilagang|sinanglay|halabos|inihaw|daing|sinuglaw|chicharon|crispy pata|kinamatisan|pastel|calamares|\bgata\b/i;

export function looksFilipino(name: string): boolean {
  return FILIPINO.test(name);
}
