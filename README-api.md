# API

This repository contains a minimal NestJS API for the documented ticket workflow. The first implementation uses in-memory storage so the HTTP contract and workflow rules can be exercised before adding a relational database.

## Run

```text
npm install
npm run start:dev
```

The API listens on `http://localhost:3000/api`.

For now, authentication is represented by these required headers:

```text
x-user-id: employee-1
x-user-role: employee | helpdesk | assignee | administrator
```

## Endpoints

```text
POST   /api/tickets
GET    /api/tickets
GET    /api/tickets/:id
POST   /api/tickets/:id/approve
POST   /api/tickets/:id/reject
PATCH  /api/tickets/:id/priority
POST   /api/tickets/:id/assign
POST   /api/tickets/:id/claim
POST   /api/tickets/:id/resolve
GET    /api/tickets/:id/audit-events
```

There is intentionally no comments endpoint. Status changes are controlled by workflow endpoints and cannot be performed through a generic status update.
