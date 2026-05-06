# Contributing to Open Common Ground

Thanks for your interest in contributing. This project is an open civic tool — the goal is to make Philadelphia City Council legislation accessible to every resident.

## Getting started

See [GETTING_STARTED.md](GETTING_STARTED.md) for the full local setup walkthrough. You can have the app running in about 10 minutes.

## Reporting bugs

Open an issue on GitHub with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Browser / OS if it's a frontend issue

## Suggesting features

Open an issue describing the problem you're trying to solve. Feature requests that make the data more accessible to non-technical residents are the highest priority.

## Submitting a pull request

1. Fork the repo and create a feature branch from `main`
2. Keep changes focused — one fix or feature per PR
3. Make sure the app runs locally before submitting
4. Write a clear PR description explaining what changed and why

There are no automated tests to run — the test suite is manual (see the QA checklist in the plan). Code review will happen within a few days.

## Code style

- Python: follow the existing patterns (FastAPI routes, SQLAlchemy ORM, Pydantic settings)
- TypeScript: follow the existing Next.js App Router patterns
- No new dependencies without discussion — the goal is a lean stack
- Comments only when the *why* is non-obvious

## Questions

Open an issue or email [hello@opencommonground.com](mailto:hello@opencommonground.com).
