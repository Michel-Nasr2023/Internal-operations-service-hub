# Internal Operations Service Hub — Product Specification

## 1. Context

Employees raise operational issues (IT, facilities, finance). Requests must be tracked from creation to resolution through a Helpdesk.

## 2. Known facts

- Internal staff only, not customers.
- Several operational teams: IT Operations, Facilities, Finance.
- Every request is tracked from creation to resolution.

## 3. Actors and roles

| Role | Can do |
| --- | --- |
| **Employee** | Submit and follow own tickets; work on tickets assigned to them (the "assignee") |
| **Helpdesk** | Review, prioritise, approve/reject and assign every ticket; see team workload and activity log |
| **Administrator** | Everything Helpdesk can do, plus manage users and view system health |

Sign-up always creates an Employee. Helpdesk and Administrator roles are granted by an administrator (or with the `npm run user:role` script).

## 4. Stakeholders

Employees, department managers, IT team, HR, finance, procurement, security team, Helpdesk team.

## 5. Functional requirements

**Ticket workflow**

1. Every employee can submit a ticket (subject, description, team, issue type, project/area).
2. All fields are validated before submission; invalid input is refused (in the browser and on the server).
3. Helpdesk approves or rejects tickets; a rejection requires a reason.
4. Helpdesk sets the priority: low, medium, high or urgent.
5. Helpdesk assigns an active employee and the expected hours (can be done in the same step as approval); each employee's current workload is shown while choosing.
6. The work timer starts when the assignee claims the ticket.
   - 6.1 If not claimed within 24 hours, Helpdesk is notified.
7. Claiming sets the status to "In Progress"; the assignee sees the time remaining.
   - 7.1 If work passes its expected time, Helpdesk is notified.
8. The assignee resolves the ticket with resolution notes.
9. Helpdesk (and the requester) are notified when it is resolved.

**Collaboration**

10. Requester, assignee and Helpdesk can comment on an open ticket; the others are notified.
11. Optional attachments: the requester when submitting, the assignee when resolving (images, PDF, text, Word, Excel; 10 MB each, up to 10 per ticket). Tables show a 📎 count.
12. Every ticket shows who approved/assigned it, its full history, and its attachments.

**AI assistance**

13. On submission, an AI model rewrites the description for Helpdesk, suggests issue type and severity, recommends a first step and lists questions to ask. Unclear tickets are flagged. If the AI fails, the ticket is marked "AI analysis failed" and Helpdesk can retry. The employee's original description is always shown as well.

**Notifications**

14. In-app notification bell (with a sound that can be turned off) for: new ticket, approved, rejected, assigned, unclaimed 24 h, overdue, resolved, new comment. Clicking a notification opens the ticket.

**Helpdesk and administration**

15. Every ticket table (Helpdesk queue, My tickets, My tasks) can be filtered and sorted. The Helpdesk queue adds search, a "handled by me" filter and counters (new, awaiting review, open, in progress, overdue). Tickets not yet opened are highlighted in the queue and in My tasks.
16. Team workload view per employee: active, awaiting claim, overdue, next due and resolved in the last 30 days, with a load level.
17. Activity log of all sign-in, access and ticket events, with filters and search.
18. Administrators: overview dashboard (users, tickets, AI status, recent security events), add users (they receive an invitation email to set their own password), edit details and roles, disable accounts (after handing over their tickets), send reset links, sign users out everywhere, system health and email outbox.

**Accounts**

19. Sign-up, sign-in and sign-out (with show/hide password); profile photo (shown next to the person's name across the app), personal details, password change and notification sound setting.
20. Forgot password: 6-digit code and single-use link sent by email.

## 6. Non-functional requirements

- Fast response for common operations; ticket submission does not wait for the AI.
- Data privacy: employees only see their own tickets; files and history follow the same rule.
- Security: hashed passwords, signed sessions that can be revoked, server-side validation.
- Audit trail for all workflow, sign-in and access-denied events.
- Usable on desktop and mobile; clear UI for non-technical staff.

## 7. Assumptions

- Users are employees of the organisation with a company email.
- Workflows are simple but need structured tracking.
- Internal use only.

## 8. Constraints

- Limited budget and a small team.
- Must follow organisation policies.

## 9. Unknowns

- Number of requests and peak load.
- Staffing available to resolve issues.

## 10. Non-goals

External customer support, payroll, vendor management.

## 11. Acceptance criteria

- An employee can create a ticket with required fields and optional attachments.
- Helpdesk can approve or reject (reason required) and assign a ticket to an assignee.
- The assignee can claim, comment on and resolve the ticket with notes.
- The requester can see progress, who is handling it and the resolution.
- All actions are recorded in the audit log.
- Dashboards show open, in-progress and overdue tickets.
- Notifications reach Helpdesk, assignees and requesters.
- A forgotten password can be reset by email.
