# Security Policy

## Reporting a vulnerability

Please do not open a public GitHub issue for security vulnerabilities.

Email [hello@opencommonground.com](mailto:hello@opencommonground.com) with:
- A description of the vulnerability
- Steps to reproduce
- Potential impact

You'll receive a response within 72 hours. Once confirmed, we'll work on a fix and credit you in the release notes if you'd like.

## Scope

This project is a read-only civic information tool. The main attack surfaces are:
- Authentication (Google OAuth + JWT)
- Voting and bill-tracking endpoints (require login)
- Stripe donation flow
- Admin panel (restricted to dev-tier users)

## Out of scope

- Denial of service
- Rate limiting bypass (we use slowapi — legitimate bugs welcome, abuse is not)
- Issues requiring physical access to infrastructure
