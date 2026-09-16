"""Lokale server voor Bronwijzer met een door medewerkers beheerde collectie."""
import base64
import hashlib
import http.server
import io
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date, datetime, timezone

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None

HERE = os.path.dirname(os.path.abspath(__file__))
SETTINGS = os.path.join(HERE, "settings.json")
DATA_DIR = os.path.join(HERE, "data")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
COLLECTION = os.path.join(DATA_DIR, "collection.json")
API = os.environ.get("OPENAI_URL", "https://api.openai.com/v1")
MAX_UPLOAD = 20 * 1024 * 1024
LEVELS = {"gemeentelijk", "provinciaal", "Vlaams", "federaal"}
SKIP = ("embedding", "tts", "whisper", "transcribe", "audio", "realtime", "image", "dall-e", "moderation", "instruct", "codex")


def load_settings():
    try:
        with open(SETTINGS, encoding="utf-8") as f: settings = json.load(f)
    except (OSError, ValueError): settings = {}
    settings.setdefault("api_key", os.environ.get("OPENAI_API_KEY", ""))
    settings.setdefault("model", os.environ.get("OPENAI_MODEL", ""))
    return settings


def save_settings(settings):
    with open(SETTINGS, "w", encoding="utf-8") as f: json.dump(settings, f, indent=2)
    try: os.chmod(SETTINGS, 0o600)
    except OSError: pass


def load_collection():
    try:
        with open(COLLECTION, encoding="utf-8") as f: value = json.load(f)
    except (OSError, ValueError): value = {}
    value.setdefault("sources", []); value.setdefault("answers", []); value.setdefault("sourceLog", [])
    changed = False
    for source in value["sources"]:
        meta = source.get("meta", {})
        if meta.get("status") == "te beoordelen":
            meta["status"] = "van kracht"; changed = True
        note = meta.get("note", "")
        if " Controleer brongegevens en status." in note:
            meta["note"] = note.replace(" Controleer brongegevens en status.", "")
            changed = True
        if "historical" not in meta:
            meta["historical"] = meta.get("status") == "historisch" or str(meta.get("file", "")).upper().startswith("HISTORICAL-")
            changed = True
    if changed: save_collection(value)
    return value


def save_collection(value):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    temp = COLLECTION + ".tmp"
    with open(temp, "w", encoding="utf-8") as f: json.dump(value, f, ensure_ascii=False, indent=2)
    os.replace(temp, COLLECTION)


def timestamp(): return datetime.now(timezone.utc).isoformat()
def hint(key): return key[:6] + "…" + key[-4:] if len(key) > 12 else ("gezet" if key else "")


def call_openai(path, key, body=None, timeout=120):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key}, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response: return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        try: return error.code, json.loads(error.read().decode() or "{}")
        except ValueError: return error.code, {}
    except Exception as error:
        print("Verbinding mislukt:", error)
        return 0, {"error": {"message": "Geen verbinding met de OpenAI API. Controleer de internetverbinding, firewall/proxy en API-toegang."}}


def chat_models(key):
    status, data = call_openai("/models", key)
    if status != 200: return status, data.get("error", {}).get("message", "")
    ids = [m["id"] for m in data.get("data", []) if m.get("id", "").startswith(("gpt-", "o1", "o3", "o4", "chatgpt")) and not any(w in m["id"] for w in SKIP)]
    return 200, sorted(set(ids))


def safe_filename(name):
    name = os.path.basename(name or "document.pdf")
    return re.sub(r"[^A-Za-z0-9._ -]", "_", name).strip(" .") or "document.pdf"


def chunks_from_pdf(doc_id, raw):
    if PdfReader is None: raise ValueError("PDF-uitlezen is niet beschikbaar. Installeer eerst pypdf (pip install -r requirements.txt).")
    try: reader = PdfReader(io.BytesIO(raw))
    except Exception as error: raise ValueError("Dit bestand is geen leesbare PDF.") from error
    chunks = []
    for page_number, page in enumerate(reader.pages, 1):
        text = (page.extract_text() or "").strip()
        for start in range(0, len(text), 1400):
            part = text[start:start + 1400].strip()
            if len(part) < 25: continue
            article = re.search(r"(?:Artikel|Art\.)\s*\d+(?:\.\d+)?(?:\s*§\s*\d+)?", part, re.I)
            chunks.append({"id": f"{doc_id}-{len(chunks)}", "doc": doc_id, "label": article.group(0).replace("Artikel", "art.") if article else "", "title": "", "pages": [page_number], "page": page_number, "text": part})
    if not chunks: raise ValueError("Er kon geen selecteerbare tekst uit deze PDF worden gehaald. Gebruik een doorzoekbare PDF of OCR hem eerst.")
    return chunks, len(reader.pages)


class H(http.server.SimpleHTTPRequestHandler):
    def reply(self, code, payload):
        out = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json; charset=utf-8"); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)

    def read_json(self, limit=200_000):
        try: size = int(self.headers.get("Content-Length", 0))
        except ValueError: return None
        if size > limit: return None
        try: return json.loads(self.rfile.read(size) or b"{}")
        except ValueError: return None

    def log_message(self, fmt, *args):
        if "/api/" in str(args[0] if args else ""): super().log_message(fmt, *args)

    def do_GET(self):
        if self.path == "/api/settings":
            settings = load_settings(); return self.reply(200, {"configured": bool(settings["api_key"] and settings["model"]), "hasKey": bool(settings["api_key"]), "keyHint": hint(settings["api_key"]), "model": settings["model"]})
        if self.path == "/api/models":
            settings = load_settings()
            if not settings["api_key"]: return self.reply(400, {"error": "Er is nog geen API-sleutel bewaard."})
            status, result = chat_models(settings["api_key"])
            return self.reply(200, {"models": result}) if status == 200 else self.reply(502, {"error": result or "De modellenlijst ophalen lukte niet."})
        if self.path == "/api/collection": return self.reply(200, load_collection())
        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/key": return self.set_key()
        if self.path == "/api/model": return self.set_model()
        if self.path == "/api/ask": return self.ask()
        if self.path == "/api/sources/upload": return self.upload_source()
        if self.path == "/api/sources/text": return self.add_text_source()
        if self.path == "/api/sources/override": return self.override_source()
        if self.path == "/api/sources/remove": return self.remove_source()
        if self.path == "/api/answers": return self.add_answer()
        self.send_response(404); self.end_headers()

    def set_key(self):
        body = self.read_json(8_000); key = (body or {}).get("apiKey", "").strip()
        if not key: return self.reply(400, {"error": "Vul een API-sleutel in."})
        status, result = chat_models(key)
        if status == 401: return self.reply(400, {"error": "Deze sleutel wordt door OpenAI geweigerd."})
        if status == 0: return self.reply(502, {"error": "Geen verbinding met de OpenAI API. Controleer uw internet."})
        if status != 200: return self.reply(502, {"error": result or "De sleutel controleren lukte niet."})
        if not result: return self.reply(400, {"error": "Deze sleutel geeft geen toegang tot chatmodellen."})
        settings = load_settings(); settings["api_key"] = key
        if settings["model"] not in result: settings["model"] = ""
        save_settings(settings); return self.reply(200, {"models": result, "model": settings["model"], "keyHint": hint(key)})

    def set_model(self):
        body = self.read_json(8_000); model = (body or {}).get("model", "").strip(); settings = load_settings()
        if not model: return self.reply(400, {"error": "Kies een model."})
        if not settings["api_key"]: return self.reply(400, {"error": "Bewaar eerst een API-sleutel."})
        settings["model"] = model; save_settings(settings); return self.reply(200, {"model": model})

    def upload_source(self):
        body = self.read_json(MAX_UPLOAD * 2); file = (body or {}).get("file", {}); name, encoded = safe_filename(file.get("name", "")), file.get("data", "")
        level = (body or {}).get("level")
        if not name.lower().endswith(".pdf"): return self.reply(400, {"error": "Upload alleen PDF-bestanden."})
        if level not in LEVELS: return self.reply(400, {"error": "Kies een geldig niveau voor de PDF."})
        try: raw = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError): return self.reply(400, {"error": "Het uploadbestand kon niet worden gelezen."})
        if not raw.startswith(b"%PDF") or len(raw) > MAX_UPLOAD: return self.reply(400, {"error": "De PDF is ongeldig of groter dan 20 MB."})
        sha256 = hashlib.sha256(raw).hexdigest()
        data = load_collection()
        duplicate = next((source for source in data["sources"] if source.get("meta", {}).get("sha256") == sha256), None)
        if duplicate:
            title = duplicate.get("meta", {}).get("title", "een bestaande bron")
            return self.reply(409, {"error": f"Dit bestand is al geüpload als ‘{title}’.", "duplicate": True, "sourceId": duplicate.get("meta", {}).get("id")})
        doc_id = "u" + uuid.uuid4().hex[:12]
        try: chunks, pages = chunks_from_pdf(doc_id, raw)
        except ValueError as error: return self.reply(400, {"error": str(error)})
        disk_name = doc_id + "-" + name; os.makedirs(UPLOAD_DIR, exist_ok=True)
        with open(os.path.join(UPLOAD_DIR, disk_name), "wb") as f: f.write(raw)
        stem = os.path.splitext(name)[0].replace("HISTORICAL-", "").replace("-", " ")
        municipality = "Schoten" if "schoten" in name.lower() else ""
        historical = name.upper().startswith("HISTORICAL-")
        officer = str((body or {}).get("who") or "onbekende medewerker")
        source = {"meta": {"id": doc_id, "title": stem, "short": stem[:40], "authority": "", "municipality": municipality, "level": level, "type": "regelgeving", "status": "van kracht", "historical": historical, "sha256": sha256, "date": "geüpload " + date.today().isoformat(), "url": "/data/uploads/" + urllib.parse.quote(disk_name), "note": "Geüpload door " + officer + ".", "pages": pages, "active": True, "rev": 0, "file": name}, "chunks": chunks}
        data["sources"].append(source); data["sourceLog"].insert(0, {"ts": timestamp(), "who": officer, "doc": stem, "change": f"PDF geüpload ({level}, {len(chunks)} passages)"}); save_collection(data)
        return self.reply(201, {"source": source})

    def add_text_source(self):
        body = self.read_json(); source = (body or {}).get("source")
        if not isinstance(source, dict) or not source.get("meta") or not source.get("chunks"): return self.reply(400, {"error": "Ongeldige bron."})
        if source["meta"].get("level") not in LEVELS: return self.reply(400, {"error": "Kies een geldig niveau."})
        data = load_collection(); data["sources"].append(source); data["sourceLog"].insert(0, (body or {}).get("log") or {}); save_collection(data); return self.reply(201, {"source": source})

    def override_source(self):
        body = self.read_json(); doc_id, patch = (body or {}).get("id"), (body or {}).get("patch", {}); allowed = {"active", "historical", "level", "status", "date", "url", "note", "rev"}
        if not doc_id or not isinstance(patch, dict): return self.reply(400, {"error": "Ongeldige bronwijziging."})
        if "level" in patch and patch["level"] not in LEVELS: return self.reply(400, {"error": "Kies een geldig niveau."})
        data = load_collection()
        for source in data["sources"]:
            if source.get("meta", {}).get("id") == doc_id:
                source["meta"].update({key: value for key, value in patch.items() if key in allowed}); data["sourceLog"].insert(0, (body or {}).get("log") or {}); save_collection(data); return self.reply(200, {"source": source})
        return self.reply(404, {"error": "Bron niet gevonden."})

    def remove_source(self):
        body = self.read_json(); doc_id = (body or {}).get("id")
        if not isinstance(doc_id, str) or not doc_id: return self.reply(400, {"error": "Ongeldige bron."})
        data = load_collection()
        for index, source in enumerate(data["sources"]):
            if source.get("meta", {}).get("id") != doc_id: continue
            removed = data["sources"].pop(index)
            data["sourceLog"].insert(0, (body or {}).get("log") or {})
            save_collection(data)
            url = removed.get("meta", {}).get("url", "")
            prefix = "/data/uploads/"
            if isinstance(url, str) and url.startswith(prefix):
                filename = safe_filename(urllib.parse.unquote(url[len(prefix):]))
                path = os.path.abspath(os.path.join(UPLOAD_DIR, filename))
                if os.path.commonpath([os.path.abspath(UPLOAD_DIR), path]) == os.path.abspath(UPLOAD_DIR):
                    try: os.remove(path)
                    except FileNotFoundError: pass
                    except OSError as error: print("Uploadbestand kon niet worden verwijderd:", error)
            return self.reply(200, {"ok": True})
        return self.reply(404, {"error": "Bron niet gevonden."})

    def add_answer(self):
        body = self.read_json(); entry = (body or {}).get("entry")
        if not isinstance(entry, dict): return self.reply(400, {"error": "Ongeldig logboekitem."})
        data = load_collection(); data["answers"].insert(0, entry); data["answers"] = data["answers"][:100]; save_collection(data); return self.reply(201, {"ok": True})

    def ask(self):
        settings = load_settings()
        if not (settings["api_key"] and settings["model"]): return self.reply(503, {"error": "Stel eerst een API-sleutel en een model in."})
        body = self.read_json()
        if body is None: return self.reply(413, {"error": "De vraag is te lang."})
        req = {"model": settings["model"], "messages": [{"role": "user", "content": body.get("prompt", "")}], "response_format": {"type": "json_object"}}
        status, result = call_openai("/chat/completions", settings["api_key"], req)
        if status == 400 and "response_format" in json.dumps(result): req.pop("response_format"); status, result = call_openai("/chat/completions", settings["api_key"], req)
        if status == 429: return self.reply(429, {"error": "Te veel verzoeken of tegoed op. Probeer het zo opnieuw."})
        if status != 200:
            message = (result.get("error", {}).get("message", "") if isinstance(result, dict) else "") or "Het model antwoordde niet."
            print("Model-fout:", status, message[:300])
            return self.reply(502, {"error": message})
        text = result["choices"][0]["message"]["content"] or ""
        try: return self.reply(200, json.loads(text[text.index("{"):text.rindex("}") + 1]))
        except (ValueError, KeyError): return self.reply(502, {"error": "Het antwoord van het model was geen bruikbare JSON."})


if __name__ == "__main__":
    os.chdir(HERE); os.makedirs(UPLOAD_DIR, exist_ok=True); settings = load_settings()
    print(f"Bronwijzer draait op http://localhost:8000  ({'model ' + settings['model'] if settings['api_key'] and settings['model'] else 'nog niet ingesteld'})")
    http.server.ThreadingHTTPServer(("127.0.0.1", 8000), H).serve_forever()
