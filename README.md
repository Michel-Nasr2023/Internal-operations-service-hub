# Internal Operations Service Hub

The Internal Operations Service Hub is an internal helpdesk system for managing employee operational requests from creation through resolution.

## Project Structure

```text
backend/     NestJS API, workflow rules, TypeORM, and SQLite persistence
frontend/    React employee interface
docs/        Product, architecture, and data-model decisions
```

The first vertical slice is employee ticket creation:

```text
React form -> POST /api/tickets -> NestJS validation -> SQLite -> React result
```

## Run Locally

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

## What It Does

- Allows every employee to submit requests with required details.
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
- [Architecture decision record](docs/decisions/ADR-001.md)
