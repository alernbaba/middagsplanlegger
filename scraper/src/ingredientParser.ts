import type { Dictionary, DictIngredient } from './dictionary.ts';
import { gramsPerBuyUnit } from './dictionary.ts';

export interface ParsedLine {
  raw: string;
  amount?: number;
  unit?: string;
  /** Teksten som er igjen etter mengde og enhet, normalisert. */
  name: string;
  id?: string;
  grams?: number;
  buyAmount?: number;
  /** Gram oppgitt i parentes, f.eks. "1 boks (400 g)". */
  parenGrams?: number;
}

const FRACTIONS: Record<string, string> = {
  '½': ' 1/2', '¼': ' 1/4', '¾': ' 3/4', '⅓': ' 1/3', '⅔': ' 2/3', '⅛': ' 1/8', '⅕': ' 1/5', '⅖': ' 2/5',
};

// Ord som beskriver tilberedning eller størrelse og ikke hører til ingrediensnavnet.
const DESCRIPTORS = [
  'finhakket', 'grovhakket', 'hakket', 'hakkede', 'finsnittet', 'snittet', 'strimlet', 'strimler', 'skivet', 'skiver', 'i skiver',
  'i terninger', 'terninger', 'i biter', 'biter', 'i båter', 'i strimler', 'revet', 'grovrevet', 'finrevet', 'presset', 'knust', 'moset',
  'fersk', 'ferske', 'frisk', 'friske', 'store', 'stor', 'stort', 'liten', 'lite', 'små', 'middels', 'mellomstore', 'mellomstor',
  'ca', 'ca.', 'cirka', 'omtrent', 'evt', 'evt.', 'eventuelt', 'gjerne', 'til steking', 'til servering', 'til pynt', 'etter smak',
  'etter ønske', 'til topping', 'kokt', 'kokte', 'rå', 'tint', 'tinte', 'frossen', 'frosne', 'skrelt', 'skrellet', 'renset', 'rensket',
  'avrent', 'avrente', 'skylt', 'delt', 'halvert', 'halverte', 'i halve', 'kuttet', 'oppdelt', 'romtemperert', 'myk', 'mykt', 'smeltet',
  'kald', 'kaldt', 'varm', 'varmt', 'økologisk', 'økologiske', 'fint', 'grovt', 'tynne', 'tynt', 'tykke', 'uten skinn og ben', 'uten skinn',
  'uten ben', 'med skinn', 'benfri', 'benfrie', 'hele', 'helt', 'god', 'gode', 'ekstra', 'pr porsjon', 'per porsjon', 'à', 'a',
  // Engelsk (filippinske kilder)
  'chopped', 'finely chopped', 'roughly chopped', 'coarsely chopped', 'minced', 'diced', 'sliced', 'thinly sliced', 'peeled', 'crushed',
  'grated', 'cubed', 'quartered', 'halved', 'beaten', 'lightly beaten', 'cooked', 'boiled', 'drained', 'rinsed', 'trimmed', 'deveined',
  'cleaned', 'optional', 'to taste', 'divided', 'about', 'approximately', 'for garnish', 'for frying', 'for deep frying', 'for serving',
  'finely', 'roughly', 'coarsely', 'thinly', 'cut into serving pieces', 'cut into serving sizes', 'cut into bite-size pieces', 'cut into pieces',
  'cut into cubes', 'cut into strips', 'cut into wedges', 'cut into', 'serving pieces', 'bite-size', 'bite-sized', 'julienned', 'pounded',
  'room temperature', 'softened', 'melted', 'packed', 'or more', 'or to taste', 'as needed', 'skinless', 'boneless', 'bone-in', 'whole',
  'large', 'medium', 'small', 'big', 'fresh', 'frozen', 'thawed', 'canned', 'dried', 'ripe', 'of', 'the', 'into', 'pieces',
];

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DESCRIPTOR_RE = new RegExp(
  `(?<![\\p{L}])(?:${DESCRIPTORS.sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?![\\p{L}])`,
  'giu',
);

export function normalizeText(s: string): string {
  let t = s.toLowerCase();
  for (const [k, v] of Object.entries(FRACTIONS)) t = t.split(k).join(v);
  return t
    .replace(/ /g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(s: string): number | undefined {
  s = s.trim().replace(',', '.');
  // "1 1/2"
  let m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

const NUM = String.raw`(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?)`;
const AMOUNT_RE = new RegExp(String.raw`^(?:ca\.?\s*|cirka\s+|omtrent\s+)?(${NUM})(?:\s*(?:-|til)\s*(${NUM}))?\s*`, 'i');

const WORD_AMOUNTS: Record<string, number> = {
  en: 1, ett: 1, ei: 1, én: 1, halv: 0.5, halvt: 0.5, halve: 0.5, to: 2, tre: 3, fire: 4, fem: 5, seks: 6, sju: 7, syv: 7, åtte: 8, ni: 9, ti: 10,
  'et par': 2, par: 2, noen: 3,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, ten: 10, half: 0.5, 'a few': 3, 'a couple of': 2, an: 1, a: 1,
};

const WORD_ENTRIES = Object.entries(WORD_AMOUNTS).sort((x, y) => y[0].length - x[0].length);

export class IngredientParser {
  private synonyms: { syn: string; id: string; re: RegExp }[] = [];
  private unitAliases: Map<string, string>;

  constructor(private dict: Dictionary) {
    for (const [id, ing] of Object.entries(dict.ingredients)) {
      for (const syn of new Set([ing.name.toLowerCase(), ...ing.synonyms])) {
        const s = syn.toLowerCase();
        // Tillat vanlige bøyningsendelser (løk → løken, tomat → tomatene).
        const re = new RegExp(`(?<![\\p{L}])${escapeRe(s)}(?:e|er|ene|en|et|r|s|es|a)?(?![\\p{L}])`, 'iu');
        this.synonyms.push({ syn: s, id, re });
      }
    }
    // Lengste synonym først, så "kyllinglårfilet" vinner over "kylling".
    this.synonyms.sort((a, b) => b.syn.length - a.syn.length);
    const u = dict.units;
    this.unitAliases = new Map<string, string>();
    for (const k of [...Object.keys(u.volumeMl), ...Object.keys(u.massG), ...u.containerUnits]) this.unitAliases.set(k, k);
    for (const [k, v] of Object.entries(u.aliases)) this.unitAliases.set(k, v);
  }

  matchIngredient(text: string): string | undefined {
    return this.matchBest(text)?.id;
  }

  /** Finner lengste synonym i teksten. */
  matchBest(text: string): { id: string; len: number } | undefined {
    const t = normalizeText(text);
    let best: { id: string; pos: number; len: number } | undefined;
    for (const { syn, id, re } of this.synonyms) {
      const m = re.exec(t);
      if (!m) continue;
      // Lengste treff vinner; ved lik lengde det som står først.
      if (!best || syn.length > best.len || (syn.length === best.len && m.index < best.pos)) {
        best = { id, pos: m.index, len: syn.length };
      }
      if (best && syn.length < best.len) break;
    }
    return best;
  }

  /** Tolker én ingredienslinje. "salt og pepper" kan gi flere linjer. */
  parse(raw: string): ParsedLine[] {
    const line = this.parseOne(raw);
    if (line.amount === undefined && / (?:og|and) /.test(line.name)) {
      const parts = line.name.split(/ og | and |,/).map((p) => p.trim()).filter(Boolean);
      const ids = parts.map((p) => this.matchIngredient(p));
      if (parts.length > 1 && ids.every(Boolean) && new Set(ids).size === ids.length) {
        return parts.map((p, i) => ({ raw, name: p, id: ids[i] }));
      }
    }
    return [line];
  }

  parseOne(raw: string): ParsedLine {
    let t = normalizeText(raw)
      .replace(/^[-•*·]\s*/, '')
      .replace(/(\d)\s*x\s*(\d)/g, '$1x$2');

    // Gram i parentes: "1 boks (400 g) hakkede tomater"
    let parenGrams: number | undefined;
    t = t.replace(/\(([^)]*)\)/g, (_, inner: string) => {
      const m = inner.match(new RegExp(String.raw`(?:à\s*|a\s+|ca\.?\s*)?(${NUM})[\s-]*(g|grams?|kg|oz|ounces?|lbs?|pounds?)\b`));
      if (m && parenGrams === undefined) {
        const n = parseNumber(m[1]);
        const f: Record<string, number> = { kg: 1000, oz: 28.35, ounce: 28.35, ounces: 28.35, lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6 };
        if (n !== undefined) parenGrams = n * (f[m[2]] ?? 1);
      }
      return ' ';
    });

    // "2 x 400 g" → mengde 800 g
    let amount: number | undefined;
    const multi = t.match(new RegExp(String.raw`^(${NUM})x(${NUM})\s*`));
    if (multi) {
      amount = parseNumber(multi[1])! * parseNumber(multi[2])!;
      t = t.slice(multi[0].length);
    } else {
      const m = t.match(AMOUNT_RE);
      if (m) {
        const a = parseNumber(m[1]);
        const b = m[2] ? parseNumber(m[2]) : undefined;
        amount = a !== undefined && b !== undefined ? (a + b) / 2 : a;
        t = t.slice(m[0].length);
      } else {
        for (const [w, v] of WORD_ENTRIES) {
          if (t.startsWith(w + ' ')) {
            amount = v;
            t = t.slice(w.length + 1);
            break;
          }
        }
      }
    }

    // Enhet
    let unit: string | undefined;
    const um = t.match(/^([\p{L}]+\.?)(?=\s|$)/u);
    if (um) {
      const cand = um[1];
      const u = this.unitAliases.get(cand) ?? this.unitAliases.get(cand.replace(/\.$/, ''));
      // Ikke tolk ordet som enhet hvis det er hele resten av linjen ("2 fedd" er ok, "4 hvitløk" er ikke en enhet).
      if (u && (t.length > cand.length || amount !== undefined)) {
        unit = u;
        t = t.slice(cand.length).trim();
        t = t.replace(/^(?:av|med|of)\s+/, '');
      }
    }
    // "1/2 ts salt" etter "salt, 1/2 ts" o.l. – mengde til slutt
    if (amount === undefined) {
      const tail = t.match(new RegExp(String.raw`,?\s*(${NUM})\s*([\p{L}]+)\.?$`, 'u'));
      if (tail) {
        const u = this.unitAliases.get(tail[2]);
        if (u) {
          amount = parseNumber(tail[1]);
          unit = u;
          t = t.slice(0, tail.index).trim();
        }
      }
    }

    // "saft av 1 sitron" / "skall av 1 lime"
    const juice = t.match(new RegExp(String.raw`^(?:saft|skall|revet skall|saften|skallet|juice|zest)\s+(?:(?:og|and)\s+(?:saft|skall|juice|zest)\s+)?(?:av|fra|of|from)\s+(${NUM}|en|ei|ett|1/2|½)?\s*(.*)$`));
    if (juice && amount === undefined) {
      const n = juice[1] ? parseNumber(juice[1]) ?? WORD_AMOUNTS[juice[1]] : 1;
      amount = n;
      unit = undefined;
      t = juice[2];
    }

    const name = t
      .replace(DESCRIPTOR_RE, ' ')
      .replace(/[*:;]+/g, ' ')
      .replace(/\s+,/g, ',')
      .replace(/\s+/g, ' ')
      .replace(/^[,.\s]+|[,.\s]+$/g, '')
      .trim();

    // Lengste treff i teksten før og etter at beskrivende ord er fjernet
    // ("hakkede tomater" skal bli hakkede_tomater, ikke tomat).
    const before = t.split(',')[0];
    const cands = [this.matchBest(before), this.matchBest(name.split(',')[0]), this.matchBest(name)];
    let best: { id: string; len: number } | undefined;
    for (const c of cands) if (c && (!best || c.len > best.len)) best = c;
    const id = best?.id ?? this.matchIngredient(normalizeText(raw));
    const res: ParsedLine = { raw: raw.trim(), name, amount, unit, id, parenGrams };
    if (id) this.resolveGrams(res, this.dict.ingredients[id]);
    return res;
  }

  private resolveGrams(line: ParsedLine, ing: DictIngredient) {
    const u = this.dict.units;
    const { amount, unit } = line;
    let grams: number | undefined;
    if (line.parenGrams !== undefined) {
      grams = line.parenGrams * (amount ?? 1);
    } else if (amount === undefined) {
      grams = undefined;
    } else if (unit && u.massG[unit] !== undefined) {
      grams = amount * u.massG[unit];
    } else if (unit && u.volumeMl[unit] !== undefined) {
      grams = amount * u.volumeMl[unit] * (ing.density ?? 1);
    } else {
      const key = unit ?? 'stk';
      const own = ing.units?.[key];
      if (own !== undefined) grams = amount * own;
      else if (key === 'stk' && ing.buy === 'stk') grams = amount * gramsPerBuyUnit(ing);
      else if (['pakke', 'boks', 'pose', 'glass', 'flaske', 'beger', 'kartong', 'tube'].includes(key)) {
        grams = amount * (ing.buy === 'stk' ? gramsPerBuyUnit(ing) : ing.packages[0] * gramsPerBuyUnit(ing));
      } else if (ing.label && (key === ing.label[0] || key === ing.label[1])) grams = amount * gramsPerBuyUnit(ing);
      else if (u.fallbackGrams[key] !== undefined) grams = amount * u.fallbackGrams[key];
      else if (key === 'stk') grams = amount * (ing.buy === 'g' ? 100 : gramsPerBuyUnit(ing));
    }
    if (grams !== undefined && Number.isFinite(grams)) {
      line.grams = Math.round(grams * 10) / 10;
      line.buyAmount = Math.round((grams / gramsPerBuyUnit(ing)) * 1000) / 1000;
    }
  }
}
