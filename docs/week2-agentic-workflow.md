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

- Allows every employee to submit requests with required details