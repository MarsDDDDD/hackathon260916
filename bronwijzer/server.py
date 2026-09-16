"""Lokale server voor Bronwijzer: toont de tool en praat met de OpenAI API.

Gebruik:
    python3 server.py          # open daarna http://localhost:8000

Bij de eerste start vraagt de pagina zelf om een API-sleutel en een model.
Die worden bewaard in settings.json naast dit bestand. Dat bestand staat in
.gitignore: commit het nooit.

Een sleutel kan ook uit de omgeving komen (OPENAI_API_KEY); settings.json wint.
Alleen de Python-standaardbibliotheek nodig.
"""
import http.server, json, os, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
SETTINGS = os.path.join(HERE, "settings.json")
API = os.environ.get("OPENAI_URL", "https://api.openai.com/v1")

# Modellen die geen gewone chat-modellen zijn, of hier niets toevoegen.
SKIP = ("embedding", "tts", "whisper", "transcribe", "audio", "realtime",
        "image", "dall-e", "moderation", "instruct", "codex")


def load():
    try:
        with open(SETTINGS, encoding="utf-8") as f:
            s = json.load(f)
    except (OSError, ValueError):
        s = {}
    s.setdefault("api_key", os.environ.get("OPENAI_API_KEY", ""))
    s.setdefault("model", os.environ.get("OPENAI_MODEL", ""))
    return s


def save(s):
    with open(SETTINGS, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=2)
    try:
        os.chmod(SETTINGS, 0o600)   # geen effect op Windows, wel op macOS/Linux
    except OSError:
        pass


def hint(key):
    return (key[:6] + "…" + key[-4:]) if len(key) > 12 else ("gezet" if key else "")


def call_openai(path, key, body=None, timeout=120):
    """Geeft (status, json) terug. status 0 betekent: verbinding mislukt."""
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
        method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except ValueError:
            return e.code, {}
    except Exception as e:
        print("Verbinding mislukt:", e)
        return 0, {}


def chat_models(key):
    status, data = call_openai("/models", key)
    if status != 200:
        return status, data.get("error", {}).get("message", "")
    ids = [m["id"] for m in data.get("data", [])
           if m.get("id", "").startswith(("gpt-", "o1", "o3", "o4", "chatgpt"))
           and not any(w in m["id"] for w in SKIP)]
    return 200, sorted(set(ids))


class H(http.server.SimpleHTTPRequestHandler):
    def reply(self, code, payload):
        out = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def read_json(self, limit=200_000):
        n = int(self.headers.get("Content-Length", 0))
        if n > limit:
            return None
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return None

    def log_message(self, fmt, *a):
        if "/api/" in (a[0] if a else ""):
            super().log_message(fmt, *a)

    # ---------- GET ----------
    def do_GET(self):
        if self.path == "/api/settings":
            s = load()
            return self.reply(200, {"configured": bool(s["api_key"] and s["model"]),
                                    "hasKey": bool(s["api_key"]),
                                    "keyHint": hint(s["api_key"]),
                                    "model": s["model"]})
        if self.path == "/api/models":
            s = load()
            if not s["api_key"]:
                return self.reply(400, {"error": "Er is nog geen API-sleutel bewaard."})
            status, res = chat_models(s["api_key"])
            if status != 200:
                return self.reply(502, {"error": res or "De modellenlijst ophalen lukte niet."})
            return self.reply(200, {"models": res})
        return super().do_GET()

    # ---------- POST ----------
    def do_POST(self):
        if self.path == "/api/key":
            return self.set_key()
        if self.path == "/api/model":
            return self.set_model()
        if self.path == "/api/ask":
            return self.ask()
        self.send_response(404); self.end_headers()

    def set_key(self):
        body = self.read_json(8_000)
        key = (body or {}).get("apiKey", "").strip()
        if not key:
            return self.reply(400, {"error": "Vul een API-sleutel in."})
        status, res = chat_models(key)       # meteen controleren of de sleutel werkt
        if status == 401:
            return self.reply(400, {"error": "Deze sleutel wordt door OpenAI geweigerd."})
        if status == 0:
            return self.reply(502, {"error": "Geen verbinding met de OpenAI API. Controleer uw internet."})
        if status != 200:
            return self.reply(502, {"error": res or "De sleutel controleren lukte niet."})
        if not res:
            return self.reply(400, {"error": "Deze sleutel geeft geen toegang tot chatmodellen."})
        s = load(); s["api_key"] = key
        if s["model"] not in res:
            s["model"] = ""
        save(s)
        return self.reply(200, {"models": res, "model": s["model"], "keyHint": hint(key)})

    def set_model(self):
        body = self.read_json(8_000)
        model = (body or {}).get("model", "").strip()
        if not model:
            return self.reply(400, {"error": "Kies een model."})
        s = load()
        if not s["api_key"]:
            return self.reply(400, {"error": "Bewaar eerst een API-sleutel."})
        s["model"] = model; save(s)
        return self.reply(200, {"model": model})

    def ask(self):
        s = load()
        if not (s["api_key"] and s["model"]):
            return self.reply(503, {"error": "Stel eerst een API-sleutel en een model in."})
        body = self.read_json()
        if body is None:
            return self.reply(413, {"error": "De vraag is te lang."})
        prompt = body.get("prompt", "")
        req = {"model": s["model"],
               "messages": [{"role": "user", "content": prompt}],
               "response_format": {"type": "json_object"}}
        status, res = call_openai("/chat/completions", s["api_key"], req)
        if status == 400 and "response_format" in json.dumps(res):
            req.pop("response_format")       # oudere of beperkte modellen
            status, res = call_openai("/chat/completions", s["api_key"], req)
        if status == 429:
            return self.reply(429, {"error": "Te veel verzoeken of tegoed op. Probeer het zo opnieuw."})
        if status != 200:
            msg = res.get("error", {}).get("message", "") if isinstance(res, dict) else ""
            print("Model-fout:", status, msg[:300])
            return self.reply(502, {"error": msg or "Het model antwoordde niet."})
        text = res["choices"][0]["message"]["content"] or ""
        try:
            return self.reply(200, json.loads(text[text.index("{"):text.rindex("}") + 1]))
        except (ValueError, KeyError):
            return self.reply(502, {"error": "Het antwoord van het model was geen bruikbare JSON."})


if __name__ == "__main__":
    os.chdir(HERE)
    s = load()
    state = f"model {s['model']}" if s["api_key"] and s["model"] else "nog niet ingesteld"
    print(f"Bronwijzer draait op http://localhost:8000  ({state})")
    http.server.ThreadingHTTPServer(("127.0.0.1", 8000), H).serve_forever()
