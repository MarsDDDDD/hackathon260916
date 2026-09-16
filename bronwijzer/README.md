# Bronwijzer lokale economie (PROV-AI, challenge 2)

Back-office tool voor medewerkers lokale economie: zoekt letterlijke passages in reglementen,
toont status/niveau/pagina, laat de medewerker bevindingen bevestigen en maakt een conceptantwoord
(zonder verzendknop).

## Snel starten

**Zonder installatie:** dubbelklik `index.html`. Zoeken, bewijs, beoordelen, concept en bronbeheer werken.
Wijzigingen en logboek worden in je browser bewaard (localStorage).

**Met taalmodel:**
```bash
export OPENAI_API_KEY=...   # eigen sleutel; deel of commit die nooit
export OPENAI_MODEL=...     # een model uit je account
python3 server.py           # open http://localhost:8000
```
Andere aanbieder? Pas `OPENAI_URL` en eventueel het request in `server.py` aan.

## Bestanden

| Bestand | Wat |
| --- | --- |
| `index.html` | Opmaak van de pagina |
| `style.css` | Kleuren (tokens bovenaan), licht/donker |
| `app.js` | Zoeken (BM25), bewijs, bevindingen, citaatcontrole, concept, bronbeheer, logboek |
| `corpus.js` | Passages + documentmetadata (gegenereerd) |
| `extract_corpus.py` | Maakt `corpus.js` uit de PDF's |
| `server.py` | Lokale server + doorgeefluik naar het taalmodel |

## Corpus opnieuw maken

Vereist `pdftotext`/`pdfinfo` (poppler: `brew install poppler` of `apt install poppler-utils`).
```bash
python3 extract_corpus.py pad/naar/RAG
```
Documentmetadata (titel, status, datum, link) staat bovenaan in `extract_corpus.py` in `DOCS`.
Nieuw document? Voeg een regel toe aan `DOCS` en draai het script opnieuw.

## Waar pas je wat aan (app.js)

- `SYN` en `STOP`: synoniemen en stopwoorden voor het zoeken.
- `search()`: rangschikking, gemeentefilter, gewicht voor historische documenten.
- `renderUncert()`: welke waarschuwingen de medewerker ziet.
- `aiDraft()`: de prompt voor het taalmodel en de JSON-vorm van het antwoord.
- `verifyQuote()`: controle of een citaat letterlijk in de bron staat.
- `buildDraft()`: sjabloon van het conceptantwoord.

## Bekende beperkingen

- Zoeken op trefwoorden, geen embeddings.
- Alleen de twee Schoten-marktdocumenten hebben een link naar het origineel.
- Koninklijk besluit 2006: alleen de Nederlandse kolom, automatisch gesplitst.
- Logboek en bronwijzigingen staan lokaal in de browser (in de claude.ai-versie: gedeeld).
- Het marktplan en de quotalijst (bijlagen marktreglement) ontbreken.
