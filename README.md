# Middagsplanlegger

En norsk webapp for å planlegge ukens middager. Appen velger oppskrifter som treffer kalori- og makromålene dine, og som deler ingredienser, slik at det blir minst mulig matsvinn. Den lager også en handleliste rundet opp til vanlige pakningsstørrelser.

Appen er en ren statisk nettside på GitHub Pages. Oppskriftene hentes av en egen GitHub Actions-jobb én gang i uken, og alt du lagrer (innstillinger, ukeplaner, favoritter, vurderinger, skjulte oppskrifter, avkrysninger) ligger bare i nettleseren din.

## Innhold

- [Kom i gang](#kom-i-gang)
- [Bruke appen](#bruke-appen)
- [Slik fungerer innhentingen](#slik-fungerer-innhentingen)
- [Legge til nye kilder](#legge-til-nye-kilder)
- [Utvide ingrediensordboken](#utvide-ingrediensordboken)
- [Slik velges middagene](#slik-velges-middagene)
- [Utvikling lokalt](#utvikling-lokalt)
- [Kjente begrensninger](#kjente-begrensninger)

## Kom i gang

1. **Legg koden i et repo på GitHub.** Repoet kan hete hva som helst. Nettsiden blir liggende på `https://<brukernavn>.github.io/<reponavn>/`.

2. **Slå på GitHub Pages.** Gå til *Settings → Pages* og velg **GitHub Actions** under *Build and deployment → Source*.

3. **Gi workflowene skrivetilgang.** Gå til *Settings → Actions → General*, finn *Workflow permissions* og velg **Read and write permissions**. Trykk *Save*. Innhentingen trenger dette for å committe `public/data/recipes.json`.

4. **Kjør innhentingen første gang.** Gå til *Actions → Hent oppskrifter → Run workflow*. Du kan la feltene stå tomme. En full kjøring henter opptil 150 nye oppskrifter per kilde og tar 10–20 minutter fordi den bare gjør én forespørsel i sekundet per nettsted.
   - Rapporten (nye, oppdaterte, fjernede og feilede oppskrifter per kilde) står i jobbens *Summary*.
   - Når jobben er ferdig, starter *Publiser til GitHub Pages* automatisk.

5. **Åpne siden** på adressen fra steg 1 (den står også under *Settings → Pages*).

Etter dette kjører innhentingen av seg selv hver mandag kl. 04:00 (UTC), og siden publiseres på nytt med de nye oppskriftene. Hver kjøring legger til flere oppskrifter, så samlingen vokser fra uke til uke.

### Legge appen på hjemskjermen

Appen er en PWA og kan installeres:

- **iPhone (Safari):** Del-knappen → *Legg til på Hjem-skjerm*.
- **Android (Chrome):** menyen → *Installer app* eller *Legg til på startsiden*.
- **PC (Chrome/Edge):** installer-ikonet i adressefeltet.

Etter første besøk fungerer appen uten nett, så handlelisten kan brukes i butikken selv med dårlig dekning.

## Bruke appen

| Fane | Hva du gjør der |
| --- | --- |
| **Ukeplan** | Lag en plan, lås middager du liker, bytt ut enkeltmiddager eller velg oppskrift selv. Gi rettene 1–5 stjerner, eller trykk på øyet for å skjule en rett du ikke liker (den byttes straks ut). Oppsummeringen viser snitt-kcal og makrofordeling mot målet. |
| **Handleliste** | Samlede mengder for uken, gruppert etter avdeling og rundet opp til pakninger, med omtrentlig pris per vare, per avdeling og totalt. Velg Oda eller MENY, og se hva det koster hos den andre butikken og per porsjon. Kryss av underveis, marker det du har hjemme, kopier eller del listen. Nederst ser du hva som blir til overs. |
| **Oppskrifter** | Søk på navn eller ingrediens, filtrer på kategori og favoritter, sorter på din vurdering, og legg oppskrifter rett inn på en dag. Under «Skjulte» finner du oppskriftene du har skjult, og kan vise dem igjen. |
| **Historikk** | Tidligere uker. Åpne en gammel uke igjen, slett den, eller gi stjerner til rettene dere spiste. |
| **Innstillinger** | Kosthold, kalorier, dager og porsjoner, rester, allergier, mislikte ingredienser, maks tid og balansen mellom makroer og svinn. Eksport og import av alle data. |

**Filippinske retter:** Kawaling Pinoy og Panlasang Pinoy er med som kilder. Oppskriftene der er på engelsk, men med *Vis engelske oppskrifter på norsk* (på som standard, under *Innstillinger → Forslag og optimalisering*) vises de slik:

- Ingrediensene får norske navn og metriske mål (cups blir dl, pounds og ounces blir gram). Den engelske listen ligger under «Vis original ingrediensliste».
- Tittelen oversettes med nettleserens innebygde oversetter når den finnes (nyere Chrome på PC), ellers med en enkel ordliste. Oversatte titler er merket «oversatt», og originaltittelen vises når du holder over merket.
- Knappen «Fremgangsmåten på norsk» åpner originaloppskriften gjennom Google Oversetter.

Under samme innstilling velger du om filippinske retter ikke skal foreslås, foreslås som andre, eller foreslås oftere. I *Oppskrifter* kan du filtrere på kategorien «Filippinsk». Filippinske retter fra de norske kildene (f.eks. «kylling adobo») får også kategorien.

**Fargene på avvik:** grønt betyr innenfor ±10 % av målet, gult innenfor ±20 %, og rødt mer enn 20 % unna.

**Flytte data mellom PC og mobil:** *Innstillinger → Data → Eksporter* lager en JSON-fil. Åpne appen på den andre enheten og velg *Importer*.

## Slik fungerer innhentingen

Nettleseren kan ikke hente sider fra andre nettsteder (CORS), så det gjør skriptet i `scraper/` i GitHub Actions:

1. Finner oppskrifts-URL-er fra sitemap (eller start-URL-er) for hver kilde i `scraper/sources.json`.
2. Henter sidene rolig: maks én forespørsel i sekundet per nettsted, og robots.txt respekteres. En kilde som feiler, stopper ikke de andre.
3. Leser oppskriften fra schema.org/Recipe-dataen (JSON-LD). Mangler den, brukes microdata eller CSS-selektorer fra `sources.json`.
4. Hopper over retter som ikke er middag (bakst, dessert, drikke), oppskrifter på andre språk og sider som krever innlogging. Disse huskes i `scraper/skipped.json` i 90 dager, så de ikke hentes igjen hver uke.
5. Tolker hver ingredienslinje til mengde, enhet og en fast ingrediens-ID ved hjelp av `scraper/ingredients.json`. Linjer som ikke kan tolkes, havner i `scraper/unmatched.json`.
6. Laster ned Matvaretabellen (Mattilsynets åpne data) og beregner kcal, protein, fett og karbohydrater per porsjon. Varer som ikke finnes i Matvaretabellen, slås opp i produktdatabasen på matinfo.no (resultatet huskes i `scraper/matinfo.json` i 90 dager, og kan slås av med `"matinfoReserve": false`). Sidens egne næringstall brukes bare som kontroll. Oppskrifter der under 85 % av ingrediensene kunne beregnes, eller der tallene avviker mye fra sidens egne, merkes som usikre.
7. Klassifiserer oppskriftene (vegetar, lavkarbo, keto, høyprotein osv.), finner allergener og hovedprotein.
8. Henter priser fra nettbutikkene til Oda og MENY (se [Priser](#priser)).
9. Slår sammen med eksisterende data: nye legges til, en del av de eldste sjekkes på nytt hver uke, og oppskrifter som svarer 404/410 fjernes.

Alle eksisterende oppskrifter tolkes på nytt ved hver kjøring, så forbedringer i ordboken gjelder hele samlingen.

### Priser

Hver vare i ingrediensordboken søkes opp i produktsøket til Oda (`oda.com/api/v1/search/mixed`) og MENY (NorgesGruppens produktsøk, `platform-rest-prod.ngdata.no`). Produktene må ha søkeordet som eget ord i navnet (bøyde former som «tomater» godtas, «hvitløksbrød» gjør ikke), og ferdigretter, krydderblandinger og bearbeidede varer hoppes over. Treff tidlig i navnet foretrekkes framfor sammensatte produkter («… med persille»), og utsolgte varer brukes bare når ingenting annet passer. Av de inntil fem beste treffene brukes medianen av kilo-, liter- eller stykkprisen. Den regnes om til pris per kjøpsenhet i ordboken (gram, milliliter eller stykk). Varer som kjøpes i boks, potte eller bunt får prisen for én salgsenhet.

- Resultatet lagres i `scraper/prices.json` og hentes på nytt når det er eldre enn 6 dager, altså ved hver ukentlige kjøring.
- Appen viser prisen for det som faktisk kjøpes (hele pakninger). Finnes ikke varen i valgt butikk, brukes prisen fra den andre og merkes med butikknavnet.
- Søkeordet er ingrediensnavnet, eller feltet `pris` i ordboken (f.eks. `"pris": "norvegia"` for gulost). `"pris": ""` slår av prisoppslag for varen (vann, vin).
- Slå av alt med `"priser": false` i `scraper/sources.json` eller `--no-priser` på kommandolinjen.

Prisene er et anslag: typiske priser den dagen de ble hentet. Trumf-bonus, «3 for 2»-tilbud og prisforskjeller mellom butikkene i kjeden er ikke med.

### Håndplukkede oppskrifter

Noen nettsteder kan ikke hentes automatisk (foreløpig REMA 1000 og Oda). For dem ligger et håndplukket utvalg i `scraper/curated.json`, med navn, ingredienser, tid, porsjoner, bilde og lenke til originalsiden. Oppskriftene tas med ved hver kjøring og får næringsverdier, kategorier og handleliste som alle andre. Filen er fasiten: endrer eller legger du til en oppskrift der, gjelder det fra neste kjøring.

```json
{
  "source": "rema",
  "url": "https://www.rema.no/oppskrifter/aloo-gobi/",
  "name": "Aloo gobi med blomkål og potet",
  "servings": 4,
  "totalTime": 60,
  "ingredients": ["700 g blomkål", "500 g poteter", "1 gul løk"]
}
```

`source` må finnes i `scraper/sources.json` (den kan godt være slått av). Skriv ingredienslinjene som «mengde enhet vare», slik at de kan tolkes.

### Lagre fremgangsmåten eller ikke

I `scraper/sources.json` finnes innstillingen `"lagreFremgangsmate": false`. Da lagres bare navn, ingredienser, næringsverdier, tid, porsjoner, bilde-URL og lenke, og appen lenker til originalsiden for fremgangsmåten. Det er standard av hensyn til opphavsretten til tekstene. Settes den til `true`, lagres fremgangsmåten og vises i appen.

### Kjøre innhentingen manuelt med valg

*Actions → Hent oppskrifter → Run workflow* har to valgfrie felt:

- **limit:** maks antall nye oppskrifter per kilde (f.eks. `20` for en rask kjøring).
- **sources:** bare enkelte kilder, kommaseparert (f.eks. `matprat,meny`).

## Legge til nye kilder

Åpne `scraper/sources.json` og legg til et objekt i `sources`:

```json
{
  "id": "minkilde",
  "name": "Min kilde",
  "enabled": true,
  "baseUrl": "https://www.eksempel.no/",
  "sitemaps": [],
  "urlPattern": "^https://www\\.eksempel\\.no/oppskrift/[^/]+/?$"
}
```

| Felt | Betydning |
| --- | --- |
| `id` | Kort, unik ID (brukes i oppskrifts-ID-ene). |
| `name` | Navnet som vises i appen. |
| `enabled` | `false` slår av kilden uten å slette den. |
| `baseUrl` | Forsiden til nettstedet. |
| `sitemaps` | Sitemap-URL-er. Tom liste betyr at de leses fra robots.txt. Sitemap-indekser følges automatisk. |
| `sitemapFilter` | Valgfritt regulært uttrykk: bare under-sitemaps som matcher, følges (f.eks. `"recipe"`). |
| `startUrls` | Valgfritt: listesider der lenker til oppskrifter plukkes opp, for nettsteder uten sitemap. |
| `urlPattern` | Regulært uttrykk som oppskrifts-URL-er må matche. Husk doble skråstreker (`\\.`) i JSON. |
| `excludePattern` | Valgfritt: URL-er som skal hoppes over. |
| `html` | Valgfritt: CSS-selektorer (`name`, `ingredients`, `instructions`, `servings`, `image`) når siden mangler JSON-LD. |
| `skipIfSelector` | Valgfritt: hopp over sider der denne selektoren finnes (f.eks. innhold for medlemmer). |
| `language` | Valgfritt: språket kilden skriver på, f.eks. `"en"`. Utelatt betyr norsk, og da hoppes oppskrifter på andre språk over. |
| `cuisine` | Valgfritt: kjøkken alle oppskriftene fra kilden hører til, f.eks. `"filippinsk"`. |

Test kilden lokalt før du committer:

```bash
npm install
# Hvordan ser siden ut for skriptet? (JSON-LD, språk, klasser, lenker)
npm run inspect -- --url https://www.eksempel.no/oppskrift/noe/
# Finn sitemaps i robots.txt
npm run inspect -- --robots https://www.eksempel.no
# Hent tre oppskrifter fra den nye kilden til en testfil
npm run scrape -- --sources minkilde --limit 3 --no-deadcheck --out scraper/out/test.json
```

## Utvide ingrediensordboken

`scraper/ingredients.json` har én oppføring per vare:

```json
"purre": {
  "name": "Purre",
  "dept": "frukt_gront",
  "synonyms": ["purre", "purreløk", "purren"],
  "buy": "stk",
  "packages": [1],
  "gpu": 250,
  "units": {"stk": 250},
  "perishable": true,
  "mvt": "purre rå",
  "n": [30, 1.5, 0.3, 6]
}
```

- **synonyms:** skrivemåter som gjenkjennes. Lengste treff vinner, så «kyllinglårfilet» slår «kylling». Vanlige bøyninger (-en, -er, -ene) gjenkjennes automatisk.
- **dept:** avdeling i butikken: `frukt_gront`, `kjott_fisk`, `meieri`, `brod_bakevarer`, `torrvarer`, `hermetikk`, `krydder`, `frysevarer` eller `annet`.
- **buy / packages / gpu / label:** kjøpsenhet (`g`, `ml` eller `stk`), vanlige pakningsstørrelser, gram per kjøpsenhet og navnet på stk-enheten (f.eks. `["boks", "bokser"]`).
- **density / units:** gram per ml for dl/ss/ts, og gram per enhet for boks, pakke, fedd, bunt osv.
- **basis:** `true` for varer de fleste har hjemme (salt, pepper, olje). De skjules under «Basisvarer» i handlelisten.
- **pris:** søkeord hos Oda og MENY når navnet ikke gir gode treff. Tom streng betyr ingen pris.
- **mvt / mvtId:** søkeord for Matvaretabellen (alle ord må finnes i navnet, `-ord` utelukker), eller en eksakt matvare-ID. `scraper/mvt-matches.json` viser hvilken matvare hver vare ble knyttet til.
- **n:** reserveverdier per 100 g `[kcal, protein, fett, karbohydrater]` hvis Matvaretabellen ikke gir treff.
- **tags / allergens / protein:** brukes til kategorier (`kjott`, `fisk`, `meieri`, `belgfrukt`, `middelhav` …), allergener og hovedprotein.

Se i `scraper/unmatched.json` etter kjøringen: den viser de vanligste linjene som ikke ble forstått, med antall. Legg til synonymer eller nye varer, og test en linje med:

```bash
npm run inspect -- --line "1 boks hakkede tomater"
npm run inspect -- --mvt "kikerter"
```

## Slik velges middagene

Hver mulig ukeplan får en poengsum (lavere er bedre):

- **Makro:** hvor langt hver middag er fra kalorimålet per porsjon og fra ønsket fordeling av protein, fett og karbohydrater.
- **Svinn:** hver vares behov for hele uken rundes opp til hele pakninger, og det som blir til overs telles. Ferskvarer teller fullt, tørrvarer lite, krydder nesten ikke, og basisvarer ikke i det hele tatt.
- **Straff og bonus:** samme hovedprotein mer enn to dager på rad og oppskrifter fra de siste to ukene gir straff. Favoritter og oppskrifter som passer kostholdet ditt gir bonus. Stjerner gir bonus over tre stjerner og straff under, og skjulte oppskrifter er aldri med.

Glidebryteren «Treffe makroer ↔ Minst mulig svinn» styrer vekten mellom de to.

Søket er grådig utvalg (dag for dag, blant de beste kandidatene, med litt tilfeldighet så «Ny plan» gir variasjon) etterfulgt av lokal forbedring: én dag om gangen byttes mot oppskrifter som passer målet eller deler varer med resten av uken, og dager byttes om. Det stopper når ingenting blir bedre eller etter ca. 150 ms, så det går raskt også på mobil. Samme oppskrift brukes aldri to ganger i én uke.

## Utvikling lokalt

```bash
npm install
npm run dev        # utviklingsserver på http://localhost:5173/middagsplanlegger/
npm test           # enhetstester for tolkning, optimalisering og handleliste
npm run build      # bygger til dist/
```

Teknologi: Vite, React, TypeScript og Tailwind CSS, med `vite-plugin-pwa` for manifest og service worker. Felles typer for appen og innhentingen ligger i `shared/types.ts`.

## Kjente begrensninger

- **Godt.no** svarer med en robotsjekk i stedet for innhold når siden hentes automatisk, stenger for enkelte roboter i robots.txt og har ingen sitemap. Kilden er derfor slått av (`"enabled": false`), og det finnes ingen håndplukkede oppskrifter derfra.
- **REMA 1000** ser ikke ut til å ha strukturerte oppskriftsdata (schema.org/Recipe), og ingrediensene står som «navn mengde». Automatisk henting er derfor slått av, og et håndplukket utvalg på 13 middager ligger i `scraper/curated.json`. Der siden ikke oppgir porsjoner, er det satt til 4.
- **Oda** ser heller ikke ut til å ha schema.org/Recipe-data på oppskriftssidene. Automatisk henting er slått av, og et håndplukket utvalg på 30 middager fra oda.com/no/recipes ligger i `scraper/curated.json`. Ingrediensene er skrevet om fra Odas produktnavn («0,5 stk Gul løk, finhakket») til vanlige ingredienslinjer, og tilbehør som står flere ganger i samme oppskrift er slått sammen.
- **Trines matblogg** viser de fleste nye oppskrifter bare for medlemmer. Slike sider hoppes over, så kilden gir få oppskrifter.
- **HelloFresh** blokkerer av og til automatisk henting (HTTP 403), og noen oppskrifter har svenske eller engelske titler. Disse hoppes over.
- **Engelske oppskrifter** oversettes bare delvis i appen: ingrediensene fullt ut via ordboken, titler med ordliste eller nettleserens oversetter, og fremgangsmåten via Google Oversetter på originalsiden.
- Næringsberegningen er et anslag. Den bygger på gjennomsnittsverdier fra Matvaretabellen og typiske vekter (f.eks. at én løk er 120 g).
- Pakningsstørrelsene i ordboken er typiske størrelser i norske butikker, ikke utvalget i en bestemt butikk.
- Prisene er anslag ut fra typiske produkter hos Oda og MENY. Valgt merke, tilbud og lokale priser kan gi en annen sum i kassa.
