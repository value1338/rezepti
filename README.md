# Rezepti

> **Fork von [keno303/rezepti](https://github.com/keno303/rezepti)** — erweitert um Foto-Upload, Mealie-Export, llama.cpp als LLM-Backend und Docker/Unraid-Optimierungen.

**Rezepte aus dem Netz — direkt nach Notion oder Mealie.**

Rezepti ist ein selbstgehosteter Webservice, der Rezepte aus URLs und Fotos extrahiert und als strukturierte Eintraege speichert. Einfach einen Link einfuegen oder ein Foto hochladen — Rezepti erledigt den Rest. Alle Rezepte werden auf Deutsch ausgegeben.

### Aenderungen gegenueber dem Original

| # | Aenderung | Details |
|---|-----------|---------|
| 1 | **Foto-Upload** | Handgeschriebene/gedruckte Rezepte abfotografieren, Vision-LLM extrahiert das Rezept |
| 2 | **Mealie-Export** | Neben Notion auch Export an selbstgehostete [Mealie](https://mealie.io) v1 Server |
| 3 | **llama.cpp Backend** | Vollstaendige Alternative zu Ollama — ein Modell (z.B. Qwen3VL-8B) fuer Text + Vision |
| 4 | **Setup-Wizard** | Schritt-fuer-Schritt Einrichtung unter `/setup` statt manueller .env-Konfiguration |
| 5 | **Settings-Modal** | Einstellungen jederzeit aenderbar direkt in der Hauptansicht (Zahnrad-Icon) |
| 6 | **All-in-One Docker** | ffmpeg, yt-dlp und whisper-cpp (CUDA + CPU-Fallback, large-v3-turbo) im Image — nur Ollama oder llama.cpp laeuft extern. GPU optional via `--gpus all`. |
| 7 | **Robustheit** | Optionale Felder (`emoji`, `calories`, `servings`) mit Zod-Defaults — kein Absturz wenn llama.cpp Felder wegglaesst |

## Funktionsweise

```
URL / Foto  →  Klassifizierung  →  Inhalte abrufen  →  Rezept extrahieren  →  Notion / Mealie
```

### Extraktionspfade

| Prioritaet | Methode | Beschreibung |
|------------|---------|--------------|
| 1 | **schema.org/Recipe** | JSON-LD-Parsing (schnellster Pfad, nur Web) |
| 2 | **Text → LLM** | Untertitel, Seitentext oder Beschreibung |
| 3 | **Audio → Whisper → LLM** | Audiodatei transkribieren, dann extrahieren |
| 4 | **Bild → Vision-LLM** | Bild mit Vision-Modell analysieren |
| 5 | **Foto-Upload** | Handgeschriebene oder gedruckte Rezepte abfotografieren |

### Unterstuetzte Quellen

- **YouTube** — Untertitel, Audio-Transkription oder Thumbnails
- **Instagram** — Reels und Posts
- **TikTok** — Videos
- **Web** — Beliebige Rezept-Webseiten (schema.org bevorzugt)
- **Foto** — Direkt-Upload von Rezeptfotos (z.B. Omas Rezepte)

### Export-Ziele

- **[Notion](https://notion.so)** — Rezepte als strukturierte Seiten in einer Notion-Datenbank
- **[Mealie](https://mealie.io)** — Rezepte an einen selbstgehosteten Mealie-Server (v1)

## LLM-Backend: Ollama oder llama.cpp

Rezepti unterstuetzt zwei LLM-Backends. Du waehlst beim Setup oder in den Einstellungen.

### Option A: Ollama (Standard)

[Ollama](https://ollama.com/) nutzt separate Modelle fuer Text und Vision.

**Modelle herunterladen** (auf dem Ollama-Host ausfuehren):

```bash
# Textextraktion — eines davon auswaehlen:
ollama pull llama3.2:3b       # Klein, schnell (~2 GB)
ollama pull qwen3:4b          # Empfohlen, gut auf Deutsch (~2.6 GB)
ollama pull llama3.1:8b       # Groesser, besser (~5 GB)

# Vision (fuer Foto-Upload) — eines davon auswaehlen:
ollama pull llava:7b           # Standard (~4.5 GB)
ollama pull minicpm-v:8b       # Gut fuer handschriftliche Texte (~5 GB)
ollama pull llava-llama3:8b    # Alternative (~5 GB)
```

> Welches Modell ist installiert?
> ```bash
> ollama list
> ```

> ⚠️ **Hinweis Foto-Upload mit Ollama:** Ollama-Vision-Modelle neigen bei Rezeptfotos zum Halluzinieren — sie "erfinden" Zutaten statt den tatsaechlichen Text zu lesen (OCR). Das liegt am Modellverhalten, nicht an der Konfiguration. Auch innerhalb von Unraid-Containern kann der Zugriff auf den Ollama-Host Probleme bereiten.
>
> **Fuer Foto-Upload wird Option B (llama.cpp) empfohlen.** Qwen3VL-8B ist speziell auf OCR und Texterkennung in Bildern optimiert und liefert zuverlassig korrekte Ergebnisse.

| Variable | Standard | Beschreibung |
|----------|----------|--------------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama Server-URL |
| `OLLAMA_TEXT_MODEL` | `llama3.2:3b` | Modell fuer Textextraktion |
| `OLLAMA_VISION_MODEL` | `llava:7b` | Modell fuer Bilderkennung |

### Option B: llama.cpp

[llama.cpp](https://github.com/ggerganov/llama.cpp) nutzt ein einzelnes Modell (z.B. Qwen3VL-8B) fuer Text und Vision ueber eine OpenAI-kompatible API.

```bash
# Beispiel: llama.cpp Server starten
./llama-server -m Qwen3VL-8B-Instruct-Q8_0.gguf --port 8003
```

| Variable | Standard | Beschreibung |
|----------|----------|--------------|
| `LLAMACPP_BASE_URL` | — | llama.cpp Server-URL (z.B. `http://192.168.1.168:8003`) |
| `LLAMACPP_VISION_MODEL` | `Qwen3VL-8B-Instruct-Q8_0.gguf` | Modellname |
| `LLM_PROVIDER` | auto | `ollama` oder `llamacpp` (auto = `llamacpp` wenn URL gesetzt) |

## Installation

### Docker (empfohlen)

Das Docker-Image enthaelt `ffmpeg`, `yt-dlp` und `whisper-cpp` (CUDA mit CPU-Fallback) mit dem Modell `ggml-large-v3-turbo`.

```bash
# Fertig gebautes Image pullen (empfohlen)
docker pull ghcr.io/value1338/rezepti:latest

# Container starten (ohne GPU: Whisper nutzt CPU)
docker run -d \
  --name rezepti \
  -p 3003:3003 \
  -e EXPORT_BACKEND=mealie \
  -e MEALIE_BASE_URL=http://192.168.1.168:3020 \
  -e MEALIE_API_TOKEN=dein-token \
  -e OLLAMA_BASE_URL=http://192.168.1.168:11434 \
  ghcr.io/value1338/rezepti:latest

# Mit GPU (NVIDIA Container Toolkit erforderlich)
docker run -d --name rezepti --gpus all -p 3003:3003 \
  -e OLLAMA_BASE_URL=http://192.168.1.168:11434 \
  ghcr.io/value1338/rezepti:latest

# Nur eine bestimmte GPU (per UUID)
docker run -d --name rezepti \
  --gpus "device=GPU-21f961fd-e414-a9ed-c799-77876d7b8438" \
  -p 3003:3003 \
  ghcr.io/value1338/rezepti:latest
```

> Selbst bauen (nur noetig bei Code-Aenderungen):
> ```bash
> docker build -t rezepti .
> ```

**Whisper GPU-Steuerung:** Ohne GPU-Parameter nutzt Whisper automatisch die CPU. Mit folgenden Optionen laesst sich die GPU nutzen:

| Option / Variable | Beschreibung |
|-------------------|--------------|
| `--gpus all` | Alle GPUs fuer Whisper |
| `--gpus "device=GPU-UUID"` | Nur diese GPU (z.B. `GPU-21f961fd-e414-a9ed-c799-77876d7b8438`) |
| `NVIDIA_VISIBLE_DEVICES=all` | Alle GPUs (benoetigt `--gpus all`) |
| `NVIDIA_VISIBLE_DEVICES=GPU-UUID` | Nur diese GPU filtern |

### Docker auf Unraid

**Container in Unraid erstellen** (Add Container):

| Feld | Wert |
|------|------|
| **Repository** | `ghcr.io/value1338/rezepti:latest` |
| **Network Type** | Bridge |
| **Host Port** | `3003` |
| **Container Port** | `3003` |
| **Extra Parameters** | `--gpus all` *(nur mit NVIDIA-Plugin)* |

**Variablen hinzufuegen** (Add Variable):

| Name | Beispielwert | Beschreibung |
|------|-------------|--------------|
| `NVIDIA_VISIBLE_DEVICES` | `all` | GPU fuer Whisper freigeben |
| `EXPORT_BACKEND` | `mealie` oder `notion` | Export-Ziel |
| `MEALIE_BASE_URL` | `http://192.168.1.168:3020` | Mealie Server |
| `MEALIE_API_TOKEN` | `dein-token` | Token aus Mealie Profil |
| `OLLAMA_BASE_URL` | `http://192.168.1.168:11434` | Ollama Server |
| `OLLAMA_TEXT_MODEL` | `qwen3:4b` | Textextraktion |
| `LLAMACPP_BASE_URL` | `http://192.168.1.168:8003` | llama.cpp Server |
| `LLAMACPP_VISION_MODEL` | `Qwen3VL-8B-Instruct-Q8_0.gguf` | Vision-Modell |
| `LLM_PROVIDER` | `ollama` oder `llamacpp` | LLM-Backend |

> **Hinweis:** Die `.env`-Datei wird nicht ins Image kopiert — alle Werte muessen als Container-Variablen gesetzt werden.

### Manuell (ohne Docker)

Voraussetzungen: Node.js v20+, ffmpeg, yt-dlp, whisper-cpp (optional), Ollama oder llama.cpp

```bash
git clone https://github.com/keno303/rezepti.git
cd rezepti
npm install
cp .env.example .env   # Werte eintragen
npm run dev             # Entwicklung mit Hot Reload
npm start               # Produktion
```

## Setup

Beim ersten Start leitet Rezepti automatisch auf `/setup` weiter. Dort waehlst du in drei Schritten:

1. **Export-Ziel** — Notion oder Mealie + Zugangsdaten
2. **LLM-Backend** — Ollama oder llama.cpp + Server-URL
3. **Zusammenfassung** — Pruefen und speichern

Spaeter aenderbar ueber das Zahnrad-Icon in der Hauptansicht.

## API

### `GET /api/extract?url=<URL>`

Streamt den Fortschritt via Server-Sent Events (SSE).

**Events:** `classifying` → `fetching` → `transcribing` → `extracting` → `exporting` → `done`

```bash
curl -N "http://localhost:3003/api/extract?url=https://example.com/recipe"
```

### `POST /api/extract-image`

Foto-Upload (FormData mit Feld `image`). Streamt SSE.

```bash
curl -N -F "image=@foto.jpg" "http://localhost:3003/api/extract-image"
```

### `GET /api/health`

Health-Check — prueft Server, Ollama-Verbindung und Export-Konfiguration.

### `GET /api/setup/status`

Aktuelle Konfiguration (ohne Secrets).

### `POST /api/setup`

Konfiguration aktualisieren (schreibt .env).

## Tech-Stack

- **Runtime:** Node.js + TypeScript (ESM)
- **Server:** [Hono](https://hono.dev/)
- **LLM:** [Ollama](https://ollama.com/) oder [llama.cpp](https://github.com/ggerganov/llama.cpp) (lokal)
- **Transkription:** [whisper-cpp](https://github.com/ggerganov/whisper.cpp)
- **HTML-Parsing:** [cheerio](https://cheerio.js.org/)
- **Validierung:** [Zod](https://zod.dev/)
- **Export:** [Notion API](https://developers.notion.com/) / [Mealie API](https://docs.mealie.io/)
- **Frontend:** Vanilla JS + [Tailwind CSS](https://tailwindcss.com/) (CDN)

## Lizenz

MIT

---

# English

> **Fork of [keno303/rezepti](https://github.com/keno303/rezepti)** — extended with photo upload, Mealie export, llama.cpp as LLM backend, and Docker/Unraid optimizations.

**Extract recipes from the web — straight to Notion or Mealie.**

Rezepti is a self-hosted web service that extracts recipes from URLs and photos, saving them as structured entries. Just paste a link or upload a photo — Rezepti does the rest. All recipes are output in German.

### Changes vs. the original

| # | Change | Details |
|---|--------|---------|
| 1 | **Photo upload** | Photograph handwritten/printed recipes, extracted by a vision LLM |
| 2 | **Mealie export** | Export to self-hosted [Mealie](https://mealie.io) v1 in addition to Notion |
| 3 | **llama.cpp backend** | Full alternative to Ollama — one model (e.g. Qwen3VL-8B) for text + vision |
| 4 | **Setup wizard** | Step-by-step setup at `/setup` instead of manual `.env` editing |
| 5 | **Settings modal** | Change settings anytime from the main view (gear icon) |
| 6 | **All-in-One Docker** | ffmpeg, yt-dlp and whisper-cpp (CUDA + CPU fallback, large-v3-turbo) in the image — only Ollama or llama.cpp runs externally. GPU optional via `--gpus all`. |
| 7 | **Robustness** | Optional fields (`emoji`, `calories`, `servings`) with Zod defaults — no crash when llama.cpp omits fields |

## Features

- **Multiple sources:** YouTube, Instagram, TikTok, any website, photo upload
- **Two export targets:** Notion database or Mealie v1 server
- **Two LLM backends:** Ollama (separate text + vision models) or llama.cpp (single model via OpenAI-compatible API)
- **Audio transcription:** Built-in whisper-cpp (CUDA + CPU fallback) for video recipes without subtitles
- **Docker-ready:** Image includes ffmpeg, yt-dlp, whisper-cpp with large-v3-turbo. Add `--gpus all` for GPU acceleration.

## Quick Start (Docker)

```bash
docker pull ghcr.io/value1338/rezepti:latest

# Without GPU: Whisper uses CPU
docker run -d --name rezepti -p 3003:3003 \
  -e EXPORT_BACKEND=mealie \
  -e MEALIE_BASE_URL=http://192.168.1.168:3020 \
  -e MEALIE_API_TOKEN=your-token \
  -e OLLAMA_BASE_URL=http://192.168.1.168:11434 \
  ghcr.io/value1338/rezepti:latest

# With GPU (requires NVIDIA Container Toolkit):
docker run -d --name rezepti --gpus all -p 3003:3003 \
  -e OLLAMA_BASE_URL=http://192.168.1.168:11434 \
  ghcr.io/value1338/rezepti:latest
```

Open `http://localhost:3003` — the setup wizard guides you through configuration.

## LLM Backend

| | Ollama (default) | llama.cpp |
|---|---|---|
| **Models** | Separate text + vision | Single model for both |
| **Setup** | `ollama pull qwen3:4b && ollama pull minicpm-v:8b` (or any text+vision model) | Run llama-server with a vision model |
| **Config** | `OLLAMA_BASE_URL` | `LLAMACPP_BASE_URL` + `LLAMACPP_VISION_MODEL` |
| **Switch** | `LLM_PROVIDER=ollama` | `LLM_PROVIDER=llamacpp` |

> ⚠️ **Photo upload with Ollama:** Ollama vision models tend to hallucinate on recipe photos — they invent ingredients instead of reading the actual text (OCR). This is a model behavior issue, not a configuration problem. Additionally, accessing the Ollama host from within a container (e.g. Unraid) can cause connectivity issues.
>
> **llama.cpp (Option B) is recommended for photo upload.** Qwen3VL-8B is specifically optimized for OCR and text recognition in images.

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/extract?url=<URL>` | GET | Extract recipe from URL (SSE stream) |
| `/api/extract-image` | POST | Extract recipe from photo upload (SSE stream) |
| `/api/health` | GET | Health check |
| `/api/setup/status` | GET | Current configuration |
| `/api/setup` | POST | Update configuration |

## License

MIT
