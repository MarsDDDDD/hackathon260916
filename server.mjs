import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
]);
const preferredModels = ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5-mini", "gpt-5"];
let memoryApiKey = "";
let disconnected = false;

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 120_000) request.destroy();
    });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error("Ongeldige JSON-aanvraag.")); }
    });
    request.on("error", reject);
  });
}

function configuredKey() {
  if (disconnected) return "";
  return memoryApiKey || process.env.OPENAI_API_KEY || "";
}

function textModels(models) {
  const usable = models
    .map((model) => model.id)
    .filter((id) => /^gpt-/i.test(id) && !/(audio|image|realtime|transcribe|tts|codex|chatgpt)/i.test(id));
  return [...new Set(usable)].sort((a, b) => {
    const aRank = preferredModels.indexOf(a);
    const bRank = preferredModels.indexOf(b);
    return (aRank === -1 ? 99 : aRank) - (bRank === -1 ? 99 : bRank) || a.localeCompare(b);
  });
}

async function openAi(path, apiKey, options = {}) {
  const response = await fetch(`https://api.openai.com${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${apiKey}`, ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || "OpenAI kon de aanvraag niet verwerken.";
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function availableModels(apiKey) {
  const payload = await openAi("/v1/models", apiKey);
  const models = textModels(payload.data || []);
  if (!models.length) throw new Error("Dit OpenAI-project heeft geen beschikbaar tekstmodel voor deze demo.");
  return models;
}

function responseText(result) {
  if (typeof result.output_text === "string" && result.output_text.trim()) return result.output_text.trim();
  return (result.output || [])
    .flatMap((item) => item?.content || [])
    .filter((content) => content?.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("\n")
    .trim();
}

function sourcePacket(sources) {
  if (!Array.isArray(sources) || !sources.length) throw new Error("Er zijn geen actieve bronpassages om te analyseren.");
  return sources.slice(0, 8).map((source, index) => ({
    nr: index + 1,
    titel: String(source.title || "Onbekende bron").slice(0, 180),
    locatie: String(source.location || "Onbekende locatie").slice(0, 120),
    tekst: String(source.text || "").slice(0, 5_000),
  }));
}

async function handleApi(request, response, path) {
  if (path === "/api/connect" && request.method === "POST") {
    const body = await readJson(request);
    if (body.apiKey) {
      memoryApiKey = String(body.apiKey).trim();
      disconnected = false;
    }
    const apiKey = configuredKey();
    if (!apiKey) return sendJson(response, 400, { error: "Voer een API-sleutel in of start de server met OPENAI_API_KEY." });
    const models = await availableModels(apiKey);
    return sendJson(response, 200, {
      models,
      defaultModel: models[0],
      source: memoryApiKey ? "memory" : "environment",
    });
  }

  if (path === "/api/disconnect" && request.method === "POST") {
    memoryApiKey = "";
    disconnected = true;
    return sendJson(response, 200, { ok: true });
  }

  if (path === "/api/analyze" && request.method === "POST") {
    const apiKey = configuredKey();
    if (!apiKey) return sendJson(response, 409, { error: "Geen OpenAI-verbinding. Gebruik de demo of verbind eerst een project." });
    const body = await readJson(request);
    const models = await availableModels(apiKey);
    const model = String(body.model || "");
    if (!models.includes(model)) return sendJson(response, 400, { error: "Kies een model uit de actuele lijst van dit project." });
    const sources = sourcePacket(body.sources);
    const question = String(body.question || "").trim().slice(0, 4_000);
    if (!question) return sendJson(response, 400, { error: "De klantvraag ontbreekt." });
    const instruction = [
      "Je bent BronWijzer, een assistent voor een medewerker lokale economie in België.",
      "Geef een beknopt conceptantwoord in het Nederlands van maximaal 110 woorden.",
      "Gebruik uitsluitend de meegestuurde bronpassages. Voeg geen feiten, stappen, bedragen, regels of links toe die niet letterlijk of rechtstreeks uit die passages volgen.",
      "Zet na elke feitelijke zin de bronnummer(s) die de zin ondersteunen, bijvoorbeeld [Bron 1].",
      "Als de passages de vraag niet volledig dekken, zeg exact welk punt de medewerker nog moet controleren.",
      "Dit is geen definitieve juridische conclusie en geen bericht aan de klant.",
    ].join(" ");
    const input = `Klantvraag:\n${question}\n\nActieve bronpassages:\n${sources.map((source) => `[Bron ${source.nr}] ${source.titel} (${source.locatie})\n${source.tekst}`).join("\n\n")}`;
    const result = await openAi("/v1/responses", apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, instructions: instruction, input, max_output_tokens: 700, text: { verbosity: "low" }, store: false }),
    });
    const answer = responseText(result);
    if (!answer) return sendJson(response, 502, { error: "OpenAI gaf geen leesbaar conceptantwoord terug." });
    return sendJson(response, 200, { answer: answer.slice(0, 3_000), responseId: result.id || null });
  }

  return sendJson(response, 404, { error: "Onbekende lokale API-route." });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url.pathname);
    const descriptor = staticFiles.get(url.pathname);
    if (!descriptor || request.method !== "GET") return sendJson(response, 404, { error: "Pagina niet gevonden." });
    const [file, type] = descriptor;
    const filePath = normalize(join(root, file));
    if (!filePath.startsWith(normalize(root))) return sendJson(response, 403, { error: "Niet toegestaan." });
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    response.end(content);
  } catch (error) {
    const status = error.status || 500;
    sendJson(response, status, { error: error.message || "Lokale serverfout." });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`BronWijzer draait lokaal op http://127.0.0.1:${port}`);
});
