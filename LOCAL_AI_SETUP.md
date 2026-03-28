"""Local AI setup guide for Common Ground."""

# LOCAL AI SETUP GUIDE

## Why Local AI?

**Cost-Free Alternative to Claude/OpenAI:**
- No API costs or rate limits
- Complete privacy and control
- Works offline
- Customizable models

## Option 1: Ollama (Easiest)

### Install Ollama
```bash
# Windows
# Download from: https://ollama.ai/download
# Or via winget:
winget install Ollama.Ollama

# Start Ollama service
ollama serve
```

### Download Models
```bash
# Small/fast model (good for testing)
ollama pull llama2:7b

# Better quality model
ollama pull llama2:13b

# Or try other models
ollama pull mistral
ollama pull codellama
```

### Test Local AI
```bash
# In another terminal
curl http://localhost:11434/api/generate -d '{
  "model": "llama2",
  "prompt": "Hello, how are you?"
}'
```

## Option 2: LM Studio (GUI Alternative)

### Install LM Studio
1. Download from: https://lmstudio.ai/
2. Install and open
3. Download a model (GGUF format)
4. Start local server in LM Studio

### Configure Common Ground
```python
# Create local AI agent
agent_data = {
    "name": "Local AI Expert",
    "description": "Local AI model",
    "persona": "AI assistant",
    "system_prompt": "You are a helpful AI assistant...",
    "agent_type": "local",
    "model_name": "llama2",  # or whatever model you downloaded
    "api_url": "http://localhost:11434/api/generate"  # Ollama default
}
```

## Option 3: Text Generation WebUI

### Install
```bash
# Clone repository
git clone https://github.com/oobabooga/text-generation-webui
cd text-generation-webui

# Install dependencies
pip install -r requirements.txt

# Download model
python download-model.py microsoft/DialoGPT-medium

# Start server
python server.py --api --listen
```

### Configure Common Ground
```python
agent_data = {
    "agent_type": "byo",
    "api_url": "http://localhost:5000/api/v1/generate",
    "api_key": "",  # No key needed for local
    # ... other fields
}
```

## Testing Local AI Setup

### 1. Test API Connection
```bash
# Ollama
curl http://localhost:11434/api/tags

# Should return: {"models":[{"name":"llama2:latest",...}]}
```

### 2. Test in Common Ground
```python
# Create local agent via API
import requests

response = requests.post("http://localhost:8000/api/agents/create", json={
    "name": "Local AI",
    "description": "Local AI model",
    "persona": "AI assistant",
    "system_prompt": "You are a helpful AI assistant.",
    "agent_type": "local",
    "model_name": "llama2"
})

print(response.json())
```

### 3. Test Debate
```python
# Create debate with local agent
debate = requests.post("http://localhost:8000/api/debates/create", json={
    "legislation_id": "your_bill_id",
    "topic": "Should this bill pass?",
    "agent_ids": ["local_agent_id"],
    "max_turns": 2
})

# Run debate
requests.post(f"http://localhost:8000/api/debates/{debate.json()['debate']['id']}/run-all")
```

## Performance Comparison

| AI Type | Speed | Quality | Cost | Setup |
|---------|-------|---------|------|-------|
| **Claude** | Fast | Excellent | $$$ | Easy |
| **Local Large** (13B) | Medium | Good | Free | Medium |
| **Local Small** (7B) | Fast | Okay | Free | Easy |

## Troubleshooting

### Ollama Issues
```bash
# Check if running
curl http://localhost:11434/api/tags

# Restart service
ollama serve

# List models
ollama list

# Remove and re-download model
ollama rm llama2
ollama pull llama2
```

### Common Errors
- **"connection refused"**: Ollama not running
- **"model not found"**: Wrong model name
- **"out of memory"**: Model too big for your RAM

### Memory Requirements
- 7B models: 8GB RAM minimum
- 13B models: 16GB RAM recommended
- 30B+ models: 32GB+ RAM needed

## Next Steps

1. **Start with small model** (llama2:7b) for testing
2. **Scale up** to larger models as needed
3. **Mix local + cloud** - use local for development, cloud for production
4. **Experiment** with different models and prompts

## BYO AI (Bring Your Own AI)

For advanced users, you can integrate any AI API:

```python
# Example: OpenAI-compatible API
agent_data = {
    "agent_type": "byo",
    "api_url": "https://api.openai.com/v1/chat/completions",
    "api_key": "your-openai-key",
    "model_name": "gpt-3.5-turbo"
}

# Example: Custom AI service
agent_data = {
    "agent_type": "byo",
    "api_url": "https://your-custom-ai.com/generate",
    "api_key": "your-custom-key"
}
```

The BYO AI expects a JSON API with this format:
```json
{
  "task": "generate_argument|research_topic|rate_argument",
  "legislation_title": "...",
  "legislation_summary": "...",
  "position": "pro|con|neutral",
  "argument": "...",
  "context": "...",
  "agent_name": "...",
  "persona": "..."
}
```

Returns:
```json
{
  "argument": "Generated argument...",
  "research": "Research findings...",
  "rating": {"scores": {...}, "reasoning": "..."}
}
```
