const marketRegulationUrl = "https://www.schoten.be/sites/default/files/2024-03/GR%2028-03-2024_2000_Uittreksel%20in%20pdf_Marktreglement.pdf#page=5";
const feeRegulationUrl = "https://www.schoten.be/sites/default/files/public/documenten/Reglementen/Retributiereglementen%2026-31/Retributiereglement%20op%20de%20openbare%20markten%20en%20kermissen%202026-2031.pdf#page=1";

const defaultSources = [
  {
    id: "market",
    name: "Marktreglement Schoten 2024",
    sub: "Gemeenteraad van 28 maart 2024 · 11 pagina's",
    applicability: "Schoten · openbare markt · abonnement",
    status: "Opgenomen versie: in werking vanaf 1 april 2024",
    active: true,
    verified: true,
    type: "Gemeentelijk reglement",
  },
  {
    id: "fees",
    name: "Retributiereglement markten en kermissen 2026–2031",
    sub: "Gemeenteraad van 24 november 2025 · 2 pagina's",
    applicability: "Schoten · openbare markt · retributies",
    status: "Opgenomen versie: 1 jan. 2026 – 31 dec. 2031",
    active: true,
    verified: true,
    type: "Gemeentelijk retributiereglement",
  },
];

let sources = structuredClone(defaultSources);
let history = [];
let analysisFinished = false;
let reviewed = false;
let aiSuggestion = "";
const aiConfig = { connected: false, model: null, source: null };
let toastTimer;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 3200);
}

function activeSourceCount() {
  return sources.filter((source) => source.active && source.verified).length;
}

function renderSourceStatus() {
  const active = activeSourceCount();
  const totalReviewed = sources.filter((source) => source.verified).length;
  $("#sidebarActiveCount").textContent = `${active} actieve ${active === 1 ? "bron" : "bronnen"}`;
  const scope = $("#scopeActiveCount");
  scope.textContent = `${active} van ${totalReviewed} actief`;
  scope.className = `status-pill ${active === totalReviewed && active > 0 ? "good" : "caution"}`;
}

function renderSources() {
  const rows = $("#sourceRows");
  rows.innerHTML = sources.map((source) => `
    <tr>
      <td><span class="source-name">${escapeHtml(source.name)}</span><span class="source-sub">${escapeHtml(source.sub)}</span></td>
      <td><span class="source-status">${escapeHtml(source.applicability)}</span></td>
      <td>${source.verified
        ? `<span class="status-pill ${source.active ? "good" : "caution"}">${escapeHtml(source.status)}</span>`
        : `<span class="status-pill caution">Te beoordelen vóór gebruik</span>`}</td>
      <td><label class="toggle" title="Bron ${source.active ? "uitschakelen" : "inschakelen"}">
        <input type="checkbox" data-source-id="${source.id}" ${source.active ? "checked" : ""} ${source.verified ? "" : "disabled"} />
        <span class="toggle-slider"></span>
      </label></td>
    </tr>`).join("");
  $("#activeSourceCount").textContent = activeSourceCount();
  renderSourceStatus();
  $$("[data-source-id]").forEach((toggle) => toggle.addEventListener("change", (event) => {
    const source = sources.find((item) => item.id === event.target.dataset.sourceId);
    source.active = event.target.checked;
    renderSources();
    toast(`${source.name} is ${source.active ? "actief" : "uitgeschakeld"}.`);
    if (analysisFinished) renderResults();
  }));
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[char]);
}

function updateWorkflow() {
  const steps = [$("#step-findings"), $("#step-review"), $("#step-draft")];
  steps.forEach((step) => step.classList.remove("active", "done"));
  if (analysisFinished) {
    steps[0].classList.add("done");
    steps[1].classList.add("active");
  }
  if (reviewed) {
    steps[1].classList.remove("active");
    steps[1].classList.add("done");
    steps[2].classList.add("active");
  }
  $$(".workflow-line").forEach((line, index) => line.classList.toggle("done", (index === 0 && analysisFinished) || (index === 1 && reviewed)));
}

function updateAiInterface() {
  const status = $("#aiConnectionStatus");
  const connectButton = $("#connectAiButton");
  const disconnectButton = $("#disconnectAiButton");
  if (aiConfig.connected) {
    status.textContent = `Verbonden · ${aiConfig.model}`;
    status.className = "status-pill good";
    connectButton.textContent = "Modellen vernieuwen";
    disconnectButton.disabled = false;
  } else {
    status.textContent = "Demo zonder AI";
    status.className = "status-pill caution";
    connectButton.textContent = "Beschikbare modellen ophalen";
    disconnectButton.disabled = true;
  }
}

function activeEvidenceForAi() {
  const evidence = [];
  if (sources.find((source) => source.id === "market")?.active) {
    evidence.push({
      title: "Marktreglement Schoten 2024",
      location: "Art. 13 §3 · p. 5–6",
      text: "Een onderneming die een standplaats met abonnement wenst te bekomen, dient zich kandidaat te stellen door het invullen van het aanvraagformulier op de website van de gemeente Schoten, na melding van een vacature of op elk ander tijdstip. De aanvraag bevat naam en contactgegevens, KBO-uittreksel of ondernemingsnummer, producten of diensten en aantal kavels. De opgesomde bewijsstukken worden toegevoegd.",
    });
  }
  if (sources.find((source) => source.id === "fees")?.active) {
    evidence.push({
      title: "Retributiereglement openbare markten en kermissen 2026–2031",
      location: "Art. 4.1 en 6 · p. 1–2",
      text: "Het tarief voor de abonnementhouder of vaste markthandelaar is per marktdag 6,00 euro en halfjaarlijks 78,00 euro. De betaling dient te gebeuren binnen 30 dagen na verzending van de factuur.",
    });
  }
  return evidence;
}

async function requestAiSuggestion(question) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, model: aiConfig.model, sources: activeEvidenceForAi() }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "De OpenAI-aanvraag kon niet worden uitgevoerd.");
  return payload.answer;
}

function highlightSourceText(context, quote) {
  const start = context.indexOf(quote);
  if (start === -1) return escapeHtml(context);
  return `${escapeHtml(context.slice(0, start))}<mark>${escapeHtml(quote)}</mark>${escapeHtml(context.slice(start + quote.length))}`;
}

function formatAiSuggestion(text) {
  return escapeHtml(text)
    .replace(/\[Bron\s+(\d+)\]/gi, (_match, sourceNumber) => `<button type="button" class="citation-ref" data-evidence-ref="${sourceNumber}">Bron ${sourceNumber}</button>`)
    .replace(/\n/g, "<br>");
}

function evidenceCard({ sourceIndex, title, location, quote, context, url, applies }) {
  return `<article class="evidence-card" id="evidence-${sourceIndex}" data-evidence-card="${sourceIndex}">
    <div class="evidence-top"><span class="evidence-source">${title}</span><span class="evidence-location">${location}</span></div>
    <p class="quote">“${quote}”</p>
    <div class="evidence-actions"><button type="button" class="source-context-toggle" data-toggle-context="${sourceIndex}">Bekijk gemarkeerde broncontext</button><a class="source-link" href="${url}" target="_blank" rel="noopener">Open origineel op deze pagina ↗</a></div>
    <div class="source-context" id="context-${sourceIndex}" hidden><div class="source-context-label">BRONFRAGMENT · ${location}</div><p>${highlightSourceText(context, quote)}</p></div>
    <div class="applicability">
      <div class="applicability-item"><b>Past omdat</b><span>${applies}</span></div>
    </div>
  </article>`;
}

function renderResults() {
  const container = $("#resultsSection");
  const marketActive = sources.find((source) => source.id === "market")?.active;
  const feesActive = sources.find((source) => source.id === "fees")?.active;

  if (!analysisFinished) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⌁</div><div><strong>Klaar om de vraag te onderzoeken</strong><p>De analyse koppelt elke uitspraak aan een passage uit een actieve bron.</p></div></div>`;
    return;
  }

  if (!marketActive) {
    container.innerHTML = `<div class="results-layout"><section class="answer-card panel"><div class="answer-header"><div><p class="eyebrow">Bevinding</p><h2>Onvoldoende actieve bron voor de aanvraagprocedure</h2></div><span class="status-pill blocked">Geen antwoordvoorstel</span></div><p class="finding-intro">Het marktreglement, de enige actieve bron over het aanvragen van een standplaats per abonnement, is uitgeschakeld. De assistent doet daarom geen uitspraak over de procedure.</p><div class="uncertainty"><span>!</span><div><strong>Benodigde actie</strong>Schakel een gecontroleerde bron over de aanvraagprocedure in of controleer de actuele regelgeving buiten deze bronset.</div></div></section><aside class="evidence-panel panel"><p class="eyebrow">Zoekresultaat</p><h2>Geen passende onderbouwing</h2><p>Er is geen toegestane passage die de klantvraag beantwoordt.</p></aside></div>`;
    updateWorkflow();
    return;
  }

  const feeFinding = feesActive ? `<div class="finding"><p class="finding-label">Kosten</p><p>Voor een abonnementhouder bedraagt de retributie €6,00 per marktdag of €78,00 per halfjaar, per ondeelbare kavel van 3 meter. Betaling gebeurt binnen 30 dagen na verzending van de factuur.</p></div>` : "";
  const feeEvidence = feesActive ? evidenceCard({
    sourceIndex: 2,
    title: "Retributiereglement markten en kermissen",
    location: "Art. 4.1 · p. 1",
    quote: "Het tarief voor de abonnementhouder of vaste markthandelaar is: Per marktdag: 6,00 euro; Halfjaarlijks: 78,00 euro.",
    context: "Artikel 4.1 - Openbare markten\nDe retributie wordt berekend per onverdeelbare kavel van 3 meter gevellengte op maximum 2,5 meter diepte. Het tarief voor de abonnementhouder of vaste markthandelaar is: Per marktdag: 6,00 euro; Halfjaarlijks: 78,00 euro. Voor de abonnementhouder, vast of losse markthandelaar is de retributie inclusief het gebruik van de verdeelkast elektriciteit op het openbaar domein.",
    url: feeRegulationUrl,
    applies: "gemeentelijke retributie voor abonnementhouders op de openbare markt van Schoten; opgenomen geldigheid 2026–2031."
  }) : "";

  const aiProposal = aiSuggestion ? `<div class="ai-proposal"><p class="finding-label">AI-concept · ${escapeHtml(aiConfig.model || "lokaal")}</p><p>${formatAiSuggestion(aiSuggestion)}</p><small>Gebruik de bronlabels om de gemarkeerde passage te openen. Controleer elk detail vóór gebruik.</small></div>` : "";

  container.innerHTML = `<div class="results-layout">
    <section class="answer-card panel">
      <div class="answer-header"><div><p class="eyebrow">Voorgestelde bevinding</p><h2>Een aanvraag kan via het formulier van de gemeente Schoten.</h2></div><span class="status-pill good">Brononderbouwd</span></div>
      <p class="finding-intro">Voor een <b>vaste standplaats per abonnement</b> kan de ondernemer zich kandidaat stellen na een vacature of op elk ander moment. De aanvraag loopt via het formulier op de website van de gemeente.</p>
      ${aiProposal}
      <div class="finding-list">
        <div class="finding"><p class="finding-label">Aanvraag</p><p>Vul het aanvraagformulier in en vermeld onder meer identiteits- en contactgegevens, KBO-uittreksel of ondernemingsnummer, aangeboden producten of diensten en het aantal gewenste kavels.</p></div>
        <div class="finding"><p class="finding-label">Bijlagen</p><p>Voeg de opgesomde bewijsstukken toe, zoals KBO-inschrijving, verzekeringsattesten en - wanneer van toepassing - FAVV-, elektriciteits-, gas- en brandblusattesten.</p></div>
        ${feeFinding}
      </div>
      <div class="uncertainty"><span>!</span><div><strong>Nog door de medewerker te controleren</strong>Deze bronset bevestigt de procedure en tarieven in de opgenomen versies. Controleer vóór communicatie of de actuele gemeentelijke webpagina, vacature of productspecifieke voorwaarden bijkomende informatie bevatten.</div></div>
      <div class="review-controls">
        <button class="primary-button" id="approveFinding">✓ Bevinding gecontroleerd</button>
        <button class="secondary-button" id="correctFinding">✎ Correctie noteren</button>
        <span class="review-state">${reviewed ? "Beoordeling geregistreerd" : "Nog niet goedgekeurd"}</span>
      </div>
    </section>
    <aside class="evidence-panel panel">
      <p class="eyebrow">Bewijs · ${feesActive ? "2" : "1"} passages</p>
      <h2>Controleer de context</h2>
      <p>Elke regel hierboven is verbonden met een passage uit de actieve bronset.</p>
      ${evidenceCard({
        sourceIndex: 1,
        title: "Marktreglement Schoten 2024",
        location: "Art. 13 §3 · p. 5–6",
        quote: "Een onderneming die een standplaats met abonnement wenst te bekomen, dient zich kandidaat te stellen door het invullen van het aanvraagformulier op de website van de gemeente Schoten, na melding van een vacature of op elk ander tijdstip.",
        context: "Artikel 13 - Vacature en kandidatuurstelling standplaats met abonnement\n§3. Een onderneming die een standplaats met abonnement wenst te bekomen, dient zich kandidaat te stellen door het invullen van het aanvraagformulier op de website van de gemeente Schoten, na melding van een vacature of op elk ander tijdstip. De aanvraag dient de volgende gegevens te bevatten: naam, voornaam, adres, telefoonnummer en e-mailadres; in voorkomend geval de handelsnaam; een uittreksel uit de Kruispuntbank van Ondernemingen (of ondernemingsnummer); een omschrijving van de producten of diensten; en het gevraagde aantal kavels. Bij de aanvraag dienen de voorgeschreven documenten toegevoegd te worden.",
        url: marketRegulationUrl,
        applies: "gemeentelijk reglement voor de openbare markt van Schoten; de klant vraagt een standplaats met abonnement."
      })}
      ${feeEvidence}
    </aside>
  </div>
  <section class="draft-panel panel ${reviewed ? "" : "hidden"}" id="draftPanel">
    <div class="draft-heading"><div><p class="eyebrow">Conceptantwoord · niet verzonden</p><h2>Medewerker bewerkt vóór gebruik</h2></div><span class="status-pill caution">Menselijke goedkeuring vereist</span></div>
    <label class="sr-only" for="replyDraft">Conceptantwoord aan klant</label>
    <textarea id="replyDraft" rows="9">Beste,

Voor een vaste standplaats op de openbare markt van Schoten kunt u zich kandidaat stellen via het aanvraagformulier op de website van de gemeente. Dat kan na een gemelde vacature of op een ander moment.

Bij de aanvraag vermeldt u uw contactgegevens, ondernemingsnummer of KBO-uittreksel, de producten of diensten die u wilt aanbieden en het aantal gewenste kavels. Voeg ook de toepasselijke bewijsstukken toe, zoals de vereiste verzekerings- en, indien relevant, FAVV- of technische attesten.

De retributie voor een abonnementhouder bedraagt volgens het opgenomen retributiereglement €6,00 per marktdag of €78,00 per halfjaar per kavel van 3 meter.

Met vriendelijke groeten,
Dienst lokale economie</textarea>
    <div class="draft-actions"><span class="send-disabled">Verzenden is bewust niet beschikbaar in BronWijzer.</span><button class="secondary-button" id="saveDraft">Concept opslaan</button></div>
  </section>`;

  $("#approveFinding").addEventListener("click", () => {
    reviewed = true;
    renderResults();
    updateWorkflow();
    toast("Beoordeling vastgelegd. U kunt het concept nu aanpassen.");
  });
  $("#correctFinding").addEventListener("click", () => {
    const note = window.prompt("Welke correctie of controle wil u registreren?");
    if (note?.trim()) {
      history.unshift({ question: $("#questionInput").value, decision: `Correctie genoteerd: ${note.trim()}`, sources: activeSourceCount() });
      renderHistory();
      toast("Correctie is opgeslagen in de antwoordgeschiedenis.");
    }
  });
  $("#saveDraft")?.addEventListener("click", () => {
    history.unshift({ question: $("#questionInput").value, decision: "Conceptantwoord opgeslagen na medewerkerbeoordeling", sources: activeSourceCount() });
    renderHistory();
    toast("Concept opgeslagen. Er is niets verzonden.");
  });
  $$("[data-toggle-context]").forEach((button) => button.addEventListener("click", () => {
    const context = $(`#context-${button.dataset.toggleContext}`);
    const open = context.hidden;
    context.hidden = !open;
    button.textContent = open ? "Verberg broncontext" : "Bekijk gemarkeerde broncontext";
  }));
  $$("[data-evidence-ref]").forEach((button) => button.addEventListener("click", () => {
    const card = $(`#evidence-${button.dataset.evidenceRef}`);
    if (!card) return;
    card.classList.remove("citation-focus");
    void card.offsetWidth;
    card.classList.add("citation-focus");
    card.scrollIntoView({ behavior: "smooth", block: "center" });
  }));
  updateWorkflow();
}

function renderHistory() {
  const list = $("#historyList");
  if (!history.length) {
    list.innerHTML = `<div class="history-empty">Nog geen bewaarde beoordelingen. Een goedgekeurde bevinding of opgeslagen concept verschijnt hier samen met de gebruikte bronset.</div>`;
    return;
  }
  list.innerHTML = history.map((entry) => `<article class="history-entry"><div><h3>${escapeHtml(entry.decision)}</h3><p>${escapeHtml(entry.question)}</p></div><div class="history-date">${entry.sources} actieve bron${entry.sources === 1 ? "" : "nen"}<br>Vandaag · lokaal bewaard</div></article>`).join("");
}

function showView(viewName) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${viewName}`));
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === viewName));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetDemo() {
  sources = structuredClone(defaultSources);
  history = [];
  analysisFinished = false;
  reviewed = false;
  aiSuggestion = "";
  $("#questionInput").value = "Ik wil een vaste standplaats op de markt in Schoten. Hoe dien ik een aanvraag in?";
  renderSources();
  renderHistory();
  renderResults();
  updateWorkflow();
  toast("Demo hersteld naar de gecontroleerde bronset.");
}

$("#analyzeButton").addEventListener("click", () => {
  const button = $("#analyzeButton");
  const question = $("#questionInput").value.trim();
  if (!question) {
    toast("Voer eerst een klantvraag in.");
    return;
  }
  button.disabled = true;
  button.innerHTML = "<span aria-hidden=\"true\">⋯</span> Bronnen controleren";
  const completeAnalysis = () => {
    analysisFinished = true;
    reviewed = false;
    button.disabled = false;
    button.innerHTML = "<span aria-hidden=\"true\">✦</span> Analyseer binnen deze bronset";
    renderResults();
    $("#resultsSection").scrollIntoView({ behavior: "smooth", block: "start" });
    toast("Analyse klaar. Controleer de onderbouwing vóór gebruik.");
  };
  aiSuggestion = "";
  if (!aiConfig.connected) {
    setTimeout(completeAnalysis, 720);
    return;
  }
  button.innerHTML = "<span aria-hidden=\"true\">⋯</span> AI gebruikt actieve passages";
  requestAiSuggestion(question).then((answer) => {
    aiSuggestion = answer;
    completeAnalysis();
  }).catch((error) => {
    button.disabled = false;
    button.innerHTML = "<span aria-hidden=\"true\">✦</span> Analyseer binnen deze bronset";
    toast(error.message);
  });
});

$$(".nav-item").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
$$("[data-view-target]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.viewTarget)));
$("#resetDemo").addEventListener("click", resetDemo);
$("#addSourceButton").addEventListener("click", () => $("#sourceUpload").click());
$("#sourceUpload").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  sources.push({
    id: `upload-${Date.now()}`,
    name: file.name.replace(/\.pdf$/i, ""),
    sub: `${Math.max(1, Math.round(file.size / 1024))} KB · lokaal toegevoegd`,
    applicability: "Nog niet ingevuld",
    status: "Te beoordelen vóór gebruik",
    active: false,
    verified: false,
    type: "Nieuw document",
  });
  event.target.value = "";
  renderSources();
  toast("Bestand toegevoegd als 'te beoordelen'. Het kan nog geen antwoord onderbouwen.");
});
$("#openAbout").addEventListener("click", () => $("#aboutDialog").showModal());
$("#closeAbout").addEventListener("click", () => $("#aboutDialog").close());
$("#closeAboutButton").addEventListener("click", () => $("#aboutDialog").close());

$("#toggleKeyVisibility").addEventListener("click", () => {
  const field = $("#apiKeyInput");
  const visible = field.type === "text";
  field.type = visible ? "password" : "text";
  $("#toggleKeyVisibility").textContent = visible ? "Toon" : "Verberg";
});

$("#connectAiButton").addEventListener("click", async () => {
  const button = $("#connectAiButton");
  const key = $("#apiKeyInput").value.trim();
  button.disabled = true;
  button.textContent = "Project controleren…";
  try {
    const response = await fetch("/api/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(key ? { apiKey: key } : {}),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Verbinding mislukt.");
    const select = $("#modelSelect");
    select.innerHTML = payload.models.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join("");
    select.disabled = false;
    select.value = payload.defaultModel;
    aiConfig.connected = true;
    aiConfig.model = payload.defaultModel;
    aiConfig.source = payload.source;
    $("#apiKeyInput").value = "";
    $("#modelHelp").textContent = `${payload.models.length} beschikbare tekstmodellen geladen. De geselecteerde keuze wordt alleen in deze browsersessie bijgehouden.`;
    updateAiInterface();
    toast(`OpenAI verbonden via ${payload.source === "environment" ? "serveromgeving" : "lokaal servergeheugen"}.`);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    updateAiInterface();
  }
});

$("#modelSelect").addEventListener("change", (event) => {
  aiConfig.model = event.target.value;
  updateAiInterface();
  toast(`Model ingesteld op ${aiConfig.model}.`);
});

$("#disconnectAiButton").addEventListener("click", async () => {
  try { await fetch("/api/disconnect", { method: "POST" }); } catch { /* The local demo stays usable without an AI connection. */ }
  aiConfig.connected = false;
  aiConfig.model = null;
  aiConfig.source = null;
  const select = $("#modelSelect");
  select.innerHTML = "<option>Verbind eerst een OpenAI-project</option>";
  select.disabled = true;
  $("#modelHelp").textContent = "BronWijzer vraagt de actuele modellenlijst op via de lokale server. Een modelkeuze geldt alleen voor deze browsersessie.";
  updateAiInterface();
  toast("Lokale AI-verbinding gewist. De brononderbouwde demo blijft beschikbaar.");
});

renderSources();
renderHistory();
renderResults();
updateWorkflow();
updateAiInterface();
