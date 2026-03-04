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
| 6 | **All-in-One Docker** | ffmpeg, yt-dlp und whisper-cpp (inkl. large-v3-turbo Modell) sind direkt im Image — nur Ollama oder llama.cpp laeuft extern. Keine weiteren Abhaengigkeiten noetig. |
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

Das Docker-Image enthaelt bereits `ffmpeg`, `yt-dlp` und `whisper-cpp` mit dem Modell `ggml-large-v3-turbo`.

```bash
# Image bauen
docker build -t rezepti .

# Container starten
docker run -d \
  --name rezepti \
  -p 3003:3003 \
  -e EXPORT_BACKEND=mealie \
  -e MEALIE_BASE_URL=http://192.168.1.168:3020 \
  -e MEALIE_API_TOKEN=dein-token \
  -e OLLAMA_BASE_URL=http://192.168.1.168:11434 \
  rezepti
```

### Docker auf Unraid

1. **Image bauen:**
   ```bash
   docker build -t rezepti:dev /mnt/user/appdata/rezepti-image
   ```

2. **Container in Unraid erstellen** (Add Container):
   - **Repository:** `rezepti:dev`
   - **Network Type:** Bridge
   - **Port:** Host `3003` → Container `3003`

3. **Variablen hinzufuegen** (Add Variable):

   | Name | Value |
   |------|-------|
   | `EXPORT_BACKEND` | `mealie` oder `notion` |
   | `MEALIE_BASE_URL` | `http://192.168.1.168:3020` |
   | `MEALIE_API_TOKEN` | Token aus Mealie Profil |
   | `OLLAMA_BASE_URL` | `http://192.168.1.168:11434` |
   | `OLLAMA_TEXT_MODEL` | `llama3.2:3b` |
   | `OLLAMA_VISION_MODEL` | `llava:7b` |
   | `LLAMACPP_BASE_URL` | `http://192.168.1.168:8003` |
   | `LLAMACPP_VISION_MODEL` | `Qwen3VL-8B-Instruct-Q8_0.gguf` |
   | `LLM_PROVIDER` | `ollama` oder `llamacpp` |

   > **Hinweis:** Die `.env`-Datei ist in `.dockerignore` und wird nicht ins Image kopiert. Umgebungsvariablen muessen ueber die Container-Konfiguration gesetzt werden.

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
| 6 | **All-in-One Docker** | ffmpeg, yt-dlp and whisper-cpp (incl. large-v3-turbo model) are built into the image — only Ollama or llama.cpp runs externally. No further dependencies needed. |
| 7 | **Robustness** | Optional fields (`emoji`, `calories`, `servings`) with Zod defaults — no crash when llama.cpp omits fields |

## Features

- **Multiple sources:** YouTube, Instagram, TikTok, any website, photo upload
- **Two export targets:** Notion database or Mealie v1 server
- **Two LLM backends:** Ollama (separate text + vision models) or llama.cpp (single model via OpenAI-compatible API)
- **Audio transcription:** Built-in whisper-cpp for video recipes without subtitles
- **Docker-ready:** Image includes ffmpeg, yt-dlp, whisper-cpp with large-v3-turbo model

## Quick Start (Docker)

```bash
docker build -t rezepti .
docker run -d -p 3003:3003 \
  -e EXPORT_BACKEND=mealie \
  -e MEALIE_BASE_URL=http://192.168.1.168:3020 \
  -e MEALIE_API_TOKEN=your-token \
  -e OLLAMA_BASE_URL=http://192.168.1.168:11434 \
  rezepti
```

Open `http://localhost:3003` — the setup wizard guides you through configuration.

## LLM Backend

| | Ollama (default) | llama.cpp |
|---|---|---|
| **Models** | Separate text + vision | Single model for both |
| **Setup** | `ollama pull qwen3:4b && ollama pull minicpm-v:8b` (or any text+vision model) | Run llama-server with a vision model |
| **Config** | `OLLAMA_BASE_URL` | `LLAMACPP_BASE_URL` + `LLAMACPP_VISION_MODEL` |
| **Switch** | `LLM_PROVIDER=ollama` | `LLM_PROVIDER=llamacpp` |

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
