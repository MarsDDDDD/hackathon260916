(function(){
"use strict";
const BASE = window.CORPUS || {docs:[],chunks:[]};
const $ = (s)=>document.querySelector(s);
const esc = (s)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const now = ()=>new Date().toISOString();
const fmt = (iso)=>{try{return new Date(iso).toLocaleString("nl-BE",{dateStyle:"short",timeStyle:"short"})}catch(e){return iso}};

/* ---------- local convenience storage ---------- */
const LS = {
  get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
};
$("#who").value = LS.get("bw.who","");
$("#who").addEventListener("input",e=>LS.set("bw.who",e.target.value));
const who = ()=> $("#who").value.trim() || "onbekende medewerker";

/* ---------- state ---------- */
let overrides = {};          // docId -> meta patch
let added = [];              // {meta, chunks}
let answers = [];            // log
let srcLog = [];
let db = null, sample = null;
let results = [];            // current evidence [{chunk, score}]
let findings = [];           // [{id,text,cites:[chunkId],quote,status,verified}]
let focusId = null;
let currentQuery = "";
let queryPlanTerms = [];     // model-suggested retrieval aids, never evidence
let searchPlanning = false;
let searchCtl = null;
let searchSeq = 0;

function docs(){
  const base = BASE.docs.map(d=>Object.assign({}, d, overrides[d.id]||{}));
  return base.concat(added.map(a=>Object.assign({}, a.meta, overrides[a.meta.id]||{})));
}
function docById(id){ return docs().find(d=>d.id===id); }
function allChunks(){ return BASE.chunks.concat(...added.map(a=>a.chunks)); }

/* ---------- retrieval (BM25, Dutch-light) ---------- */
const STOP = new Set("de het een en of in op aan van voor met om te is zijn wordt worden dat die dit deze er ik wil je jij u uw mijn we wij hoe wat wie waar wanneer welke moet moeten kan kunnen mag hij zij ze als bij tot door naar ook niet geen dan nog wel zo al over uit".split(" "));
const SYN = {
  "vast":["abonnement","abonnementhouder"], "vaste":["abonnement","abonnementhouder"],
  "aanvraag":["kandidaat","aanvraagformulier","kandidatuurstelling"], "aanvragen":["kandidaat","aanvraagformulier","kandidatuurstelling"], "indien":["aanvraag","aanvraagformulier"],
  "kost":["retributie","tarief"], "kosten":["retributie","tarief"], "prijs":["retributie","tarief"], "betalen":["retributie","betaling"],
  "kraam":["standplaats","kavel"], "marktkraam":["standplaats","kavel"], "plaats":["standplaats"],
  "terras":["terrassen","horecaterras"], "sluitingsuur":["sluitingsuur","openingsuren"], "uithangbord":["uitstalling","publicitaire"],
  "subsidie":["subsidiereglement","innovatiefonds"], "starten":["start","onderneming"], "voeding":["favv","voedselveiligheid"], "eten":["voeding","favv"]
};
function stem(w){
  w = w.toLowerCase();
  if (w.length>6 && /(heden|ingen)$/.test(w)) w = w.replace(/(heden|ingen)$/,"");
  else if (w.length>5 && /en$/.test(w)) w = w.slice(0,-2);
  else if (w.length>4 && /[sn]$/.test(w)) w = w.slice(0,-1);
  if (w.length>4 && /e$/.test(w)) w = w.slice(0,-1);
  return w;
}
function tokens(s){ return (s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").match(/[a-z0-9]+/g)||[]); }
let index = null;
function buildIndex(){
  const ch = allChunks(); const df = new Map(); const docsTok = [];
  let total = 0;
  for (const c of ch){
    const tf = new Map();
    const toks = tokens(c.label+" "+(c.title||"")+" "+c.text).filter(t=>!STOP.has(t)).map(stem);
    for (const t of toks) tf.set(t,(tf.get(t)||0)+1);
    for (const t of tf.keys()) df.set(t,(df.get(t)||0)+1);
    docsTok.push({c, tf, len:toks.length}); total += toks.length;
  }
  index = {docsTok, df, N:ch.length, avg: total/Math.max(1,ch.length)};
}
function splitCompound(t){
  if (!index || index.df.has(stem(t)) || t.length<9) return [t];
  for (let i=4;i<=t.length-4;i++){ const a=t.slice(0,i);
    for (const b of [t.slice(i), t.slice(i).replace(/^s(?=.{4})/,"")])
      if (index.df.has(stem(a)) && index.df.has(stem(b))) return [a,b,t]; }
  return [t];
}
function queryTerms(q){
  const base = tokens(q).filter(t=>!STOP.has(t)).flatMap(splitCompound);
  const out = new Map();
  for (const t of base){ out.set(stem(t),1); for (const s of (SYN[t]||[])) if(!out.has(stem(s))) out.set(stem(s),0.6); }
  return out;
}
function retrievalTerms(q, expansions=[]){
  const out = queryTerms(q);                                      // the officer's question stays primary
  for (const expansion of expansions){
    for (const [t,w] of queryTerms(expansion)){
      if (!out.has(t)) out.set(t, Math.min(0.45, w*0.45));         // AI terms can broaden, not dominate, ranking
    }
  }
  return out;
}
function search(q, inclHist, expansions=[]){
  if (!index) buildIndex();
  const terms = retrievalTerms(q, expansions); const k1=1.3, b=0.72; const scored=[];
  for (const {c,tf,len} of index.docsTok){
    const d = docById(c.doc); if (!d || d.active===false) continue;
    if (d.status==="historisch" && !inclHist) continue;
    let s=0;
    for (const [t,w] of terms){
      const f = tf.get(t); if(!f) continue;
      const idf = Math.log(1+(index.N-(index.df.get(t)||0)+.5)/((index.df.get(t)||0)+.5));
      s += w*idf*(f*(k1+1))/(f+k1*(1-b+b*len/index.avg));
    }
    if (s>0){
      const head = new Set(tokens(c.label+" "+(c.title||"")).map(stem));
      let hm=0; for (const [t,w] of terms) if (head.has(t)) hm+=w;
      s *= 1 + 0.35*Math.min(hm,3);                                  // heading matches the question
      if (/^definities/i.test(c.title||"")) s*=0.55;                  // definitions support, rarely answer
      if (d.status==="historisch") s*=0.6;
      scored.push({c,score:s});
    }
  }
  scored.sort((a,b)=>b.score-a.score);
  return {hits:scored.slice(0,7), terms:[...terms.keys()]};
}

/* ---------- rendering helpers ---------- */
function statusTag(d){
  const s = d.status;
  if (s==="te beoordelen") return '<span class="tag plain">Te beoordelen</span>';
  if (s==="historisch") return '<span class="tag bad">Historisch</span>';
  if (s==="ongedateerd") return '<span class="tag warn">Ongedateerd</span>';
  if (s==="richtlijn" || d.type==="richtlijn") return '<span class="tag warn">Richtlijn, geen regelgeving</span>';
  if (d.type==="eerder antwoord") return '<span class="tag warn">Eerder antwoord</span>';
  return '<span class="tag ok">'+esc(s||"van kracht")+'</span>';
}
function srcLink(d, page){
  if (d.url) return `<a href="${esc(d.url)}#page=${page}" target="_blank" rel="noopener">Open origineel, p. ${page}</a>`;
  return `<span class="tag plain" title="Voeg de link toe bij Bronnen beheren">Geen link naar origineel</span>`;
}
function cite(c){
  const d = docById(c.doc)||{};
  const p = c.pages && c.pages.length>1 ? `p. ${c.pages[0]}–${c.pages[c.pages.length-1]}` : `p. ${c.page}`;
  return `${d.short||d.title||c.doc}${c.label?", "+c.label:""}, ${p}`;
}
function normWS(s){ return s.replace(/-\s*\n\s*/g,"-").replace(/\s+/g," ").trim(); }
function highlight(text, terms, quote){
  let html = esc(normWS(text).replace(/ (?=- )/g,"\n").replace(/ (?=§\d)/g,"\n"));
  if (quote){
    const qn = esc(normWS(quote));
    const i = html.replace(/\n/g," ").indexOf(qn);
    if (i>=0) html = html.slice(0,i)+'<mark class="q">'+html.slice(i,i+qn.length)+'</mark>'+html.slice(i+qn.length);
  }
  if (terms && terms.length){
    const re = new RegExp("(^|[^\\p{L}])("+terms.filter(t=>t.length>2).map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|")+")(\\p{L}*)","giu");
    html = html.split(/(<[^>]+>)/).map(part=> part.startsWith("<")?part:part.replace(re,(m,a,b,c)=>a+"<mark>"+b+c+"</mark>")).join("");
  }
  return html;
}
const chunkById = (id)=> allChunks().find(c=>c.id===id);

/* ---------- evidence panel ---------- */
let lastTerms = [];
function renderEvidence(){
  const box = $("#evidence");
  if (!results.length){ box.innerHTML = '<p class="empty">Geen passages gevonden binnen deze bronnen. Zet historische documenten aan, controleer de vraag, of voeg een bron toe.</p>'; $("#levels").innerHTML=""; return; }
  const lv = {}; results.forEach(r=>{const d=docById(r.c.doc); lv[d.level]=(lv[d.level]||0)+1;});
  $("#levels").innerHTML = ["gemeentelijk","provinciaal","Vlaams","federaal"].map(l=>`<span class="tag ${lv[l]?"plain":"plain"}" style="${lv[l]?"":"opacity:.45"}">${l}: ${lv[l]||0}</span>`).join("");
  const top = results[0].score; const noted = new Set();
  box.innerHTML = results.map(r=>{
    const c=r.c, d=docById(c.doc);
    const f = findings.find(x=>x.id===focusId);
    const q = f && f.cites.includes(c.id) ? f.quote : "";
    const used = findings.some(x=>x.cites.includes(c.id) && x.status!=="no");
    const rel = r.score/top;
    return `<article class="pass${q?" focus":""}" id="ev-${esc(c.id)}">
      <div class="sect" aria-hidden="true">${c.label&&c.label.includes("§")?"§":"¶"}</div>
      <div>
        <div class="meta"><b>${esc(d.short||d.title)}</b><span>${esc(c.label||"passage")}${c.title?" · "+esc(c.title):""}</span><span>${c.pages.length>1?`p. ${c.pages[0]}–${c.pages[c.pages.length-1]}`:"p. "+c.page}</span></div>
        <div class="meta" style="margin-top:3px">${statusTag(d)}<span class="tag plain">${esc(d.level)}</span><span class="tag plain">${esc(d.date||"datum onbekend")}</span>${rel<0.35?'<span class="tag warn">zwakke overeenkomst</span>':""}</div>
        <blockquote>${highlight(c.text, lastTerms, q)}</blockquote>
        <div class="acts">
          <button class="linkish" data-expand>Toon volledige passage</button>
          ${srcLink(d,c.page)}
          <button class="btn ghost small" data-adopt="${esc(c.id)}">${used?"Al gebruikt in bevinding":"Neem over als bevinding"}</button>
        </div>
        ${d.note && !noted.has(d.id) && noted.add(d.id)?`<p class="note">${esc(d.note)}</p>`:""}
      </div></article>`;
  }).join("");
}
$("#evidence").addEventListener("click",e=>{
  const x = e.target.closest("[data-expand]");
  if (x){ const bq = x.closest("article").querySelector("blockquote"); bq.classList.toggle("open"); x.textContent = bq.classList.contains("open")?"Toon minder":"Toon volledige passage"; return; }
  const a = e.target.closest("[data-adopt]");
  if (a){
    const c = chunkById(a.dataset.adopt);
    findings.push({id:"f"+Date.now(), text:"", cites:[c.id], quote:firstSentence(c.text), status:"edit", verified:true, origin:"medewerker"});
    focusId = findings[findings.length-1].id;
    renderAll();
  }
});
function firstSentence(t){ const s = normWS(t).split(/(?<=[.;:])\s+/); return s.slice(0,2).join(" ").slice(0,400); }

/* ---------- uncertainty ---------- */
function renderUncert(){
  const out = [];
  if (!results.length){ $("#uncert").innerHTML=""; return; }
  const usedDocs = new Set(findings.filter(f=>f.status!=="no").flatMap(f=>f.cites.map(id=>(chunkById(id)||{}).doc)));
  const consider = usedDocs.size ? [...usedDocs] : [...new Set(results.map(r=>r.c.doc))];
  for (const id of consider){
    const d = docById(id); if(!d) continue;
    if (d.status==="historisch") out.push(`<b>${esc(d.short)}</b> is historisch: geen bewijs van de huidige regels.`);
    if (d.status==="te beoordelen") out.push(`<b>${esc(d.short)}</b> is nieuw geüpload en nog te beoordelen: gebruik het niet als bevestiging van de huidige regels.`);
    if (d.status==="ongedateerd") out.push(`<b>${esc(d.short)}</b> is ongedateerd: controleer of dit de geldende versie is.`);
    if (d.type==="richtlijn") out.push(`<b>${esc(d.short)}</b> is een richtlijn, geen regelgeving.`);
    if (!d.url) out.push(`Voor <b>${esc(d.short)}</b> ontbreekt een link naar het origineel.`);
  }
  const unver = findings.filter(f=>f.status!=="no" && !f.verified);
  if (unver.length) out.push(`${unver.length} bevinding(en) bevatten een citaat dat niet letterlijk in de bron staat. Controleer die eerst.`);
  const lv = new Set(results.map(r=>docById(r.c.doc).level));
  const missing = ["gemeentelijk","provinciaal","Vlaams","federaal"].filter(l=>!lv.has(l));
  if (missing.length) out.push(`Geen passages gevonden op niveau: ${missing.join(", ")}. Dat kan betekenen dat de collectie daar onvolledig is, niet dat er geen regels zijn.`);
  if (results[0] && results[0].score<3) out.push("Alle passages scoren laag. Mogelijk behandelt de collectie deze vraag niet.");
  if (/markt/i.test(currentQuery) && results.some(r=>r.c.doc==="markt")) out.push("Het marktplan en de quotalijst per productgroep zijn bijlagen die niet in de collectie zitten.");
  $("#uncert").innerHTML = out.length? `<div class="warnbox"><b>Onzekerheid en toepasselijkheid</b><ul>${out.map(x=>"<li>"+x+"</li>").join("")}</ul></div>`:"";
}

/* ---------- findings ---------- */
function renderFindings(){
  const box = $("#findings");
  if (!findings.length){ box.innerHTML = results.length? '<p class="empty">Nog geen bevindingen. Laat ze opstellen of neem een passage over.</p>':'<p class="empty">Zoek eerst passages. Daarna kunt u bevindingen laten opstellen of zelf passages als bevinding overnemen.</p>'; return; }
  box.innerHTML = findings.map((f,i)=>{
    const cls = f.status==="ok"?"st-ok":f.status==="no"?"st-no":f.status==="edit"?"st-edit":"";
    const label = f.status==="ok"?'<span class="tag ok">Bevestigd</span>':f.status==="no"?'<span class="tag bad">Verworpen</span>':f.status==="edit"?'<span class="tag warn">Te controleren</span>':'<span class="tag plain">Voorstel</span>';
    const ver = f.verified? '<span class="tag ok">Citaat letterlijk teruggevonden</span>' : '<span class="tag bad">Citaat niet teruggevonden in bron</span>';
    return `<div class="find ${cls}" data-f="${esc(f.id)}">
      <div class="meta" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${label}${ver}<span class="tag plain">${f.origin==="model"?"opgesteld door het taalmodel":f.origin==="extract"?"letterlijk overgenomen":"door medewerker"}</span></div>
      ${f.status==="edit"
        ? `<label class="note" for="ft-${i}">Bevinding (in gewone taal)</label><textarea id="ft-${i}" data-text>${esc(f.text)}</textarea>
           <label class="note" for="fq-${i}">Letterlijk citaat uit de bron</label><textarea id="fq-${i}" data-quote>${esc(f.quote)}</textarea>`
        : `<p>${esc(f.text)||"<i>(nog geen tekst)</i>"}</p><p class="note">“${esc(f.quote)}”</p>`}
      <div class="cites">Bron: ${f.cites.map(id=>{const c=chunkById(id);return c?`<button class="linkish" data-focus="${esc(f.id)}">${esc(cite(c))}</button>`:esc(id)+" (onbekend)"}).join("; ")}</div>
      <div class="acts">
        ${f.status==="edit"?'<button class="btn small" data-act="save">Opslaan en bevestigen</button>':'<button class="btn small" data-act="ok">Bevestigen</button><button class="btn ghost small" data-act="edit">Aanpassen</button>'}
        <button class="btn ghost small" data-act="no">Verwerpen</button>
      </div></div>`;
  }).join("");
}
$("#findings").addEventListener("click",e=>{
  const card = e.target.closest("[data-f]"); if(!card) return;
  const f = findings.find(x=>x.id===card.dataset.f);
  if (e.target.closest("[data-focus]")){ focusId=f.id; renderEvidence(); const el=document.getElementById("ev-"+f.cites[0]); if(el) el.scrollIntoView({block:"nearest",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"}); return; }
  const act = e.target.dataset.act; if(!act) return;
  if (act==="save"){
    f.text = card.querySelector("[data-text]").value.trim();
    f.quote = card.querySelector("[data-quote]").value.trim();
    f.verified = verifyQuote(f.quote, f.cites);
    f.status = f.verified ? "ok" : "edit";
    if (!f.verified) $("#aiStatus").textContent = "Het citaat komt niet letterlijk voor in de passage. Kopieer het exact uit het bewijs.";
    else $("#aiStatus").textContent = "";
  } else f.status = act;
  focusId = f.id; renderAll(); if (act!=="edit") buildDraft();
});
function verifyQuote(q, ids){
  if (!q) return false;
  // PDF extraction often joins a list bullet to the preceding colon (":-de") while
  // the model preserves a space (": -de"). Treat only that layout detail as neutral.
  const n = (s)=>normWS(s).toLowerCase().replace(/[“”"']/g,"").replace(/([:;])\s*-\s*/g,"$1 - ");
  return ids.some(id=>{const c=chunkById(id); return c && n(c.text).includes(n(q));});
}

/* ---------- drafting ---------- */
function extractive(){
  const terms = lastTerms;
  findings = results.slice(0,4).map((r,i)=>{
    const sents = normWS(r.c.text).replace(/^I?\s*(Artikel|Art\.)\s*[\d.]+\s*[:.\-–]?\s*[^.]{0,80}?(?=\s[A-Z§])/,"").split(/(?<=[.;])\s+(?=[A-Z§-])/);
    let best = sents[0], bs=-1;
    for (const s of sents){ const t=tokens(s).map(stem); const sc = t.filter(x=>terms.includes(x)).length/Math.sqrt(t.length+1); if (sc>bs){bs=sc;best=s;} }
    return {id:"x"+i+Date.now(), text:"", cites:[r.c.id], quote:best.slice(0,500), status:"edit", verified:true, origin:"extract"};
  });
  $("#aiStatus").textContent = "Kernzinnen overgenomen. Schrijf bij elke bevinding kort wat die betekent voor de ondernemer.";
  renderAll();
}
let ctl = null;
async function aiDraft(){
  if (!sample || !results.length) return;
  const passages = results.slice(0,6).map(r=>{const d=docById(r.c.doc);return {id:r.c.id, bron:cite(r.c), status:d.status, soort:d.type, niveau:d.level, datum:d.date, tekst:normWS(r.c.text)};});
  const prompt = `Je helpt een medewerker lokale economie een vraag van een ondernemer te beantwoorden.
Gebruik UITSLUITEND de passages hieronder. Verzin niets. Als de passages iets niet beantwoorden, zet dat bij "onzeker".
Regels:
- Schrijf in eenvoudig Nederlands, per bevinding 1 à 2 zinnen.
- Elke bevinding verwijst naar 1 of meer passage-id's uit de lijst.
- "citaat" is een LETTERLIJK stuk tekst (max. 40 woorden) uit de eerste passage die je noemt, exact gekopieerd.
- Historische of ongedateerde passages of richtlijnen mag je alleen gebruiken als je dat in de bevinding zegt.
- Maximaal 5 bevindingen.
Antwoord met alleen JSON: {"bevindingen":[{"tekst":"...","bronnen":["id"],"citaat":"..."}],"onzeker":["..."]}

VRAAG: ${$("#q").value.trim()}

PASSAGES:
${JSON.stringify(passages,null,1)}`;
  ctl = new AbortController();
  $("#draftAI").disabled = true; $("#stopAI").hidden = false;
  $("#aiStatus").textContent = "Het taalmodel leest de passages… (dit kan tot een minuut duren)";
  try{
    const out = await sample.json(prompt,{signal:ctl.signal, modelTier:"default"});
    const ids = new Set(passages.map(p=>p.id));
    findings = (out.bevindingen||[]).map((b,i)=>{
      const cites = (b.bronnen||[]).filter(id=>ids.has(id));
      return {id:"a"+i+Date.now(), text:String(b.tekst||""), cites, quote:String(b.citaat||""), status: cites.length? "new":"edit", verified: cites.length? verifyQuote(String(b.citaat||""), cites):false, origin:"model"};
    }).filter(f=>f.cites.length);
    const extra = (out.onzeker||[]).map(String);
    $("#aiStatus").innerHTML = extra.length? "Het model meldt als onzeker: "+extra.map(esc).join(" · ") : "Klaar. Controleer elke bevinding tegen het bewijs.";
  }catch(e){
    const m = {cancelled:"Gestopt.", not_granted:"Er is nog geen taalmodel ingesteld. Gebruik de letterlijke kernzinnen of stel er een in.", rate_limited:"Te veel verzoeken of tegoed op. Probeer het over een minuut opnieuw.", invalid_json:"Het antwoord had geen bruikbaar formaat. Probeer opnieuw."};
    $("#aiStatus").textContent = (e&&e.message) || m[e&&e.code] || "Opstellen mislukt. Gebruik de letterlijke kernzinnen of probeer opnieuw.";
  }finally{
    $("#draftAI").disabled = false; $("#stopAI").hidden = true; renderAll();
  }
}
$("#stopAI").onclick = ()=>ctl && ctl.abort();
$("#draftAI").onclick = aiDraft;
$("#draftX").onclick = ()=>{ if(!results.length){$("#aiStatus").textContent="Zoek eerst passages.";return;} extractive(); };

function buildDraft(){
  const ok = findings.filter(f=>f.status==="ok");
  if (!ok.length){ $("#draft").value=""; return; }
  const q = $("#q").value.trim();
  const lines = ok.map(f=>{
    const c = chunkById(f.cites[0]);
    return `${f.text?f.text+" ":""}${c?`Volgens ${cite(c)}:`:""} “${f.quote}”`;
  });
  const srcs = [...new Set(ok.flatMap(f=>f.cites))].map(id=>{const c=chunkById(id), d=docById(c.doc);return `- ${cite(c)}${d.url?` – ${d.url}#page=${c.page}`:""}`;});
  $("#draft").value =
`Beste [naam],

Bedankt voor uw vraag: "${q}"

${lines.join("\n\n")}

Bronnen:
${srcs.join("\n")}

Met vriendelijke groeten,

${who()}
dienst lokale economie`;
}
$("#rebuild").onclick = buildDraft;
$("#copy").onclick = async ()=>{ try{ await navigator.clipboard.writeText($("#draft").value); $("#saveStatus").textContent="Gekopieerd."; }catch(e){ $("#draft").select(); $("#saveStatus").textContent="Selecteer en kopieer met Ctrl+C."; } };

/* ---------- search wiring ---------- */
const EX = ["Hoeveel kost een vaste standplaats op de markt?","Tot hoe laat mag mijn terras open in de winter?","Moet ik bij het FAVV geregistreerd zijn om voeding te verkopen?","Kan mijn bedrijf een provinciale innovatiesubsidie krijgen?"];
$("#examples").innerHTML = EX.map(x=>`<button type="button">${esc(x)}</button>`).join("");
$("#examples").addEventListener("click",e=>{ if(e.target.tagName==="BUTTON"){ $("#q").value=e.target.textContent; runSearch(); }});
function applySearch(query, inclHist, expansions=[]){
  const {hits, terms} = search(query, inclHist, expansions);
  results = hits; lastTerms = terms; findings = []; focusId = null; $("#draft").value=""; $("#aiStatus").textContent="";
  return hits;
}
function resultCountText(hits){ return hits.length? `${hits.length} passages gevonden.` : "Geen passages gevonden."; }
function setDraftingAvailability(){
  $("#draftAI").disabled = searchPlanning;
  $("#draftX").disabled = searchPlanning;
}
function renderSearchPlan(){
  const box = $("#searchPlan"); if (!box) return;
  if (!queryPlanTerms.length){ box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  box.innerHTML = `<b>AI-zoektermen gebruikt</b><span>Deze termen verbreden alleen de lokale zoekopdracht; ze zijn geen bevindingen of bronnen.</span><span class="search-terms">${queryPlanTerms.map(t=>`<code>${esc(t)}</code>`).join("")}</span>`;
}
function queryPlanPrompt(question){
  return `Je bent uitsluitend een zoekplanner voor een afgesloten documentcollectie van een lokale overheidsdienst.
Je zoekt NIET zelf in documenten en je geeft geen antwoord, bron, citaat, juridische conclusie of passage-id.
Maak alleen korte Nederlandse zoektermen die een lokale trefwoordzoeker kunnen helpen om de vraag van een ondernemer terug te vinden.

Regels:
- Geef 2 tot 5 verschillende termen of korte zoekfrases (maximaal 60 tekens elk).
- Gebruik synoniemen, administratieve of juridische termen en mogelijke documentwoorden.
- Herhaal de volledige vraag niet en verzin geen feiten of documentnamen.
- De oorspronkelijke vraag blijft de belangrijkste zoekopdracht; jouw termen zijn alleen aanvullend.
- Antwoord uitsluitend als JSON: {"zoektermen":["...", "..."]}.

Vraag: ${question}`;
}
function cleanQueryPlan(out, originalQuery){
  if (!out || !Array.isArray(out.zoektermen)) throw new Error("Het taalmodel gaf geen bruikbare zoektermen terug.");
  const original = new Set(tokens(originalQuery).filter(t=>!STOP.has(t)).map(stem));
  const seen = new Set(); const cleaned = [];
  for (const raw of out.zoektermen){
    if (typeof raw!=="string") continue;
    const term = raw.replace(/\s+/g," ").trim();
    if (!term || term.length>60) continue;
    const termTokens = tokens(term).filter(t=>!STOP.has(t));
    if (!termTokens.length || termTokens.every(t=>original.has(stem(t)))) continue;
    const key = term.toLocaleLowerCase("nl-BE");
    if (seen.has(key)) continue;
    seen.add(key); cleaned.push(term);
    if (cleaned.length===5) break;
  }
  return cleaned;
}
async function enrichSearchWithAI(seq, question, inclHist){
  try{
    const out = await sample.json(queryPlanPrompt(question), {signal:searchCtl.signal, modelTier:"default"});
    if (seq!==searchSeq) return;
    queryPlanTerms = cleanQueryPlan(out, question);
    if (queryPlanTerms.length){
      const hits = applySearch(question, inclHist, queryPlanTerms);
      $("#searchStatus").textContent = `${resultCountText(hits)} Aangevuld met ${queryPlanTerms.length} AI-zoekterm(en).`;
    } else {
      $("#searchStatus").textContent = `${resultCountText(results)} Het taalmodel gaf geen aanvullende zoektermen; de lokale zoekresultaten blijven staan.`;
    }
  }catch(e){
    if (seq!==searchSeq) return;
    queryPlanTerms = [];
    const cancelled = e && (e.code==="cancelled" || e.name==="AbortError");
    $("#searchStatus").textContent = `${resultCountText(results)} ${cancelled?"De uitbreiding met AI-zoektermen is gestopt.":"Zoeken gebeurde zonder AI-uitbreiding."}`;
  }finally{
    if (seq!==searchSeq) return;
    searchPlanning = false; setDraftingAvailability(); renderAll();
  }
}
function runSearch(){
  currentQuery = $("#q").value.trim(); if(!currentQuery) return;
  const inclHist = $("#inclHist").checked;
  const seq = ++searchSeq;
  if (searchCtl) searchCtl.abort();
  queryPlanTerms = [];
  const hits = applySearch(currentQuery, inclHist);
  const canPlan = !!(sample && typeof sample.json==="function");
  searchPlanning = canPlan; setDraftingAvailability();
  $("#searchStatus").textContent = canPlan
    ? `${resultCountText(hits)} Taalmodel vertaalt de vraag naar aanvullende zoektermen…`
    : resultCountText(hits);
  renderAll();
  if (!canPlan) return;
  searchCtl = new AbortController();
  enrichSearchWithAI(seq, currentQuery, inclHist);
}
$("#go").onclick = runSearch;
$("#q").addEventListener("keydown",e=>{ if(e.key==="Enter" && (e.ctrlKey||e.metaKey)) runSearch(); });
function renderAll(){ renderSearchPlan(); renderEvidence(); renderFindings(); renderUncert(); }

/* ---------- log ---------- */
$("#saveLog").onclick = async ()=>{
  const ok = findings.filter(f=>f.status==="ok");
  if (!ok.length){ $("#saveStatus").textContent="Bevestig eerst minstens één bevinding."; return; }
  const entry = {
    ts: now(), who: who(), vraag: $("#q").value.trim(),
    bevindingen: findings.map(f=>({tekst:f.text, citaat:f.quote, status:f.status, herkomst:f.origin, citaatGecontroleerd:f.verified,
      bronnen:f.cites.map(id=>{const c=chunkById(id)||{}, d=docById(c.doc)||{}; return {passage:id, verwijzing:c.id?cite(c):id, document:d.title, versie:d.date, status:d.status, versieNr:d.rev||0};})})),
    concept: $("#draft").value
  };
  await store.addAnswer(entry);
  $("#saveStatus").textContent = "Vastgelegd in het logboek. Versturen doet u zelf.";
};
function renderLog(){
  $("#answers").innerHTML = answers.length? answers.map(a=>`<details><summary>${esc(fmt(a.ts))} · ${esc(a.who)} · ${esc(a.vraag)}</summary>
    <ul>${(a.bevindingen||[]).map(b=>`<li><span class="tag ${b.status==="ok"?"ok":b.status==="no"?"bad":"plain"}">${esc(b.status==="ok"?"bevestigd":b.status==="no"?"verworpen":"niet beoordeeld")}</span> ${esc(b.tekst)} “${esc(b.citaat)}” <span class="note">(${esc((b.bronnen||[]).map(x=>x.verwijzing+", versie "+x.versie+", "+x.status).join("; "))})</span></li>`).join("")}</ul>
    <pre>${esc(a.concept)}</pre></details>`).join("") : '<p class="empty">Nog niets vastgelegd.</p>';
  $("#srclog").innerHTML = srcLog.length? `<div class="tablewrap"><table><tr><th>Wanneer</th><th>Wie</th><th>Bron</th><th>Wijziging</th></tr>${srcLog.map(l=>`<tr><td>${esc(fmt(l.ts))}</td><td>${esc(l.who)}</td><td>${esc(l.doc)}</td><td>${esc(l.change)}</td></tr>`).join("")}</table></div>` : '<p class="empty">Nog geen wijzigingen.</p>';
}

/* ---------- sources view ---------- */
const FIELDS = ["status","date","url","note"];
function renderSources(){
  const ds = docs();
  $("#srcTable").innerHTML = `<tr><th>Actief</th><th>Document</th><th>Niveau</th><th>Status</th><th>Datum / versie</th><th>Link naar origineel</th><th>Opmerking</th><th>Passages</th></tr>` +
    ds.map(d=>`<tr data-doc="${esc(d.id)}">
      <td><input type="checkbox" aria-label="Actief" data-k="active" ${d.active===false?"":"checked"}></td>
      <td><b>${esc(d.title)}</b><div class="note">${esc(d.authority)}${d.file?" · "+esc(d.file):""}${d.rev?` · wijziging ${d.rev}`:""}</div></td>
      <td>${esc(d.level)}</td>
      <td><select data-k="status">${["te beoordelen","van kracht","richtlijn","ongedateerd","historisch"].map(s=>`<option ${s===d.status?"selected":""}>${s}</option>`).join("")}</select></td>
      <td><input data-k="date" value="${esc(d.date)}"></td>
      <td><input data-k="url" value="${esc(d.url)}" placeholder="https://"></td>
      <td><textarea data-k="note">${esc(d.note)}</textarea></td>
      <td>${allChunks().filter(c=>c.doc===d.id).length}</td></tr>`).join("");
}
$("#srcTable").addEventListener("change", async e=>{
  const tr = e.target.closest("tr[data-doc]"); const k = e.target.dataset.k; if(!tr||!k) return;
  const id = tr.dataset.doc; const d = docById(id);
  const val = k==="active"? e.target.checked : e.target.value.trim();
  if (k==="url" && val && !/^https?:\/\//.test(val)){ $("#storeStatus").textContent="Een link moet beginnen met http:// of https://."; return; }
  const before = d[k];
  const patch = Object.assign({}, overrides[id]||{}, {[k]:val, rev:(d.rev||0)+1});
  overrides[id] = patch;
  await store.saveOverride(id, patch, {ts:now(), who:who(), doc:d.short||d.title, change:`${k}: "${before===undefined?"":before}" → "${val}"`});
  buildIndex(); renderSources(); if (results.length) runSearch();
});
function chunkText(docId, text){
  const lines = text.split(/\r?\n/); const out=[]; let art="", par="", buf=[];
  const flush=()=>{ const t=buf.join("\n").trim(); buf=[]; if(t.length<25) return;
    for (let i=0;i<t.length;i+=1400) out.push({id:`${docId}-${out.length}`,doc:docId,label:[art,par].filter(Boolean).join(" "),title:"",pages:[1],page:1,text:t.slice(i,i+1400)}); };
  for (const L of lines){
    const a = L.match(/^\s*(Artikel|Art\.)\s*(\d+(?:\.\d+)?)/i), p = L.match(/^\s*§\s?(\d+)/);
    if (a){ flush(); art="art. "+a[2]; par=""; }
    else if (p && art){ flush(); par="§"+p[1]; }
    else if (!L.trim() && !art && buf.join("").length>600) flush();
    buf.push(L);
  }
  flush(); return out;
}
$("#addSrc").onclick = async ()=>{
  const title=$("#nTitle").value.trim(), text=$("#nText").value;
  if (!title || text.trim().length<40){ $("#addStatus").textContent="Vul minstens een titel en de tekst in."; return; }
  const url=$("#nUrl").value.trim();
  if (url && !/^https?:\/\//.test(url)){ $("#addStatus").textContent="Een link moet beginnen met http:// of https://."; return; }
  if (text.length>200000){ $("#addStatus").textContent="Deze tekst is te lang voor één bron. Splits hem op."; return; }
  const id = "u"+Date.now().toString(36);
  const meta = {id, title, short:title.slice(0,40), authority:$("#nAuth").value.trim(), level:$("#nLevel").value, type:$("#nType").value, status:$("#nStatus").value, date:$("#nDate").value.trim()||"datum onbekend", url, note:"Toegevoegd door "+who()+". Paginanummers zijn niet bekend.", pages:1};
  const chunks = chunkText(id, text);
  await store.addSource({meta, chunks}, {ts:now(), who:who(), doc:title, change:`bron toegevoegd (${chunks.length} passages)`});
  ["nTitle","nAuth","nDate","nUrl","nText"].forEach(x=>$("#"+x).value="");
  $("#addStatus").textContent = `Toegevoegd: ${chunks.length} passages.`;
};

function fileData(file){
  return new Promise((resolve,reject)=>{ const reader=new FileReader(); reader.onerror=()=>reject(new Error("Bestand kon niet worden gelezen.")); reader.onload=()=>resolve(String(reader.result).split(",",2)[1]); reader.readAsDataURL(file); });
}
$("#uploadSrc").onclick = async ()=>{
  const files=[...$("#pdfFiles").files];
  if(!files.length){ $("#uploadStatus").textContent="Kies eerst minstens één PDF."; return; }
  if(!API){ $("#uploadStatus").textContent="Start Bronwijzer via server.py om PDF's te uploaden."; return; }
  $("#uploadSrc").disabled=true;
  let done=0;
  try{
    for(const file of files){
      if(file.size>20*1024*1024) throw new Error(`${file.name} is groter dan 20 MB.`);
      $("#uploadStatus").textContent=`Uploaden en indexeren: ${file.name} (${done+1}/${files.length})…`;
      await api("/sources/upload",{file:{name:file.name,data:await fileData(file)},who:who()}); done++;
    }
    await loadSharedCollection(); buildIndex(); renderSources();
    $("#pdfFiles").value=""; $("#uploadStatus").textContent=`${done} PDF${done===1?"":"'s"} geüpload en geïndexeerd.`;
  }catch(e){ $("#uploadStatus").textContent=`Na ${done} bestand(en): ${e.message||"upload mislukt."}`; }
  finally{ $("#uploadSrc").disabled=false; }
};

/* ---------- tabs ---------- */
document.querySelectorAll("nav.tabs button").forEach(b=>b.onclick=()=>{
  document.querySelectorAll("nav.tabs button").forEach(x=>x.setAttribute("aria-selected", x===b));
  document.querySelectorAll(".view").forEach(v=>v.hidden = v.id!==b.dataset.view);
  if (b.dataset.view==="v-src") renderSources();
  if (b.dataset.view==="v-log") renderLog();
});

/* ---------- storage: shared db when available, else this browser ---------- */
const store = {
  mode:"local",
  async addAnswer(e){
    if (API){ await api("/answers",{entry:e}); await loadSharedCollection(); return; }
    if (db){ try{ await db.collection("answers").add(e); return; }catch(err){ $("#saveStatus").textContent="Opslaan in de gedeelde opslag lukte niet; lokaal bewaard."; } }
    answers.unshift(e); LS.set("bw.answers",answers.slice(0,100)); renderLog();
  },
  async saveOverride(id, patch, log){
    if (API){ await api("/sources/override",{id,patch,log}); await loadSharedCollection(); return; }
    if (db){ try{ await db.doc("overrides/"+id).set(patch); await db.collection("sourcelog").add(log); return; }catch(err){ $("#storeStatus").textContent="Opslaan in de gedeelde opslag lukte niet; lokaal bewaard."; } }
    LS.set("bw.overrides",overrides); srcLog.unshift(log); LS.set("bw.srclog",srcLog.slice(0,200)); renderLog();
  },
  async addSource(src, log){
    if (API){ await api("/sources/text",{source:src,log}); await loadSharedCollection(); buildIndex(); renderSources(); return; }
    if (db){ try{ await db.doc("sources/"+src.meta.id).set(src); await db.collection("sourcelog").add(log); return; }catch(err){ $("#addStatus").textContent="Opslaan in de gedeelde opslag lukte niet; lokaal bewaard."; } }
    added.push(src); LS.set("bw.added",added); srcLog.unshift(log); LS.set("bw.srclog",srcLog.slice(0,200));
    buildIndex(); renderSources();
  }
};
function loadLocal(){
  overrides = LS.get("bw.overrides",{}); added = LS.get("bw.added",[]); answers = LS.get("bw.answers",[]); srcLog = LS.get("bw.srclog",[]);
}
async function loadSharedCollection(){
  if(!API) return;
  const data=await api("/collection");
  added=Array.isArray(data.sources)?data.sources:[];
  answers=Array.isArray(data.answers)?data.answers:[];
  srcLog=Array.isArray(data.sourceLog)?data.sourceLog:[];
}
function storeNote(){ $("#storeStatus").textContent = window.API? "Bronnen en logboek worden gedeeld via deze Bronwijzer-server." : db? "Wijzigingen worden gedeeld met iedereen die deze pagina gebruikt." : "Wijzigingen worden alleen in deze browser bewaard."; }
loadLocal(); buildIndex(); storeNote(); runSearch();

/* ---------- taalmodel via de eigen server (zie server.py) ---------- */
const API = window.API;
async function api(path, body){
  const r = await fetch(API+path, body===undefined ? {} : {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.error || "Er ging iets mis.");
  return data;
}
(async ()=>{
  if(!API) return;
  try{ await loadSharedCollection(); buildIndex(); renderAll(); }
  catch(e){ $("#storeStatus").textContent="De gedeelde collectie kon niet worden geladen: "+e.message; }
})();
function useOpenAI(model){
  sample = { json: async (prompt, opts={})=>{
    let r;
    try{ r = await fetch(API+"/ask",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt}),signal:opts.signal}); }
    catch(e){ throw {code: e && e.name==="AbortError" ? "cancelled" : "upstream_error"}; }
    const data = await r.json().catch(()=>({}));
    if (!r.ok) throw {code: r.status===429?"rate_limited":r.status===503?"not_granted":"upstream_error", message:data.error};
    return data;
  }};
  $("#draftAI").hidden = false;
  $("#draftAI").textContent = "Formuleer bevindingen met "+model;
  $("#openSetup").textContent = model;
}

const dlg = $("#setup");
function showStep(models, model, keyHint){
  $("#stepKey").hidden = true; $("#stepModel").hidden = false;
  $("#modelSel").innerHTML = models.map(m=>`<option ${m===model?"selected":""}>${esc(m)}</option>`).join("");
  $("#keyNote").textContent = "Sleutel "+keyHint+" is bewaard. Kies een model uit uw eigen account.";
}
$("#saveKey").onclick = async ()=>{
  const key = $("#apiKey").value.trim();
  $("#setupStatus").textContent = "Sleutel controleren bij OpenAI…";
  $("#saveKey").disabled = true;
  try{
    const out = await api("/key",{apiKey:key});
    $("#apiKey").value = ""; $("#setupStatus").textContent = "";
    showStep(out.models, out.model, out.keyHint);
  }catch(e){ $("#setupStatus").textContent = e.message; }
  finally{ $("#saveKey").disabled = false; }
};
$("#saveModel").onclick = async ()=>{
  const model = $("#modelSel").value;
  $("#modelStatus").textContent = "Opslaan…";
  try{
    await api("/model",{model});
    useOpenAI(model); $("#modelStatus").textContent = ""; dlg.close();
  }catch(e){ $("#modelStatus").textContent = e.message; }
};
$("#apiKey").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); $("#saveKey").click(); }});
$("#changeKey").onclick = ()=>{ $("#stepModel").hidden = true; $("#stepKey").hidden = false; $("#apiKey").focus(); };
$("#closeSetup").onclick = ()=>dlg.close();
$("#openSetup").onclick = async ()=>{
  dlg.showModal();
  try{ const s = await api("/settings");
    if (s.hasKey){ const m = await api("/models"); showStep(m.models, s.model, s.keyHint); }
  }catch(e){ $("#setupStatus").textContent = e.message; }
};

(async ()=>{
  if (!API) return;                      // via file:// geopend: alleen zoeken en bewijs
  let s;
  try{ s = await api("/settings"); }catch(e){ return; }
  $("#openSetup").hidden = false;
  if (s.configured){ useOpenAI(s.model); return; }
  $("#openSetup").textContent = "Taalmodel instellen";
  dlg.showModal();
  if (s.hasKey){
    try{ const m = await api("/models"); showStep(m.models, s.model, s.keyHint); }catch(e){}
  } else $("#apiKey").focus();
})();

(async ()=>{
  if (!window.claude || !window.claude.use) return;
  try{
    const s = await window.claude.use("sample");
    if (s){ sample = s; $("#draftAI").hidden = false; }
  }catch(e){}
  try{
    const d = await window.claude.use("db");
    if (!d) return;
    db = d; overrides = {}; added = []; answers = []; srcLog = []; storeNote();
    db.collection("overrides").onSnapshot(snap=>{ overrides={}; snap.docs.forEach(x=>overrides[x.id]=Object.assign({},x.data())); buildIndex(); if(!$("#v-src").hidden) renderSources(); renderAll(); });
    db.collection("sources").onSnapshot(snap=>{ added = snap.docs.map(x=>JSON.parse(JSON.stringify(x.data()))); buildIndex(); if(!$("#v-src").hidden) renderSources(); });
    db.collection("answers").orderBy("ts","desc").limit(50).onSnapshot(snap=>{ answers = snap.docs.map(x=>x.data()); renderLog(); });
    db.collection("sourcelog").orderBy("ts","desc").limit(100).onSnapshot(snap=>{ srcLog = snap.docs.map(x=>x.data()); renderLog(); });
  }catch(e){ db = null; storeNote(); }
})();
})();
