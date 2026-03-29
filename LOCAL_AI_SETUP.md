# Local AI Setup — Common Ground

Common Ground uses a plug-and-play AI provider system. The default is **Ollama** — a free, local AI runtime that runs models on your own machine with no API costs or data leaving your network.

---

## Why Ollama?

- No API costs — free to run as many analyses as you want
- Private — bill text and prompts stay on your machine
- Works offline
- Easy to swap to Claude or OpenAI when you're ready for production

---

## Install Ollama

### Windows
Download from https://ollama.ai/download or via winget:
```bash
winget install Ollama.Ollama
```

### Mac
```bash
brew install ollama
```

### Start the Ollama service
```bash
ollama serve
```

Ollama runs at `http://localhost:11434` by default.

---

## Pull a Model

```bash
# Recommended — good quality, fits on most machines
ollama pull llama3.1:8b

# Larger / better quality (16GB+ RAM recommended)
ollama pull llama3.1:70b

# Alternative options
ollama pull mistral
ollama pull gemma2:9b
```

> **Important:** The model name in `.env` must exactly match what `ollama list` shows. Use `llama3.1:8b` not `llama3`.

Verify it's working:
```bash
ollama list
curl http://localhost:11434/api/tags
```

---

## Configure Common Ground

In your `.env`:

```env
AI_PROVIDER=ollama
AI_MODEL=llama3.1:8b     # must match the name shown by `ollama list`
AI_BASE_URL=http://localhost:11434
AI_API_KEY=              # leave blank for Ollama
```

That's it. Restart the backend and all AI features (plain titles, tagging, analysis, perspectives) will use your local model.

---

## Switching to Claude or OpenAI

No code changes needed — just update `.env`:

```env
# Claude (Anthropic)
AI_PROVIDER=claude
AI_MODEL=claude-sonnet-4-6
AI_API_KEY=sk-ant-...
AI_BASE_URL=             # leave blank

# OpenAI
AI_PROVIDER=openai
AI_MODEL=gpt-4o
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-...

# Any OpenAI-compatible API (Together, Groq, LM Studio, etc.)
AI_PROVIDER=openai
AI_MODEL=meta-llama/Llama-3-8b-chat-hf
AI_BASE_URL=https://api.together.xyz/v1
AI_API_KEY=your_together_key
```

---

## Model Recommendations

| Use case | Model | RAM needed |
|----------|-------|------------|
| Development / testing | `llama3.1:8b` | 8 GB |
| Best local quality | `llama3.1:70b` | 48 GB |
| Production (cloud) | `claude-sonnet-4-6` | — |

### Performance estimates (llama3.1:8b on M1 Mac)

| Task | Time per bill |
|------|--------------|
| Plain title generation | ~3–5 sec |
| Category tagging | ~2–4 sec |
| Full bill analysis | ~15–30 sec |
| Single perspective | ~10–20 sec |

For bulk operations (tagging 500 bills), expect several minutes. The admin panel processes bills sequentially and shows results as they complete.

---

## Troubleshooting

**"connection refused" on port 11434** — Ollama isn't running. Run `ollama serve` in a terminal.

**"model not found"** — The model name in `.env` doesn't match what's installed. Run `ollama list` to see exact names.

**Slow responses** — Normal for larger models on CPU. For faster inference, ensure Ollama is using your GPU (`ollama ps` shows active models and whether GPU is in use).

**Out of memory** — Switch to a smaller model (`llama3.1:8b`) or use a cloud provider.

**AI returns garbage/wrong format** — Some smaller models don't follow JSON instructions reliably. Try `llama3.1:8b` or switch to Claude for more consistent structured output.
