# SnapServe Social product plan

Implementation reference: 3 October 2026. SnapServe Social is the working name. Set `PRODUCT_NAME` to change it.

## Outcome

Staff connect an Instagram professional account and a Facebook Page to a local assistant and Zoho CRM. A new comment on eligible owned content can receive one opening private reply (Instagram DM or Messenger). After the person replies, the assistant collects an interiors requirement and contact details, domain code applies qualification rules, and the app creates or updates a Zoho lead. Staff share one inbox and can take over.

The first live demonstration uses this team's own Instagram account, Facebook Page, and Zoho organization. A later Bangalore interiors workspace is configured by that client. Do not seed their account ids, claims, prices, or thresholds.

## V1

Invitation-only staff. One workspace per brand. Instagram comments/DMs and Facebook Page comments/Messenger. Zoho Leads. Local CPU model. English until another language is evaluated. Default rule: all current and future eligible posts, plus keywords, with a selected-post mode as well. Shared inbox, leads, dashboards, takeover, audit, and recovery.

Out of V1: client login, billing, outbound WhatsApp, calling, publishing, LinkedIn, calendar, Facebook personal profiles, Groups, ads, and Live. Collecting a WhatsApp number is in V1. Sending WhatsApp is not.

## Modes

- Simulation: real app, database, and queues; mock Instagram, Facebook, and Zoho; labelled in the UI.
- Integration: real adapters. A failed live call is not replaced with a mock success. New connections start paused.

## Roles

`SUPER_ADMIN` manages the platform. `ADMIN` manages one workspace. `AGENT` works the inbox and assigned leads. `VIEWER` sees aggregates only. Platform authority is not a workspace role.

## Qualification

`CONTACTABLE` requires a validated number and recorded permission. `QUALIFIED` also requires the configured project fields. The demo fields are city, project type, requirement, budget, and timeframe. Declined budget is a gap, not an automatic disqualification. Status comes from rules, not model confidence. Phone and WhatsApp stay separate unless the person confirms they are the same.

## Channel rules

One opening per comment within seven days. The 24-hour reply window starts at the latest inbound user message. Comments, likes, and the business's own opening do not open that window. No reminders to non-responders. Staff replies use the same eligibility checks.

## Reporting

Activity uses the selected interval. The funnel is a cohort of channel contacts whose first matching comment falls in that interval. Combined totals are not unique people across Instagram and Facebook. CRM coverage is synced eligible leads over leads eligible to sync. Store UTC and display in the workspace timezone, initially Asia/Kolkata. Keep simulation and integration metrics apart.

The build prompt that implemented this plan is `docs/Cursor_Build_Prompt.md`. Progress and pending live gates are in `docs/implementation-progress.md`.
