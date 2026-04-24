# Marcus Lee — Handover Notes

**Prepared:** 28 February 2026
**Last day on Project Horizon:** 7 March 2026
**Handover recipient:** James Tan

---

## What I've been doing

I've owned the Unity Catalog governance baseline and the ingestion pipelines for SAP S/4HANA. Since the 10 February steering decision I've also been running the DataCorp Cloud provisioning and the initial medallion-layer jobs.

## Current state (as of 28 Feb)

- Unity Catalog metastore: production baseline live. Access groups for NorthWind's three BU roles are configured. One open question on the finance-readonly group — Li Wei still confirming the final member list.
- Bronze ingestion (SAP): running nightly. Schema drift alerts hooked to the data-quality monitoring workload (the new deliverable 4). Note: if scope changes and deliverable 4 is descoped, the drift alerts will need to be re-wired or removed.
- Silver transformations: 60% complete. The order-to-cash fact table is the critical path.
- DataCorp Cloud: provisioned Southeast Asia region, reserved-instance tier. If procurement pushes back on DataCorp (Jun has been wobbling per Sarah's email), the rollback to TechCorp Cloud is about 3 days of infra work — I've kept the terraform modules parametric.

## Open items

1. **Deliverable 4 ambiguity.** The 10 Feb steering added it; but the NorthWind side has been quieter on it than the others. Watch for a descope conversation.
2. **James's onboarding to Unity Catalog admin role** — we had one pairing session on 25 Feb; needs another before my last day.
3. **R02 mitigation** — the two-week parallel run with James starts Monday 3 March. Sarah is aware.

## Things to watch out for

- The DataCorp Cloud support portal has a 48-hour SLA response time, not 24. Don't promise Jun Park anything tighter.
- The Power BI gateway on-prem connector is still licensed to my user. Transfer to the team service principal before 7 March.
- Do not run the bronze ingestion full-refresh during business hours — SAP performance tanks.

## Credentials & access

All handed over via the Temus PAM system. Ticket #HO-2026-0307 covers the transfer.

---
Good luck.
— Marcus
