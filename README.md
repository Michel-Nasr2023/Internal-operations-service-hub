# Internal Operations Service Hub

The Internal Operations Service Hub is an internal helpdesk system for managing employee operational requests from creation through resolution and closure.

## What It Does

- Allows department leaders and employees to submit requests with required details and attachments.
- Routes requests to the appropriate operational team based on project and issue type.
- Lets Helpdesk review requests, set priorities, and approve or reject them.
- Supports team assignment, assignee claims, progress updates, completion evidence, and department-chief approval.
- Sends alerts for unassigned, unclaimed, overdue, and completed requests.
- Maintains an audit trail for workflow and authorization-sensitive actions.

## Main Workflow

```text
Created -> Helpdesk Review -> Approved -> Assigned -> In Progress
         -> Completion Approval -> Resolved -> Closed

Helpdesk Review -> Rejected
```

## Project Scope

This project is designed for internal staff and operational teams. External customer support, payroll, and vendor management are outside its scope.

## Documentation

- [Product specification](docs/product_spec.md)
- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Architecture decision record](docs/decisions/ADR-001.md)
