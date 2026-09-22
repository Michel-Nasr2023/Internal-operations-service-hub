# Internal Operations Service Hub

The Internal Operations Service Hub is an internal helpdesk system for managing employee operational requests from creation through resolution.

## Project Structure

```text
backend/     NestJS API, workflow rules, TypeORM, and SQLite persistence
frontend/    React employee interface
docs/        Product, architecture, and data-model decisions
```

The current workflow is employee ticket creation with AI triage:

```text
React form -> POST /api/tickets -> NestJS validation and authorization -> Requesty AI call -> backend validation -> SQLite -> AI result shown under the form
```

## Run Locally

Create the runtime config file at `backend/.env` with the Requesty settings before starting the API:

```text
RQSTY_API_KEY=your_key_here
RQSTY_API_URL=https://router.requesty.ai/v1/chat/completions
RQSTY_MODEL=nvidia/nemotron-3-super-120b-a12b
```

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

See [Week 3 full-stack delivery](docs/week3-full-stack-delivery.md) for the original API contract, workflow tests, and build commands.
See [Week 4 production AI integration](docs/week4-production-ai.md) for the Requesty integration, AI output validation, and the direct UI evaluation cases.

## What It Does

- Allows every employee to submit requests with required details.
- Calls a Requesty AI model during ticket submission to classify the issue and recommend an action.
- Validates the AI response before saving it with the ticket.
- Shows the structured AI result beneath the form for visibility.
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
