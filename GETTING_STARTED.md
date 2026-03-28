"""Getting Started with Common Ground."""

# SETUP GUIDE

## 1. Prerequisites

Before starting, ensure you have:
- Python 3.10+
- PostgreSQL 12+ (or use Docker)
- An Anthropic API key: https://console.anthropic.com
- A Congress.gov API key (optional): https://api.congress.gov

## 2. Quick Start (5 minutes)

### Step 1: Clone/Navigate to project
```bash
cd Common_Ground
```

### Step 2: Install dependencies
```bash
pip install -r requirements.txt
```

### Step 3: Setup environment variables
```bash
cp .env.example .env
# Edit .env with your API keys
```

### Step 4: Initialize database
```bash
python -c "from app.models.database import init_db; init_db()"
```

### Step 5: Run the server
```bash
python main.py
```

Server will start at: http://localhost:8000

### Step 6: View API documentation
Open: http://localhost:8000/docs

## 3. Running a Demo Debate

Once the server is running:

```bash
# 1. Create an agent
curl -X POST "http://localhost:8000/api/agents/create" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Policy Expert",
    "description": "An expert on policy",
    "persona": "A thoughtful policy analyst",
    "system_prompt": "You are a policy expert...",
    "expertise_areas": "policy,legislation"
  }'

# 2. Ingest legislation (requires Congress.gov API key)
curl -X POST "http://localhost:8000/api/legislation/ingest/federal?limit=1"

# 3. Create a debate
curl -X POST "http://localhost:8000/api/debates/create" \
  -H "Content-Type: application/json" \
  -d '{
    "legislation_id": "YOUR_BILL_ID",
    "topic": "Should this bill be passed?",
    "agent_ids": ["AGENT_ID"],
    "max_turns": 3
  }'

# 4. Run the debate
curl -X POST "http://localhost:8000/api/debates/YOUR_DEBATE_ID/run-all"

# 5. View results
curl "http://localhost:8000/api/debates/YOUR_DEBATE_ID"
```

## 4. Database Setup

### PostgreSQL (Recommended)

If using PostgreSQL locally:

```bash
# Create database
createdb common_ground_db

# Update .env
DATABASE_URL=postgresql://user:password@localhost:5432/common_ground_db

# Initialize
python -c "from app.models.database import init_db; init_db()"
```

### Docker PostgreSQL

```bash
docker run --name pg_common_ground \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=common_ground_db \
  -p 5432:5432 \
  -d postgres:15

# Update .env
DATABASE_URL=postgresql://postgres:password@localhost:5432/common_ground_db
```

## 5. Project Components

### Legislation Ingestion
- Fetches bills from Congress.gov and OpenStates APIs
- Automatically updates bill status
- Searchable database

### AI Agents
- Create agents with different personas
- Each agent has a system prompt to guide behavior
- Can rate and debate arguments

### Debate System
- Create debates about specific legislation
- Agents take turns presenting arguments
- Configurable number of turns
- Other agents rate argument quality

## 6. Configuration

All settings in `app/config.py`:

- `database_url`: PostgreSQL connection string
- `anthropic_api_key`: Claude API key
- `default_model`: Claude model to use (default: claude-3-sonnet)
- `max_debate_turns`: Maximum turns per debate
- `temperature`: Model creativity (0-1)

## 7. Advanced Usage

### Creating Custom Agents

```python
from app.models import Agent
from app.models.database import SessionLocal

db = SessionLocal()

agent = Agent(
    id="custom_agent_1",
    name="Healthcare Expert",
    persona="A healthcare policy specialist",
    system_prompt="""You are an expert in healthcare policy...
    Your role is to analyze healthcare legislation...
    Focus on equity, cost, and access.""",
    expertise_areas="healthcare,equity,cost",
    is_active=True
)

db.add(agent)
db.commit()
```

### Running Debates Programmatically

```python
import asyncio
from app.services.debate_service import DebateService
from app.models.database import SessionLocal

async def run_debate():
    db = SessionLocal()
    service = DebateService(db)
    
    debate = await service.create_debate(
        legislation_id="bill_123",
        topic="Should this bill pass?",
        agent_ids=["agent_1", "agent_2", "agent_3"],
        max_turns=5
    )
    
    # Run all turns
    while await service.run_debate_turn(debate.id):
        pass
    
    print(f"Debate {debate.id} completed!")

asyncio.run(run_debate())
```

## 8. Troubleshooting

### Issue: "No module named 'app'"
**Solution**: Ensure you're in the `Common_Ground` directory

### Issue: "Cannot connect to PostgreSQL"
**Solution**: Check DATABASE_URL in .env, ensure PostgreSQL is running

### Issue: "Invalid API key"
**Solution**: Verify ANTHROPIC_API_KEY and CONGRESS_API_KEY in .env

### Issue: "Debate not generating arguments"
**Solution**: Check Anthropic API is accessible and has available credits

## 9. Next Steps

1. Read README.md for API documentation
2. Explore the FastAPI docs at http://localhost:8000/docs
3. Create custom agents for your use case
4. Run debates on topics of interest
5. Analyze ratings to understand argument quality

## 10. Support

- Check `.github/copilot-instructions.md` for project context
- Review `app/config.py` for configuration options
- See integration files in `app/integrations/` for API details
