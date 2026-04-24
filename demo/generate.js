const fs = require('fs')
const path = require('path')
const { Document, Packer, Paragraph, HeadingLevel, TextRun } = require('docx')
const PptxGenJS = require('pptxgenjs')
const PDFDocument = require('pdfkit')
const XLSX = require('xlsx')

const OUT = path.join(__dirname, 'aidlas-demo-project')
const DROP = path.join(__dirname, 'aidlas-drop-me')
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })
if (!fs.existsSync(DROP)) fs.mkdirSync(DROP, { recursive: true })

function p(text, opts = {}) { return new Paragraph({ children: [new TextRun({ text, ...opts })] }) }
function h(text, level = HeadingLevel.HEADING_1) { return new Paragraph({ text, heading: level }) }

async function writeDocx(filename, sections) {
  const doc = new Document({ sections: [{ properties: {}, children: sections }] })
  const buf = await Packer.toBuffer(doc)
  fs.writeFileSync(filename, buf)
}

// 01 - Project Scope v1 (3 deliverables, March 15, TechCorp)
const scope1 = [
  h('Project Horizon — Project Scope v1.0'),
  p('Client: NorthWind Logistics'),
  p('Prepared by: Sarah Chen (Lead Architect)'),
  p('Approved: 15 January 2026'),
  p(''),
  h('1. Executive Summary', HeadingLevel.HEADING_2),
  p('Project Horizon delivers a unified data platform for NorthWind Logistics, built on Databricks with Power BI reporting. The engagement covers platform build, reporting, and knowledge transfer to the in-house team.'),
  p(''),
  h('2. Deliverables', HeadingLevel.HEADING_2),
  p('The engagement comprises three (3) deliverables:'),
  p('  (a) Databricks workspace setup with Unity Catalog governance, medallion architecture, and ingestion pipelines for SAP and Oracle sources.'),
  p('  (b) Power BI reports: operational dashboard, executive summary, and finance reconciliation report.'),
  p('  (c) Knowledge transfer: documentation, runbooks, and a two-week shadowing period for NorthWind engineers.'),
  p(''),
  h('3. Timeline', HeadingLevel.HEADING_2),
  p('Kickoff: 20 January 2026. Final delivery: 15 March 2026.'),
  p(''),
  h('4. Vendor Selection', HeadingLevel.HEADING_2),
  p('Cloud vendor for the Databricks workspace cluster: TechCorp Cloud. Rationale: existing Temus master agreement, preferred discount tier, and alignment with NorthWind\'s current Azure footprint.'),
  p(''),
  h('5. Team', HeadingLevel.HEADING_2),
  p('Sarah Chen — Lead Architect; James Tan — Data Engineer; Marcus Lee — Senior Engineer; Priya Ramesh — Project Manager (Temus side). Jun Park — NorthWind CTO (client stakeholder).'),
]

// 02 - Kickoff Meeting Minutes (consistent with scope v1)
const kickoff = [
  h('Kickoff Meeting Minutes — Project Horizon'),
  p('Date: 20 January 2026, 10:00 SGT'),
  p('Attendees: Sarah Chen, James Tan, Marcus Lee, Priya Ramesh (Temus); Jun Park, Li Wei (NorthWind).'),
  p(''),
  h('1. Scope Confirmation', HeadingLevel.HEADING_2),
  p('Priya walked through the three deliverables in the approved scope document. Jun Park confirmed alignment with NorthWind\'s 2026 data strategy. No changes requested.'),
  p(''),
  h('2. Technical Approach', HeadingLevel.HEADING_2),
  p('Sarah presented the target architecture: Databricks on TechCorp Cloud, Unity Catalog for governance, bronze/silver/gold layering, Power BI service for reports. Li Wei asked about disaster recovery; to be covered in the architecture design document.'),
  p(''),
  h('3. Timeline', HeadingLevel.HEADING_2),
  p('Final delivery date: 15 March 2026. Mid-engagement checkpoint: 15 February 2026.'),
  p(''),
  h('4. Action Items', HeadingLevel.HEADING_2),
  p('James Tan to set up the Databricks workspace on TechCorp Cloud by 25 January.'),
  p('Marcus Lee to produce the Unity Catalog governance baseline by 30 January.'),
  p('Sarah Chen to deliver the architecture design document by 5 February.'),
]

// 06 - Weekly Status Update (references 4 deliverables, Marcus leaving)
const status = [
  h('Project Horizon — Weekly Status Update'),
  p('Week ending: 24 February 2026'),
  p('Prepared by: Priya Ramesh'),
  p(''),
  h('Progress', HeadingLevel.HEADING_2),
  p('We are tracking against the revised four-deliverable scope confirmed at the steering committee on 10 February. Databricks on DataCorp Cloud is provisioned; Power BI workspace is partially built; the newly-added data-quality monitoring component is in design.'),
  p(''),
  h('Deliverables Status', HeadingLevel.HEADING_2),
  p('(a) Databricks workspace — 80% complete, DataCorp Cloud provisioned.'),
  p('(b) Power BI reports — 50% complete.'),
  p('(c) Knowledge transfer — not started (planned for final fortnight).'),
  p('(d) Data-quality monitoring — 20% complete (added post-10-Feb steering).'),
  p(''),
  h('People', HeadingLevel.HEADING_2),
  p('Marcus Lee has given notice and will roll off the project on 7 March. Handover plan needed. Priya to request formal handover document from Marcus by 3 March.'),
  p(''),
  h('Deadline', HeadingLevel.HEADING_2),
  p('Targeting 30 March final delivery per revised steering committee scope.'),
  p(''),
  h('Risks & Escalations', HeadingLevel.HEADING_2),
  p('Vendor lock-in concern with DataCorp Cloud flagged in the risk register. Jun Park (NorthWind CTO) has asked for confirmation that the vendor switch aligns with their procurement standards.'),
]

// 09 - Scope Amendment Confirmation (the DROP file — reverts to scope v1)
const amend = [
  h('SCOPE AMENDMENT CONFIRMATION — Project Horizon'),
  p('Date: 25 February 2026'),
  p('From: Priya Ramesh (Temus PM)'),
  p('To: Project Horizon distribution list'),
  p('Subject: Confirmation — reverting to original scope and vendor'),
  p(''),
  h('Summary', HeadingLevel.HEADING_2),
  p('Following a call this morning with Jun Park (NorthWind CTO), the client has confirmed a reversion to the original project scope.'),
  p(''),
  h('Confirmed Changes', HeadingLevel.HEADING_2),
  p('1. Deliverables: back to three (3) as per the original 15 January scope. The data-quality monitoring component (added at the 10 February steering) is descoped and will be handled under a separate Phase 2 engagement.'),
  p('2. Final delivery date: reverts to 15 March 2026.'),
  p('3. Cloud vendor: reverts to TechCorp Cloud. DataCorp provisioning to be wound down by end of week.'),
  p(''),
  h('Rationale', HeadingLevel.HEADING_2),
  p('Jun Park raised procurement-standard concerns regarding DataCorp Cloud and prefers alignment with NorthWind\'s existing TechCorp master agreement. The reduced scope allows the 15 March deadline to remain achievable.'),
  p(''),
  h('Action Required', HeadingLevel.HEADING_2),
  p('Sarah Chen: revise architecture design to remove data-quality monitoring workload.'),
  p('James Tan: begin migration from DataCorp Cloud to TechCorp Cloud by 28 February.'),
  p('Marcus Lee: align handover documentation with three-deliverable scope before his 7 March roll-off.'),
  p(''),
  p('This amendment supersedes the steering committee decision of 10 February 2026.'),
]

async function writeSteering() {
  // PDF via pdfkit
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50 })
    const out = fs.createWriteStream(path.join(OUT, '03_Steering_Committee_10Feb2026.pdf'))
    doc.pipe(out)
    doc.fontSize(18).text('Steering Committee Minutes', { align: 'left' })
    doc.fontSize(14).text('Project Horizon — NorthWind Logistics', { align: 'left' })
    doc.moveDown().fontSize(11).text('Date: 10 February 2026')
    doc.text('Attendees: Jun Park (NorthWind CTO), Li Wei (NorthWind Head of Data), Priya Ramesh (Temus PM), Sarah Chen (Temus Lead Architect).')
    doc.moveDown().fontSize(14).text('1. Scope Revision')
    doc.moveDown(0.3).fontSize(11).text('The committee reviewed the mid-engagement checkpoint and approved the following revisions to the project scope:')
    doc.moveDown(0.3).text('• A fourth deliverable is added: data-quality monitoring. Scope covers automated freshness checks, schema drift detection, and alerting into the existing Power BI workspace. Jun Park confirmed this is a strategic priority for 2026.')
    doc.text('• Revised deliverable count: four (4).')
    doc.moveDown().fontSize(14).text('2. Timeline')
    doc.moveDown(0.3).fontSize(11).text('In consequence of the expanded scope, the final delivery date is revised from 15 March 2026 to 30 March 2026. All parties accepted the new target.')
    doc.moveDown().fontSize(14).text('3. Vendor Change')
    doc.moveDown(0.3).fontSize(11).text('Following a review of pricing quotes received 5 February, the Databricks cluster vendor is changed from TechCorp Cloud to DataCorp Cloud. DataCorp\'s reserved-instance pricing represents a 23% annualised saving at the engagement\'s committed scale. Sarah Chen and James Tan to manage migration.')
    doc.moveDown().fontSize(14).text('4. Action Items')
    doc.moveDown(0.3).fontSize(11).text('• Sarah Chen: revised architecture design document by 20 February.')
    doc.text('• James Tan: DataCorp Cloud provisioning complete by 17 February.')
    doc.text('• Priya Ramesh: update Risk Register to reflect new vendor; circulate to steering attendees.')
    doc.moveDown().text('Minutes taken by: Priya Ramesh. Circulated to all attendees 11 February 2026.')
    doc.end()
    out.on('finish', resolve)
  })
}

async function writeArchPptx() {
  const pptx = new PptxGenJS()
  pptx.title = 'Project Horizon — Architecture Design v2'
  const s1 = pptx.addSlide()
  s1.addText('Project Horizon', { x: 0.5, y: 1.0, w: 9, h: 1, fontSize: 36, bold: true })
  s1.addText('Architecture Design v2.0', { x: 0.5, y: 2.0, w: 9, h: 0.6, fontSize: 24 })
  s1.addText('Post-10-Feb steering revisions applied', { x: 0.5, y: 2.7, w: 9, h: 0.4, fontSize: 16, italic: true })
  s1.addText('Prepared by Sarah Chen · 18 February 2026', { x: 0.5, y: 6.5, w: 9, h: 0.4, fontSize: 12 })

  const s2 = pptx.addSlide()
  s2.addText('Deliverables (4)', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 28, bold: true })
  s2.addText([
    { text: '1. Databricks workspace — DataCorp Cloud\n', options: { fontSize: 18 } },
    { text: '2. Power BI reports — operational, executive, finance\n', options: { fontSize: 18 } },
    { text: '3. Knowledge transfer — docs, runbooks, shadowing\n', options: { fontSize: 18 } },
    { text: '4. Data-quality monitoring (NEW, added 10 Feb steering)', options: { fontSize: 18, bold: true } },
  ], { x: 0.5, y: 1.2, w: 9, h: 4 })

  const s3 = pptx.addSlide()
  s3.addText('Cloud & Data Platform', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 28, bold: true })
  s3.addText([
    { text: 'Cloud vendor: DataCorp Cloud\n', options: { fontSize: 18, bold: true } },
    { text: '  - Reserved-instance pricing tier\n', options: { fontSize: 14 } },
    { text: '  - Region: Southeast Asia (Singapore)\n', options: { fontSize: 14 } },
    { text: 'Databricks workspace with Unity Catalog\n', options: { fontSize: 18 } },
    { text: 'Medallion architecture: bronze / silver / gold\n', options: { fontSize: 18 } },
    { text: 'Ingestion: SAP S/4HANA, Oracle EBS\n', options: { fontSize: 18 } },
  ], { x: 0.5, y: 1.2, w: 9, h: 4 })

  const s4 = pptx.addSlide()
  s4.addText('Timeline', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 28, bold: true })
  s4.addText([
    { text: 'Kickoff: 20 January 2026\n', options: { fontSize: 18 } },
    { text: 'Mid-engagement steering: 10 February 2026\n', options: { fontSize: 18 } },
    { text: 'Architecture sign-off: 20 February 2026\n', options: { fontSize: 18 } },
    { text: 'Final delivery: 30 March 2026 (revised from 15 March)', options: { fontSize: 18, bold: true } },
  ], { x: 0.5, y: 1.2, w: 9, h: 4 })

  await pptx.writeFile({ fileName: path.join(OUT, '04_Architecture_Design_v2.pptx') })
}

function writeXlsx() {
  const rows = [
    ['Risk ID', 'Description', 'Owner', 'Likelihood', 'Impact', 'Mitigation', 'Status'],
    ['R01', 'Vendor lock-in with DataCorp Cloud — non-standard procurement for NorthWind', 'Priya Ramesh', 'Medium', 'High', 'Document exit strategy; negotiate 90-day termination clause', 'Open'],
    ['R02', 'Marcus Lee departure 7 March creates handover gap', 'Priya Ramesh', 'High', 'High', 'Formal handover document; 2-week parallel run with James Tan', 'Open'],
    ['R03', 'Scope expansion (data-quality monitoring) may impact 30 March deadline', 'Sarah Chen', 'Medium', 'Medium', 'Weekly burndown review; descope candidates identified', 'Open'],
    ['R04', 'Unity Catalog permissions drift between dev and prod', 'James Tan', 'Low', 'High', 'Infrastructure-as-code baseline; automated drift detection', 'Mitigated'],
    ['R05', 'SAP source-system availability during ingestion peaks', 'Li Wei (NorthWind)', 'Medium', 'Medium', 'Incremental ingestion; 4-hour RPO tolerance agreed', 'Open'],
    ['R06', 'Power BI capacity SKU insufficient at full volume', 'Sarah Chen', 'Low', 'Medium', 'Capacity metrics app deployed; upgrade path priced', 'Open'],
    ['R07', 'Data residency — DataCorp Cloud SG region confirmed', 'Priya Ramesh', 'Low', 'High', 'Contractual confirmation in MSA; residency clause reviewed', 'Mitigated'],
    ['R08', 'Knowledge transfer insufficient given compressed timeline', 'Marcus Lee', 'Medium', 'High', 'Runbook-first documentation; video walkthroughs recorded', 'Open'],
  ]
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, 'Risk Register')
  XLSX.writeFile(wb, path.join(OUT, '05_Risk_Register.xlsx'))
}

function writeEml() {
  const eml = [
    'From: Sarah Chen <sarah.chen@temus.com>',
    'To: Priya Ramesh <priya.ramesh@temus.com>',
    'Subject: Architecture status — post-steering revisions',
    'Date: Thu, 19 Feb 2026 17:42:00 +0800',
    'Message-ID: <20260219-horizon-arch@temus.com>',
    '',
    'Hi Priya,',
    '',
    'Quick update before the Monday internal review.',
    '',
    'I\'ve finished revising the architecture design document to reflect the 10 Feb steering committee decisions — four deliverables now, with the data-quality monitoring workload mapped onto a new silver-layer job set. DataCorp Cloud provisioning is complete and James is running the baseline ingestion tests this week.',
    '',
    'One concern: the 30 March target is tight with the added scope. If NorthWind changes their mind on data-quality monitoring (Jun has been ambivalent in our side-chats), I\'d recommend we hold capacity to revert cleanly rather than committing further sunk cost. Worth a chat.',
    '',
    'Architecture v2 deck in the shared folder: 04_Architecture_Design_v2.pptx.',
    '',
    'Best,',
    'Sarah',
  ].join('\r\n')
  fs.writeFileSync(path.join(OUT, '07_Email_Sarah_to_Priya.eml'), eml)
}

function writeMd() {
  const md = `# Marcus Lee — Handover Notes

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
`
  fs.writeFileSync(path.join(OUT, '08_Marcus_Handover_Notes.md'), md)
}

async function main() {
  await writeDocx(path.join(OUT, '01_Project_Scope_v1.docx'), scope1)
  await writeDocx(path.join(OUT, '02_Kickoff_Meeting_Minutes.docx'), kickoff)
  await writeSteering()
  await writeArchPptx()
  writeXlsx()
  await writeDocx(path.join(OUT, '06_Weekly_Status_Update.docx'), status)
  writeEml()
  writeMd()
  await writeDocx(path.join(DROP, '09_Scope_Amendment_Confirmation.docx'), amend)
  console.log('All files generated.')
}

main().catch(e => { console.error(e); process.exit(1) })
