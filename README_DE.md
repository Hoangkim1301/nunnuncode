# nunnuncode

[🇬🇧 English](README.md) · [🇻🇳 Tiếng Việt](README_VI.md) · [🇩🇪 Deutsch](README_DE.md)

> **Ein kleiner Agent, der sich sicher weiterentwickeln kann.**

Nunnuncode ist ein Experiment für einen minimalen persönlichen Agenten für nicht-technische Nutzer: Der Agent soll seine eigenen Fähigkeiten erweitern können und dabei verständlich, durch Berechtigungen begrenzt, getestet und reversibel bleiben.

Das Projekt begann als sehr kleiner Coding-Agent auf Basis von [nanocode](https://github.com/1rgs/nanocode). Die aktuelle Implementierung ist weiterhin dieses kleine Fundament. Langfristig soll kein weiteres großes Agent-Framework entstehen, sondern die kleinste saubere Architektur für sichere Selbstentwicklung.

![screenshot](screenshot.png)

## Aktueller Stand

Heute ist Nunnuncode ein kleiner Coding-Agent-Harness mit:

- Agenten-Schleife aus LLM + Tools + Historie
- Tools: `read`, `write`, `edit`, `glob`, `grep`, `bash`
- Anthropic-, OpenRouter- und OpenAI-kompatiblen Providern
- Reasoning/Thinking-Unterstützung
- grundlegender Behandlung von Context-Overflow
- End-to-End-Tests

Das sind die Grundbausteine. Sichere Selbstentwicklung ist die weitere Roadmap.

## Designprinzipien

### 1. Minimal, aber nicht künstlich klein

Kleiner Code ist wertvoll, weil eine einzelne Person das Projekt schnell lesen und verstehen können soll. Single-File und Zero-Dependency sind jedoch keine Ziele an sich.

Abhängigkeiten sind erlaubt, wenn sie Komplexität klar reduzieren oder Sicherheit erhöhen. Jede Abhängigkeit und Abstraktion muss ihren Nutzen rechtfertigen.

### 2. Der Agent darf Implementierung verändern, nicht Governance

Der Agent darf Fähigkeiten, Workflows, Prompts und gelerntes Verhalten erstellen oder verändern.

Er darf die Regeln seiner eigenen Weiterentwicklung nicht abschwächen: Berechtigungsprüfungen, Testpflicht, Rollback, Audit-Historie oder die geschützte Kernel-Grenze.

### 3. Evolution ist eine Transaktion

Selbstmodifikation darf nicht bedeuten: "Live-Code ändern und hoffen".

Der Zielprozess ist:

```text
fehlende Fähigkeit
      ↓
kleinster Vorschlag
      ↓
isolierter Kandidat
      ↓
Policy- und Berechtigungsprüfung
      ↓
Tests + Verhaltens-Evaluation
      ↓
menschliche Freigabe wenn nötig
      ↓
Promote
      ↓
Beobachten
      ↓
Rollback bei Regression
```

### 4. Menschen kontrollieren Absicht und Berechtigungen

Nunnuncode richtet sich an nicht-technische Nutzer. Sie sollen keine Python-Diffs prüfen müssen.

Bei riskanten Änderungen soll der Agent in normaler Sprache erklären:

- welche Fähigkeit hinzugefügt oder geändert werden soll
- warum sie benötigt wird
- welche Berechtigungen nötig sind
- welche Daten oder externen Systeme betroffen sein können
- ob die Änderung rückgängig gemacht werden kann
- ob die Validierung erfolgreich war

Der Mensch kontrolliert Absicht, Berechtigungen und schwer reversible Folgen. Das System kontrolliert die Sicherheit der Implementierung.

### 5. Komplexität ist ein Kostenfaktor

Eine Änderung ist nicht gut, nur weil sie funktioniert.

Der Agent soll bevorzugen:

```text
reuse → compose → simplify → refactor → add code
```

Er muss Fähigkeiten auch entfernen und zusammenführen können, statt nur neue anzusammeln. Doppelte Abstraktionen, Dead Code, unnötige Dependencies und spekulative Architektur gelten als Regression.

### 6. Jede Evolution muss verständlich und reversibel sein

Jede akzeptierte Evolution soll einen Audit-Trail hinterlassen:

- was geändert wurde
- warum es geändert wurde
- benötigte Berechtigungen
- ausgeführte Tests/Evaluationen
- Ergebnis
- vorherige Version / Rollback-Pfad

## Zielarchitektur

Die genaue Struktur kann sich weiterentwickeln, aber die geplante Grenze ist einfach:

```text
Kernel
  ├─ agent loop
  ├─ permissions
  ├─ capability loading
  ├─ evolution policy
  └─ rollback / audit
        ↓ governs
Agent
  ├─ memory
  ├─ workflows
  └─ behavior
        ↓ uses / evolves
Capabilities
```

Der **Kernel bleibt klein und menschlich gepflegt**. Der Agent darf Fähigkeiten weiterentwickeln, aber sich keine neuen Rechte geben oder die Regeln der Evolution verändern.

## Roadmap

Die detaillierte Roadmap steht in [Epic #1](https://github.com/Hoangkim1301/nunnuncode/issues/1).

### Foundation — Sicherheit vor Autonomie

- geschützter Kernel vs. evolvierbarer Code
- Berechtigungsmodell und sichere Defaults
- Shell-/Filesystem-Grenzen
- Execution Budgets
- robuste API-Behandlung

### Stage 1 — für nicht-technische Nutzer

- persistenter Speicher mit Provenance
- verständliche Ausgabe
- menschenlesbare Freigabeprozesse

### Stage 2 — Capabilities

- dynamische Capability Registry
- Module mit expliziten Metadaten, Berechtigungen und Dependencies
- Reuse/Composition vor neuem Capability-Code

### Stage 3 — Guarded Evolution

- isolierte Kandidatenänderungen
- Tests + Verhaltens-Evaluation
- Promotion erst nach erfolgreicher Validierung
- automatisches Rollback
- Versions-/Evolutionshistorie
- Vereinfachung und Cleanup als reguläre Evolutionsoperationen

## Verwendung

### Anthropic

```bash
export ANTHROPIC_API_KEY="your-key"
python nunnuncode/nunnuncode.py
```

### OpenRouter

```bash
export OPENROUTER_API_KEY="your-key"
python nunnuncode/nunnuncode.py
```

Anderes Modell verwenden:

```bash
export OPENROUTER_API_KEY="your-key"
export MODEL="openai/gpt-5.2"
python nunnuncode/nunnuncode.py
```

### Eigener OpenAI-kompatibler Provider

```bash
export API_BASE_URL="https://your-provider.example/v1"
export API_KEY="your-key"
export MODEL="your-model-name"
python nunnuncode/nunnuncode.py
```

### Tests

```bash
python -m unittest discover tests
```

## Befehle

| Befehl | Beschreibung |
|--------|--------------|
| `/c` | Gespräch leeren |
| `/q` oder `exit` | Beenden |

## Danksagung

Ursprünglich basierend auf [nanocode](https://github.com/1rgs/nanocode) von [1rgs](https://github.com/1rgs).

## Lizenz

MIT
