# Bronwijzer lokale economie

Prototype voor de **PROV-AI hackathon, Challenge 2 · Answer Like the Expert**.

Een back-office tool voor medewerkers lokale economie. De medewerker uploadt zelf de officiële PDF-bronnen,
zoekt letterlijke passages, bevestigt bevindingen en maakt een bewerkbaar conceptantwoord.
De tool kan niets verzenden: de medewerker beslist wat er gecommuniceerd wordt.

## Snel starten

```bash
cd bronwijzer
pip install -r requirements.txt
python server.py
```

Open daarna http://localhost:8000. Zonder server kun je ook `bronwijzer/index.html` openen.
Zoeken, bewijs en concept werken dan ook, maar de AI-functies en gedeelde uploads niet.

## Hoe het werkt

1. **Bronnen beheren:** upload doorzoekbare PDF's. De server bewaart het origineel en indexeert de tekst per pagina.
2. **Zoek passages:** een lokale, reproduceerbare BM25-zoekopdracht vindt letterlijke passages met document, status en pagina.
   Als er een taalmodel is ingesteld, stelt het alleen extra zoektermen voor. Het model ziet dan geen brontekst.
3. **Bevindingen:** de medewerker kiest passages en laat eventueel bevindingen formuleren.
   Elk citaat wordt gecontroleerd tegen de brontekst en onzekerheden blijven zichtbaar.
4. **Concept:** de medewerker krijgt een bewerkbaar antwoord in het Nederlands, met bronverwijzingen. Er is geen verzendknop.
5. **Logboek:** bronwijzigingen en goedgekeurde antwoorden worden bijgehouden, zodat alles herleidbaar blijft.

## Aansluiting bij de beoordelingscriteria

| Criterium | In Bronwijzer |
| --- | --- |
| Accurate antwoorden met bronnen | Letterlijke passages, pagina en link naar het origineel, citaatcontrole en zichtbare onzekerheid |
| Medewerker houdt de controle | Bevindingen bevestigen of corrigeren, concept bewerken, geen automatisch verzenden |
| Onderhoudbare, herleidbare kennis | Bronnen uploaden zonder technische hulp, logboek van wijzigingen en antwoorden, herbruikbaar voor elke gemeente |

## Taalmodel (optioneel)

Bij de eerste start vraagt de pagina om een OpenAI API-sleutel en een model. Beide worden opgeslagen in
`bronwijzer/settings.json`. Dat bestand staat in `.gitignore` en wordt nooit naar de browser gestuurd.
`OPENAI_API_KEY`, `OPENAI_MODEL` en `OPENAI_URL` in de omgeving worden ook ondersteund.

## Mapstructuur

| Pad | Inhoud |
| --- | --- |
| `bronwijzer/` | De applicatie. Technische details staan in [bronwijzer/README.md](bronwijzer/README.md) |
| `AP-starter-pack-2026-09-07/` | Starterbestanden van de hackathon (KBO-data en PDF's; bestanden met `HISTORICAL-` zijn niet meer geldig) |
| `agent.md` | Referentie over de hackathonregels |

## Beperkingen

- Het zoeken gebruikt trefwoorden, geen embeddings.
- Alleen doorzoekbare PDF's worden ondersteund (geen OCR).
- De collectie start leeg: upload eerst de bronnen die je wilt gebruiken.
- Dit is een lokaal prototype zonder gebruikersbeheer of authenticatie.
