import { describe, expect, it } from 'vitest';
import { loadDictionary } from '../src/dictionary.ts';
import { parseMeny, parseOda, pickPrice, priceQuery, pricePerBuyUnit, rankStoreProducts, type StoreProduct } from '../src/prices.ts';

const dict = loadDictionary();
const ing = (id: string) => dict.ingredients[id];
const product = (name: string, price: number, unitPrice: number, unit = 'kg'): StoreProduct => ({ name, price, unitPrice, unit });

describe('prisoppslag', () => {
  it('leser søkeresultater fra Oda', () => {
    const json = {
      items: [
        { type: 'recipe', attributes: { title: 'Taco' } },
        {
          type: 'product',
          attributes: {
            full_name: 'Vår Laveste Pris Kjøttdeig av storfe 14%',
            gross_price: '72.90',
            gross_unit_price: '182.25',
            unit_price_quantity_abbreviation: 'kg',
            front_url: 'https://oda.com/no/products/63590-var-laveste-pris-kjottdeig-av-storfe-14/',
            availability: { is_available: true },
          },
        },
        { type: 'product', attributes: { full_name: 'Utsolgt kjøttdeig', gross_price: '80', gross_unit_price: '200', unit_price_quantity_abbreviation: 'kg', availability: { is_available: false } } },
      ],
    };
    expect(parseOda(json)).toEqual([
      { name: 'Vår Laveste Pris Kjøttdeig av storfe 14%', price: 72.9, unitPrice: 182.25, unit: 'kg', url: 'https://oda.com/no/products/63590-var-laveste-pris-kjottdeig-av-storfe-14/' },
    ]);
  });

  it('leser søkeresultater fra MENY', () => {
    const json = {
      hits: [
        {
          title: 'Kjøttdeig',
          contentData: {
            title: 'Kjøttdeig',
            subtitle: 'u/Salt&Vann 400g Gilde',
            pricePerUnit: 86,
            comparePricePerUnit: 215,
            compareUnit: 'kg',
            slugifiedUrl: '/kjott/kjottdeig-og-farse/kjottdeig/kjottdeig-7020098003052',
            isForSale: true,
            isOutOfStock: false,
          },
        },
      ],
    };
    expect(parseMeny(json)).toEqual([
      { name: 'Kjøttdeig u/Salt&Vann 400g Gilde', price: 86, unitPrice: 215, unit: 'kg', url: 'https://meny.no/varer/kjott/kjottdeig-og-farse/kjottdeig/kjottdeig-7020098003052' },
    ]);
  });

  it('krever at søkeordene starter et ord, og hopper over ferdigretter', () => {
    const ranked = rankStoreProducts(
      [product('Løk gul 1 kg', 25, 25), product('Rødløk', 30, 40), product('Løkpulver', 30, 600), product('Stekt løk', 20, 200), product('Ris jasmin', 40, 40)],
      'løk',
    );
    expect(ranked.map((p) => p.name)).toEqual(['Løk gul 1 kg', 'Stekt løk']);
    // «is» skal bare utelukke hele ordet, ikke «ris».
    expect(rankStoreProducts([product('Ris jasmin', 40, 40)], 'ris')).toHaveLength(1);
  });

  it('regner om til kroner per kjøpsenhet', () => {
    expect(pricePerBuyUnit(product('Kjøttdeig', 72.9, 182.25), ing('kjottdeig'))).toBeCloseTo(0.18225);
    expect(pricePerBuyUnit(product('Lettmelk', 31.9, 18.23, 'l'), ing('melk'))).toBeCloseTo(0.01823);
    // Løk kjøpes per stk (120 g), men selges per kilo.
    expect(pricePerBuyUnit(product('Løk gul', 25, 25), ing('lok'))).toBeCloseTo(3);
    // Hakkede tomater kjøpes per boks: prisen for én boks brukes.
    expect(pricePerBuyUnit(product('Hakkede tomater 400 g', 12.9, 32.25), ing('hakkede_tomater'))).toBe(12.9);
    expect(pricePerBuyUnit(product('Egg 12 stk', 50, 4.17, 'stk'), ing('egg'))).toBe(4.17);
  });

  it('velger medianen av de mest relevante treffene', () => {
    const products = [product('Kjøttdeig 400 g', 60, 150), product('Kjøttdeig 600 g', 125, 208), product('Kjøttdeig økologisk', 100, 250)];
    expect(pickPrice(products, 'kjøttdeig', ing('kjottdeig'))).toEqual({ perUnit: 0.208, product: 'Kjøttdeig 600 g' });
    expect(pickPrice([product('Kjøttdeigsaus', 30, 60)], 'kjøttdeig', ing('kjottdeig'))).toBeUndefined();
  });

  it('bruker søkeord fra ordboken', () => {
    expect(priceQuery(ing('ost'))).toBe('norvegia');
    expect(priceQuery(ing('kyllingfilet'))).toBe('kyllingfilet');
    expect(priceQuery(ing('vann'))).toBe('');
  });
});
