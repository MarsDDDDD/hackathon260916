# Bronwijzer lokale economie (PROV-AI, challenge 2)

Back-office tool voor medewerkers lokale economie: medewerkers uploaden zelf de PDF-bronnen; de tool zoekt daarna letterlijke passages in reglementen,
toont status/niveau/pagina, laat de medewerker bevindingen bevestigen en maakt een conceptantwoord
(zonder verzendknop).

## Zoeken met en zonder taalmodel

`Zoek passages` voert altijd eerst een lokale, reproduceerbare BM25-zoekopdracht uit op de actieve
documentcollectie. Zodra een taalmodel is ingesteld, laat Bronwijzer dat model daarna alleen korte
Nederlandse zoektermen voorstellen. Die termen krijgen een lager gewicht, worden lokaal gevalideerd
en kunnen de lokale zoekopdracht verbreden; ze zijn zichtbaar in de interface en zijn nooit bronnen,
bevindingen of citaten. Het model krijgt voor deze stap geen passage-tekst en zoekt niet zelf in de
collectie.

Daarna kan de medewerker desgewenst **Formuleer bevindingen** kiezen. Pas dan ontvangt het model
hoogstens de geselecteerde passages. Zonder taalmodel, bij een fout, onbruikbare JSON of een
geannuleerde zoekuitbreiding blijven de gewone lokale zoekresultaten beschikbaar.

## Snel starten

```bash
python3 server.py           # Windows: python server.py
```
Open daarna http://localhost:8000.
Is er nog geen taalmodel ingesteld, dan vraagt de pagina meteen om een OpenAI-sleutel.
Die wordt gecontroleerd bij OpenAI; daarna kies je een model uit je eigen account.
Beide komen in `settings.json` naast `server.py` — dat bestand staat in `.gitignore`
en wordt nooit naar de browser gestuurd. Via de knop rechtsboven wijzig je ze later.

`OPENAI_API_KEY` en `OPENAI_MODEL` uit de omgeving worden als beginwaarde gebruikt;
`settings.json` gaat voor. Andere aanbieder? Zet `OPENAI_URL` op een ander API-adres.

**Zonder server:** dubbelklik `index.html`. Zoeken, bewijs, beoordelen, concept en
bronbeheer werken dan ook, alleen AI-zoektermen en de knop "Formuleer bevindingen" vallen weg.
Wijzigingen en logboek worden in je browser bewaard (localStorage).

## Bestanden

| Bestand | Wat |
| --- | --- |
| `index.html` | Opmaak van de pagina |
| `style.css` | Kleuren (tokens bovenaan), licht/donker |
| `app.js` | Lokale BM25-zoeking, begrensde AI-zoektermen, bewijs, bevindingen, citaatcontrole, concept, bronbeheer, logboek |
| `corpus.js` | Lege startcollectie: geen bronnen zijn vooringeladen |
| `extract_corpus.py` | Ontwikkelhulpmiddel om een oude corpus-export te maken |
| `server.py` | Lokale server, sleutelbeheer, PDF-indexering, gedeelde collectie/logboek en doorgeefluik naar de OpenAI API |
| `data/` | Geüploade PDF's en gedeelde collectie/logboek (wordt aangemaakt; staat in `.gitignore`) |
| `settings.json` | API-sleutel en modelkeuze (wordt bij de eerste start gemaakt, niet gecommit) |

## Bronnen uploaden

Open **Bronnen beheren**, kies één of meer doorzoekbare PDF's en klik
**Geselecteerde PDF's uploaden**. De server bewaart de originelen onder
`data/uploads/`, extraheert per pagina tekst met `pypdf` en bewaart passages,
bronwijzigingen en goedgekeurde antwoorden in `data/collection.json`. De
collectie start altijd leeg; de starter-PDF's zijn niet vooringeladen.

Installeer eenmalig de PDF-lezer:

```bash
pip install -r requirements.txt
```

Een nieuwe upload krijgt bewust de status **te beoordelen**. Controleer die
broninformatie vóór ze als geldende regelgeving wordt gebruikt.

## Corpus exporteren (alleen voor ontwikkelaars)

Vereist `pdftotext`/`pdfinfo` (poppler: `brew install poppler` of `apt install poppler-utils`).
```bash
python3 extract_corpus.py pad/naar/RAG
```
Documentmetadata (titel, status, datum, link) staat bovenaan in `extract_corpus.py` in `DOCS`.
Nieuw document? Voeg een regel toe aan `DOCS` en draai het script opnieuw.

## Waar pas je wat aan (app.js)

- `SYN` en `STOP`: synoniemen en stopwoorden voor het zoeken.
- `search()`: rangschikking en gewicht voor historische documenten.
- `renderUncert()`: welke waarschuwingen de medewerker ziet.
- `aiDraft()`: de prompt voor het taalmodel en de JSON-vorm van het antwoord.
- `verifyQuote()`: controle of een citaat letterlijk in de bron staat.
- `buildDraft()`: sjabloon van het conceptantwoord.

## Bekende beperkingen

- Zoeken op trefwoorden, geen embeddings.
- Zonder server blijven handmatige tekstbronnen en het logboek lokaal in de browser. Met `server.py` zijn uploads, bronwijzigingen en het logboek gedeeld voor iedereen die dezelfde server gebruikt.
- Het marktplan en de quotalijst kunnen door medewerkers worden geüpload wanneer die beschikbaar zijn.
