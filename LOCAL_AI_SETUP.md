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
ollama pull llama3

# Smaller / faster (8GB RAM minimum)
ollama pull llama3:8b

# Larger / better quality (16GB+ RAM recommended)
ollama pull llama3:70b

# Alternative options
ollama pull mistral
ollama pull gemma3
```

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
AI_MODEL=llama3          # must match the name you pulled
AI_BASE_URL=http://localhost:11434
AI_API_KEY=              # leave blank for Ollama
```

That's it. Restart the backend and Analyze will use your local model.

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

# Any OpenAI-compatible API (Together, Groq, local LM Studio, etc.)
AI_PROVIDER=openai
AI_MODEL=meta-llama/Llama-3-8b-chat-hf
AI_BASE_URL=https://api.together.xyz/v1
AI_API_KEY=your_together_key
```

---

## Model Recommendations

| Use case | Model | RAM needed |
|----------|-------|------------|
| Development / testing | `llama3:8b` | 8 GB |
| Good quality local | `llama3` (default) | 8 GB |
| Best local quality | `llama3:70b` | 48 GB |
| Production (cloud) | `claude-sonnet-4-6` | — |

The perspectives and analysis prompts are designed to work well with llama3. Larger models produce more nuanced perspectives; smaller models are faster but may produce shorter or less detailed output.

---

## Troubleshooting

**"connection refused" on port 11434** — Ollama isn't running. Run `ollama serve` in a terminal.

**"model not found"** — The model name in `.env` doesn't match what's installed. Run `ollama list` to see installed models.

**Slow responses** — Normal for larger models on CPU. For faster local inference, ensure Ollama is using your GPU (`ollama ps` shows active models and whether GPU is being used).

**Out of memory** — Switch to a smaller model (`ollama pull llama3:8b`) or use a cloud provider.
