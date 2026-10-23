import { describe, expect, it } from 'vitest';
import { loadDictionary } from '../src/dictionary.ts';
import { enrichRecipe } from '../src/enrich.ts';
import { extractRecipe, parseDuration, parseServings } from '../src/extract.ts';
import { IngredientParser } from '../src/ingredientParser.ts';
import { findMvtFood, matchDictionary, parseMvt } from '../src/nutrition.ts';

const dict = loadDictionary();
const parser = new IngredientParser(dict);
const one = (s: string) => parser.parse(s)[0];

describe('ingredienslinjer', () => {
  it('slår sammen ulike skrivemåter for samme vare', () => {
    expect(one('1 boks hakkede tomater')).toMatchObject({ id: 'hakkede_tomater', grams: 400, buyAmount: 1 });
    expect(one('400 g hermetiske tomater')).toMatchObject({ id: 'hakkede_tomater', grams: 400, buyAmount: 1 });
    expect(one('2 x 400 g hakkede tomater')).toMatchObject({ id: 'hakkede_tomater', grams: 800 });
  });
  it('tolker brøker, intervaller og enheter', () => {
    expect(one('½ purre')).toMatchObject({ id: 'purre', amount: 0.5, grams: 125 });
    expect(one('2-3 gulrøtter')).toMatchObject({ id: 'gulrot', amount: 2.5 });
    expect(one('1,5 dl ris')).toMatchObject({ id: 'ris', unit: 'dl' });
    expect(one('3 dl matfløte')).toMatchObject({ id: 'matflote', grams: 300 });
    expect(one('2 fedd hvitløk')).toMatchObject({ id: 'hvitlok', unit: 'fedd', grams: 10 });
    expect(one('1 ts paprikapulver')).toMatchObject({ id: 'paprikapulver', grams: 2.5 });
  });
  it('bruker gram i parentes', () => {
    expect(one('1 beger rømme (300 g)')).toMatchObject({ id: 'romme', grams: 300 });
    expect(one('4 kyllingfileter (à ca. 150 g)')).toMatchObject({ id: 'kyllingfilet', grams: 600 });
  });
  it('foretrekker lengste treff', () => {
    expect(one('600 g kyllinglårfilet')).toMatchObject({ id: 'kyllinglar' });
    expect(one('1 rød paprika')).toMatchObject({ id: 'paprika' });
    expect(one('2 ts røkt paprikapulver')).toMatchObject({ id: 'paprikapulver' });
  });
  it('deler "salt og pepper"', () => {
    expect(parser.parse('salt og pepper').map((l) => l.id)).toEqual(['salt', 'pepper']);
  });
  it('lar ukjente linjer være uten ID', () => {
    expect(one('1 dl blåbærsyltetøy').id).toBeUndefined();
  });
});

describe('JSON-LD', () => {
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', name: 'Side' },
      {
        '@type': 'Recipe',
        name: 'Testgryte',
        image: [{ '@type': 'ImageObject', url: 'https://example.no/bilde.jpg' }],
        totalTime: 'PT1H15M',
        recipeYield: ['4', '4 porsjoner'],
        recipeIngredient: ['400 g kjøttdeig', '1 boks hakkede tomater', '1 løk', 'salt og pepper'],
        recipeInstructions: [{ '@type': 'HowToSection', itemListElement: [{ '@type': 'HowToStep', text: 'Stek kjøttet.' }] }],
        nutrition: { calories: '450 kcal', proteinContent: '25 g' },
      },
    ],
  })}</script></head><body></body></html>`;

  it('leser oppskrift fra @graph', () => {
    const r = extractRecipe(html)!;
    expect(r).toMatchObject({ name: 'Testgryte', totalTime: 75, servings: 4, image: 'https://example.no/bilde.jpg', via: 'json-ld' });
    expect(r.ingredients).toHaveLength(4);
    expect(r.instructions).toEqual(['Stek kjøttet.']);
    expect(r.siteNutrition).toMatchObject({ kcal: 450, protein: 25 });
  });

  it('faller tilbake til microdata', () => {
    const md = `<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Suppe</h1>
      <span itemprop="recipeYield">2 porsjoner</span><li itemprop="recipeIngredient">1 purre</li><li itemprop="recipeIngredient">5 dl melk</li></div>`;
    expect(extractRecipe(md)).toMatchObject({ name: 'Suppe', servings: 2, via: 'microdata' });
  });

  it('tolker tider og porsjoner', () => {
    expect(parseDuration('PT45M')).toBe(45);
    expect(parseDuration('1 t 30 min')).toBe(90);
    expect(parseServings('4-6 porsjoner')).toBe(5);
  });

  it('beregner næring, kategorier og allergener', () => {
    const r = extractRecipe(html)!;
    const mvt = matchDictionary(dict, []);
    const rec = enrichRecipe(
      { id: 't', source: 'test', sourceName: 'Test', url: 'https://example.no', name: r.name, servings: 4, firstSeen: '', lastSeen: '' },
      r.ingredients,
      { dict, parser, mvt, unmatched: new Map() },
    );
    // 400 g kjøttdeig (840 kcal) + 400 g tomater (88) + 120 g løk (48) = 976 / 4
    expect(rec.perServing.kcal).toBe(244);
    expect(rec.mainProtein).toBe('storfe');
    expect(rec.categories).not.toContain('vegetar');
    expect(rec.uncertain).toBe(false);
  });
});

describe('Matvaretabellen', () => {
  const foods = parseMvt({
    foods: [
      { foodId: '1', foodName: 'Løk, gul, rå', calories: { quantity: 38 }, constituents: [{ nutrientId: 'Protein', quantity: 1.2 }, { nutrientId: 'Fett', quantity: 0.1 }, { nutrientId: 'Karbo', quantity: 7 }] },
      { foodId: '2', foodName: 'Hvitløk, rå', calories: { quantity: 140 }, constituents: [] },
      { foodId: '3', foodName: 'Løk, gul, stekt', calories: { quantity: 90 }, constituents: [] },
    ],
  });
  it('finner beste matvare for søkeordene', () => {
    expect(findMvtFood(foods, 'løk gul rå')?.foodId).toBe('1');
    expect(findMvtFood(foods, 'hvitløk rå')?.foodId).toBe('2');
    expect(findMvtFood(foods, 'løk -rå')?.foodId).toBe('3');
  });
});
