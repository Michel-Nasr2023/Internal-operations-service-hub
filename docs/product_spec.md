# title: Internal Operations Service hub

## 1. Context:

    The organization has many requests as issues and needs fixing.
    requests come through a helpDesk system.

## 2. Known facts:

    -The system is for internal staff , not for customers
    -There are multiple operational teams
    -requests must be tracked from creation to resolution

## 3. Actors

Employees/ Team leader/ IT Team/ security/ Admin/ System Administrator / helpdesk team

## 4. Stakeholders:

Employees/ Department managers/ IT Team/ HR/ BA/ Finance department/ Procurement/ Security team/ HelpDesk Team

## 5. Functional requirements:

1. Allowance of every employee to send a request for issues.

2. System check and validates all fields before submitting the issue
   2.1 If fields are wrong, the system won't allow submission of the issue.

3. Helpdesk Team can approve or reject requests
   3.1 In case of a rejection, an explanation is required.

4. Helpdesk Team will set priority levels: low, medium, high, urgent

5. Helpdesk Team will assign a clear assignee with the expected time to finish the task.

6. The timer starts when the assignee claims the issue.
   6.1 If the assignee does not claim the issue within 24 hours, the system will notify the Helpdesk Team.

7. The assignee works on the issue and the status is updated to "In Progress".
   7.1 If the issue remains in progress beyond the expected completion time, the system will notify the Helpdesk Team.

8. On completion of the issue, the assignee must update the status of the ticket to "Resolved".

9. The Helpdesk Team is notified when the status is "Resolved".

## 6. Non-Fonctional requirements

-Fast response time for common operations
-Reliable uptime for internal business continuity
-Data privacy
-Audit trail for all actions
-Easy to use on desktop and mobile
-Clear UI for non-technical staff

## 7.Assumptions

- Users are employees of the organization
- An identity of the employee exists
- Requests are mostly sent by team leaders
- Most workflows are not highly complex but require structured tracking
- The project is focused on internal use only

## 8. Constraints

    -Limited budget for implementation
    -Small team for development and testing
    -Need to check organization policies

## 9. Unknowns

- Exact number of request.
- Handeling of many requests at the same time
- many requests for the same department
- Not enough resource for the solving of the issue

## 10. Non-goal

-External customer support
-Payroll
-Vendor management

## 11.Acceptance criteria

- An employee can create a request with required fields and attachments
- The request is assigned to the correct team or queue
- Helpdesk can approve or reject requests, with an explanation required for rejection
- The assignee can update status and add comments
- The system records all actions in an audit log
- The requester can see progress and resolution status
- Dashboard displays total open, in progress, and overdue requests
- Notifications are sent to assigned users and requesters
