# nunnuncode

[🇬🇧 English](README.md) · [🇻🇳 Tiếng Việt](README_VI.md) · [🇩🇪 Deutsch](README_DE.md)

> Ein persönliches Projekt, um zu lernen, wie Coding-Agenten funktionieren — vom Code lesen bis zum eigenen Nachbau von Grund auf.

Micro Coding Agent. Eine einzige Python-Datei, null Abhängigkeiten, ~250 Zeilen.

![screenshot](screenshot.png)

## Warum dieses Projekt

Dies ist mein Lern-Sandkasten für **selbstentwickelte Coding-Agenten**. Ich habe damit begonnen zu studieren, wie eine minimale Agenten-Schleife funktioniert — LLM + Tools + Historie — und habe sie dann zeilenweise neu gebaut, um sie wirklich zu verstehen. Kein Framework, keine Abhängigkeiten, nur die Kernmechanik.

## Funktionen

- Volle Agenten-Schleife mit Tool-Nutzung
- Tools: `read`, `write`, `edit`, `glob`, `grep`, `bash`
- Konversationshistorie
- Farbige Terminal-Ausgabe
- Eine Datei, null Abhängigkeiten

## Verwendung

```bash
export ANTHROPIC_API_KEY="your-key"
python nanocode.py
```

### OpenRouter

Benutze [OpenRouter](https://openrouter.ai), um auf jedes Modell zuzugreifen:

```bash
export OPENROUTER_API_KEY="your-key"
python nanocode.py
```

Anderes Modell verwenden:

```bash
export OPENROUTER_API_KEY="your-key"
export MODEL="openai/gpt-5.2"
python nanocode.py
```

### Eigener OpenAI-kompatibler Provider

Funktioniert mit jedem OpenAI-kompatiblen Endpoint (Unternehmens-LLM-Gateway, Ollama, vLLM, LM Studio, ...):

```bash
export API_BASE_URL="https://api.siemens.com/llm/v1"
export API_KEY="your-key"
export MODEL="your-model-name"
python nanocode.py
```

- `API_BASE_URL` — Basis-URL bis `/v1`; nanocode hängt `/chat/completions` an
- `API_KEY` — wird als `Authorization: Bearer` gesendet (für lokale Server ohne Auth weglassen)
- `MODEL` — erforderlich, wenn `API_BASE_URL` gesetzt ist

### Tests

```bash
python -m unittest discover tests
```

## Befehle

| Befehl | Beschreibung |
|--------|--------------|
| `/c` | Gespräch leeren |
| `/q` oder `exit` | Beenden |

## Werkzeuge

| Tool | Beschreibung |
|------|--------------|
| `read` | Datei mit Zeilennummern lesen, offset/limit |
| `write` | Inhalt in Datei schreiben |
| `edit` | String in Datei ersetzen (muss eindeutig sein) |
| `glob` | Dateien nach Muster finden, nach mtime sortiert |
| `grep` | Dateien nach Regex durchsuchen |
| `bash` | Shell-Befehl ausführen |

## Beispiel

```
────────────────────────────────────────
❯ what files are here?
────────────────────────────────────────

⏺ Glob(**/*.py)
  ⎿  nanocode.py

⏺ There's one Python file: nanocode.py
```

## Lernnotizen

Was ich beim Bauen gelernt habe:

- **Die Agenten-Schleife ist einfach eine while-Schleife**: Nachrichten senden → LLM antwortet mit Tool-Calls → Tools ausführen → Ergebnisse zurücksenden → wiederholen, bis keine Tool-Calls mehr kommen.
- **Tools sind nur JSON-Schemas + Python-Funktionen**: Das LLM "sieht" nie den Code, nur das Schema.
- **Constraint-Design zählt mehr als die Modellauswahl**: `edit` eine eindeutige Übereinstimmung zu verlangen, verhindert die meisten Datei-Korruptionsfehler.

## Ausblick

- [ ] Eigene API-Basis-URL (jeder Anthropic-kompatible Provider)
- [x] Unterstützung für OpenAI-kompatible Provider
- [ ] Konversations-Persistenz
- [ ] Web-Fetch-Tool

## Danksagung

Basierend auf [nanocode](https://github.com/1rgs/nanocode) von [1rgs](https://github.com/1rgs).

## Lizenz

MIT
