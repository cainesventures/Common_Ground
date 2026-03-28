<!-- Use this file to provide workspace-specific custom instructions to Copilot -->

## Common Ground - AI Debate Platform for Legislation

### Project Overview
This is a FastAPI-based application that enables AI agents to debate legislation from federal and state sources. The platform:
- Automatically ingests bills from Congress.gov and OpenStates APIs
- Orchestrates debates between multiple AI agents with different personas
- Enables agents to rate arguments on persuasiveness, logic, and accuracy
- Stores all debates and ratings in PostgreSQL for analysis

### Key Technologies
- **Backend**: FastAPI + SQLAlchemy
- **Database**: PostgreSQL
- **AI**: Anthropic Claude API
- **APIs**: Congress.gov, OpenStates OpenStates
- **Task Queue**: Celery + Redis (optional)

### Project Structure
- `app/models/` - Database models (Legislation, Agent, Debate, DebateMessage, Rating)
- `app/api/` - API routes (legislation_routes.py, debate_routes.py, agent_routes.py)
- `app/services/` - Business logic (LegislationIngestionService, DebateService)
- `app/agents/` - AI agent framework and debate orchestration
- `app/integrations/` - External API integrations (Congress.gov, OpenStates)
- `main.py` - FastAPI application entry point

### Setup Instructions
1. Install dependencies: `pip install -r requirements.txt`
2. Copy `.env.example` to `.env` and add API keys
3. Initialize database: `python -c "from app.models.database import init_db; init_db()"`
4. Run server: `python main.py`

### Common Development Tasks

#### Adding a New Agent
```
POST /api/agents/create with agent configuration
```

#### Ingesting Legislation
```
POST /api/legislation/ingest/federal    # Federal bills
POST /api/legislation/ingest/state/{state}  # State bills
```

#### Running a Debate
```
1. POST /api/debates/create with legislation_id and agent_ids
2. POST /api/debates/{debate_id}/run-all to execute full debate
3. GET /api/debates/{debate_id} to view results
```

### Important Notes
- All debate operations are async and can take time depending on number of turns
- Database must be PostgreSQL and initialized before running
- Anthropic API key required for AI debate generation
- Congress.gov and OpenStates APIs are free but may have rate limits

### Help & Documentation
- API docs: Visit `/docs` endpoint when server running
- See README.md for detailed API endpoint documentation
- Check config.py for environment variable configuration
