<img width="404" height="373" alt="icon" src="https://github.com/user-attachments/assets/e5a7c9bd-dcc3-4f4f-b309-20547722fe26" />

# Z-DAENA

A minimal Zotero 7 plugin that summarizes papers with an LLM (OpenAI or Gemini), supports **bulk summaries** (selected items / folder / whole library), shows results in a **chat-like popup**, and can **save the summary as a child note** under each item.

## ⚙️ Features

- Summarize:
  - **Selected item**
  - **Selected items**
  - **Selected folder/collection**
  - **Whole library**
- Works with PDFs when available (extracts text from attached PDF), otherwise uses abstract/metadata.
- Results shown in a popup (chat style).
- Optional: **Save summary as a child note** under each item.
- Optional: add a tag (default: `ai-summary`) when saving.
- Built-in rate-limit handling:
  - clamps sent text size
  - paces between items
  - retries when OpenAI returns 429/rate-limit errors

## 🛠️ Requirements

- Zotero **7.x**
- Linux/macOS/Windows
- An API key for:
  - **OpenAI** (recommended for the OpenAI provider), or
  - **Google Gemini** (Gemini provider)

## 💻 Install (XPI)

1. In Zotero: **Tools → Plugins**
2. Drag and drop `zdaena.xpi` into the Plugins window.
3. Restart Zotero.

## ⏯ Usage
### Open the UI

1. Click the AI Summarizer toolbar button (if visible)
2. Use Tools → AI Summarizer

## ☕ Support
Give this repo a star and send it to people who might need this plugin!
