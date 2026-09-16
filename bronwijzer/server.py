"""Kleine lokale server: toont de tool en stuurt vragen door naar een taalmodel.

Gebruik:
    export OPENAI_API_KEY=...          # je eigen sleutel, nooit in de browsercode zetten
    export OPENAI_MODEL=...            # modelnaam uit je eigen OpenAI-account
    python3 server.py                  # open daarna http://localhost:8000

Zonder OPENAI_API_KEY werkt alles behalve de knop "Formuleer bevindingen".
Alleen Python-standaardbibliotheek nodig.
"""
import http.server, json, os, urllib.request, urllib.error

KEY = os.environ.get("OPENAI_API_KEY", "")
MODEL = os.environ.get("OPENAI_MODEL", "")
URL = os.environ.get("OPENAI_URL", "https://api.openai.com/v1/chat/completions")

class H(http.server.SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        if self.path == "/api/ask":
            self.send_response(200 if KEY and MODEL else 503); self.end_headers()
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        if self.path != "/api/ask":
            self.send_response(404); self.end_headers(); return
        if not (KEY and MODEL):
            self.send_response(503); self.end_headers(); return
        n = int(self.headers.get("Content-Length", 0))
        if n > 200_000:
            self.send_response(413); self.end_headers(); return
        prompt = json.loads(self.rfile.read(n) or b"{}").get("prompt", "")
        body = json.dumps({
            "model": MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_object"},
        }).encode()
        req = urllib.request.Request(URL, data=body, headers={
            "Content-Type": "application/json", "Authorization": "Bearer " + KEY})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                text = json.load(r)["choices"][0]["message"]["content"]
            json.loads(text)  # controle: is het geldige JSON?
            out, code = text.encode(), 200
        except urllib.error.HTTPError as e:
            print("Model-fout:", e.code, e.read()[:300])
            out, code = b"{}", (429 if e.code == 429 else 502)
        except Exception as e:
            print("Fout:", e)
            out, code = b"{}", 502
        self.send_response(code)
        self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(out)

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print("Open http://localhost:8000", "(taalmodel aan)" if KEY and MODEL else "(zonder taalmodel)")
    http.server.ThreadingHTTPServer(("127.0.0.1", 8000), H).serve_forever()
