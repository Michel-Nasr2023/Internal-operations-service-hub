# Internal Operations Service Hub

The Internal Operations Service Hub is an internal helpdesk system for managing employee operational requests from creation through resolution.

## Project Structure

```text
backend/     NestJS API, workflow rules, TypeORM, and SQLite persistence
frontend/    React employee interface
docs/        Product, architecture, and data-model decisions
```

The current workflow is employee ticket creation with AI intake analysis for Helpdesk:

```text
React form -> POST /api/tickets -> NestJS validation and authorization -> Requesty AI call -> backend validation -> SQLite -> AI analysis shown to Helpdesk in the review panel
```

## Run Locally

Create the runtime config file at `backend/.env` with the Requesty settings before starting the API:

```text
RQSTY_API_KEY=your_key_here
RQSTY_API_URL=https://router.requesty.ai/v1/chat/completions
RQSTY_MODEL=nvidia/nemotron-3-super-120b-a12b
AUTH_SECRET=a_long_random_string
```

`AUTH_SECRET` signs session tokens. If it is missing, a temporary secret is generated and everyone is signed out whenever the API restarts.

Install dependencies once in each package:

```text
npm install --prefix backend
npm install --prefix frontend
```

Start the API and frontend in separate terminals from the project root:

```text
npm run backend
npm run frontend
```

The API runs at `http://localhost:3000/api` and the frontend runs at the Vite URL shown in the terminal. SQLite stores data in `backend/data/tickets.sqlite`.

### Accounts and roles

Public sign-up always creates an **Employee** account. Administrators manage everyone else from **Admin > Users**: create accounts (the person gets an invitation email to set their own password), change roles, disable or re-enable accounts, send password reset links, and sign someone out of every session. Role changes and disabling take effect immediately.

Default accounts created on first start:

| Role | Email | Password |
| --- | --- | --- |
| Employee | employee@company.com | employee123 |
| Helpdesk | helpdesk@company.com | helpdesk123 |
| Administrator | admin@company.com | Admin12345 |

The administrator account is also created on an existing database that has none. Change these passwords before real use.

A role can also be changed from the command line (start the API once first so the database is up to date):

```text
npm run user:role -- jane.doe@company.com helpdesk
```

Roles: `employee`, `helpdesk`, `administrator`. The person is signed out and gets the new role at their next sign-in.

### Email

Password reset and invitation emails are stored in an outbox (visible in **Admin > System**) and printed in the API console, because no mail provider is connected yet. Links point to `APP_URL` (default `http://localhost:5173`). To send real email, implement delivery in `backend/src/mail/mail.service.ts`.

See [Week 3 full-stack delivery](docs/week3-full-stack-delivery.md) for the original API contract, workflow tests, and build commands.
See [Week 4 production AI integration](docs/week4-production-ai.md) for the Requesty integration, AI output validation, and the direct UI evaluation cases.

## What It Does

- Allows every employee to submit requests with required details.
- Saves the ticket immediately, then has a Requesty AI model analyse it in the background. The model rewrites the employee's description into a clear summary for Helpdesk, classifies the issue type and severity, recommends a first step, and lists questions to ask the employee. Vague tickets are flagged as "Unclear request" with the questions needed to clarify them.
- Validates the AI response before saving it. Busy or overloaded provider responses (429/5xx) and unusable answers are retried up to 3 times. If the AI still cannot answer, the ticket is marked "AI analysis failed" with the reason, and Helpdesk can retry it; no substitute analysis is invented.
- Shows the AI analysis, alongside the employee's original text, only to Helpdesk when reviewing the ticket. The AI-suggested severity is pre-selected as the priority.
- Routes requests to the appropriate operational team based on project and issue type.
- Lets Helpdesk review requests, set priorities, and approve or reject them.
- Supports Helpdesk assignment, assignee claims, and progress updates.
- Sends alerts for unclaimed, overdue, and resolved requests.
- Maintains an audit trail for workflow and authorization-sensitive actions.

## Main Workflow

```text
Created -> Helpdesk Review -> Approved -> Assigned -> In Progress -> Resolved
Helpdesk Review -> Rejected
```

If an assignee does not claim an assigned request within 24 hours, Helpdesk is notified. Helpdesk is also notified when an in-progress request exceeds its expected completion time and when a request is resolved.

## Project Scope

This project is designed for internal staff and operational teams. External customer support, payroll, and vendor management are outside its scope.

## Documentation

- [Product specification](docs/product_spec.md)
- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Week 3 full-stack delivery](docs/week3-full-stack-delivery.md)
- [Week 4 production AI integration](docs/week4-production-ai.md)
- [Architecture decision record](docs/decisions/ADR-001.md)
