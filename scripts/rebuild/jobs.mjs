// Projects, job requests, dispatch jobs and everything the field wrote on them, invoices, photos.
import { join } from "node:path";
import { out, push, at, dayOffset, money, rate, P, productById, templateById, EMP, NAME, NOW, TODAY, CDT, CST, dataDir } from "./core.mjs";
import { ACCT, CONTACT, FAC, OPP, totals, generatedLines, activity } from "./accounts.mjs";

export const photoManifest = []; // { src, dest } — converted by main.mjs
export const fileManifest = []; // { src, dest } — copied as-is by main.mjs (lab reports)
const LAB_REPORT_DIR = join(dataDir, "..", "docs", "uploaded files");
// Sample-capture photos (2026-07-14 set): the three Front Line requires per sample, reused across samples.
const SAMPLE_PHOTO_POOL = {
  north: ["20260714_152144641_iOS.heic", "20260714_152338569_iOS.heic", "south 20260714_153927796_iOS.heic", "20260714_172334064_iOS.heic"],
  interval: ["20260714_153007375_iOS.heic", "20260714_152338569_iOS.heic", "20260714_152144641_iOS.heic"],
  label: ["20260714_154656225_iOS.heic", "20260714_160700983_iOS.heic", "20260714_161500109_iOS.heic", "20260714_163756097_iOS.heic", "20260714_164206244_iOS.heic", "20260714_164917605_iOS.heic", "20260714_165531691_iOS.heic", "20260714_170125155_iOS.heic", "20260714_170819516_iOS.heic", "20260714_173136977_iOS.heic", "south 20260714_155144920_iOS.heic", "south 20260714_162217950_iOS.heic", "south20260714_161148435_iOS.heic"],
};
const MIME = { ".pdf": "application/pdf", ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
let reportSeq = 0;
let resultSeq = 0;
export const PROJ = {};
const empName = (key) => NAME[key];
const empId = (key) => EMP[key];
const contactRow = (key) => out.contacts.find((c) => c.id === CONTACT[key]);
const facilityRow = (key) => out.facilities.find((f) => f.id === FAC[key]);
const accountRow = (key) => out.accounts.find((a) => a.id === ACCT[key]);

// ---- projects ---------------------------------------------------------------------------------
export function project(key, spec) {
  const id = spec.id || `proj-${key}`;
  PROJ[key] = id;
  const acct = accountRow(spec.account);
  const opp = spec.opp ? out.opportunities.find((o) => o.id === OPP[spec.opp]) : null;
  const row = {
    id, accountId: ACCT[spec.account], facilityId: spec.facility ? FAC[spec.facility] : "", opportunityId: opp?.id || "",
    contactIds: (spec.contacts || []).map((k) => CONTACT[k]),
    name: spec.name, jobClass: spec.jobClass, status: spec.status, activePhase: spec.stage, projectStage: spec.stage,
    projectManagerEmployeeId: spec.pm ? EMP[spec.pm] : "", projectManager: spec.pm ? NAME[spec.pm] : "", salesLead: spec.salesLead || acct.owner,
    startDate: spec.start, targetDate: spec.target, completedDate: spec.completed || "",
    budget: spec.budget ?? opp?.value ?? 0, value: spec.budget ?? opp?.value ?? 0, notToExceed: spec.nte || "",
    marginWatch: spec.marginWatch || (opp ? "Created from the won opportunity." : ""), outcome: spec.outcome || "",
    serviceType: opp?.serviceType || spec.serviceType || "", generatorName: spec.generatorName || acct.name, generatorSiteName: spec.facility ? facilityRow(spec.facility).name : "",
    generatorContactName: spec.generatorContact ? contactRow(spec.generatorContact).name : "", generatorContactPhone: spec.generatorContact ? contactRow(spec.generatorContact).phone : "",
    epaId: spec.epaId || "", tceqId: spec.tceqId || "", insuranceContact: spec.insuranceContact || "", insuranceCarrier: spec.insuranceCarrier || "", claimNumber: spec.claimNumber || "", serviceProfile: spec.serviceProfile || "",
    equipmentNeeds: opp?.equipmentNeeds || [], vendorNeeds: opp?.vendorNeeds || [], resourceNeeds: opp?.resourceNeeds || [],
    siteWalkStatus: opp?.siteWalkStatus || "Incomplete", sitePhotoRefs: [], quoteId: opp?.quoteId || "", estimateId: opp?.estimateId || "",
    ...(spec.emergency || {}),
  };
  const saved = push("projects", row, spec.createdAt || at(spec.start, "08:00"), spec.updatedAt || NOW);
  (spec.assignments || []).forEach(([empKey, role]) => {
    const user = out.systemUsers.find((u) => u.employeeId === EMP[empKey]);
    push("projectAssignments", { id: `assign-${key}-${empKey}`, projectId: id, userName: NAME[empKey], userEmail: user?.internalEmailAddress || "", globalRole: user?.role || "", assignedRole: role, status: "Active" }, saved.createdAt);
  });
  return saved;
}

// ---- dispatch jobs ----------------------------------------------------------------------------
const LADDER = ["draft", "ready", "scheduled", "dispatched", "acknowledged", "en_route", "on_site", "in_progress", "field_complete", "office_review", "closed"];
const DISPATCH_LABEL = { draft: "Unassigned", ready: "Ready to schedule", scheduled: "Scheduled", dispatched: "Sent", acknowledged: "Acknowledged", en_route: "En route", on_site: "On site", in_progress: "In field", field_complete: "Returned", office_review: "Returned", closed: "Closed" };
const COMPLETION = { draft: 0, ready: 0, scheduled: 0, dispatched: 8, acknowledged: 10, en_route: 15, on_site: 20, in_progress: 25, field_complete: 100, office_review: 100, closed: 100 };
const OFFICE_REVIEW = { draft: "Pending", ready: "Ready", scheduled: "Ready", dispatched: "Ready", acknowledged: "Ready", en_route: "Ready", on_site: "Ready", in_progress: "Ready", field_complete: "Pending review", office_review: "In review", closed: "Closed" };
let attachmentSeq = 0;
let documentSeq = 0;

export function sitePhotos(entityType, entityId, accountId, files, { captions = {}, uploadedBy = NAME.logan, uploadedAt = NOW, tags = [] } = {}) {
  files.forEach((file) => {
    documentSeq += 1;
    const id = `document-photo-${String(documentSeq).padStart(3, "0")}`;
    const storageName = `${id}.jpg`;
    photoManifest.push({ src: file, dest: storageName });
    push("documents", { id, entityType, entityId, accountId, documentTypeId: "doctype-site-photo", requirementId: "", fileName: file.replace(/\.(heic|HEIC|jpeg|JPG)$/, ".jpg"), mimeType: "image/jpeg", sizeBytes: 0, sha256: "", storageName, groupId: id, versionNumber: 1, visibility: "internal", caption: captions[file] || "", tags, uploadedAt, uploadedBy, uploadedBySessionKind: "user", retainUntil: "" }, uploadedAt);
  });
}

export function buildJob(spec) {
  const template = templateById.get(spec.templateId);
  if (!template) throw new Error(`No template ${spec.templateId}`);
  const id = `dispatch-job-${spec.key}`;
  const status = spec.status;
  const reached = LADDER.indexOf(status);
  const lead = spec.fieldLead;
  const crew = spec.crew || [];
  const start = spec.start;
  const end = spec.end || spec.start;
  const created = spec.createdAt || at(dayOffset(start.slice(0, 10), -1), "09:00");
  const offset = spec.offset || CDT;
  const project = out.projects.find((p) => p.id === PROJ[spec.project]);
  const acct = accountRow(spec.account);
  const contact = spec.contact ? contactRow(spec.contact) : null;
  const days = spec.days || [];
  const firstDay = days[0]?.date || start.slice(0, 10);

  // Status ladder timestamps.
  const t = {};
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const createdMs = new Date(created).getTime();
  const iso = (ms) => new Date(ms).toISOString();
  t.draft = created;
  t.ready = iso(createdMs + 5 * 60000);
  t.scheduled = iso(createdMs + 12 * 60000);
  t.dispatched = iso(Math.max(createdMs + 15 * 60000, startMs - 120 * 60000));
  t.acknowledged = iso(Math.max(createdMs + 16 * 60000, startMs - 110 * 60000));
  t.en_route = iso(startMs - 55 * 60000);
  t.on_site = iso(startMs);
  t.in_progress = iso(startMs + 15 * 60000);
  t.field_complete = iso(endMs);
  t.office_review = iso(endMs + 60 * 60000);
  t.closed = spec.closedAt || iso(endMs + 20 * 3600000);
  const updatedAt = spec.updatedAt || (reached >= 0 ? t[status] : created);

  const job = push("dispatchJobs", {
    id, jobNumber: spec.jobNumber, jobRequestId: spec.requestId || "", jobTypeTemplateId: template.id,
    accountId: acct.id, projectId: project.id, projectName: project.name, customerName: acct.name, jobName: spec.name,
    jobType: template.name, jobTypeCode: template.serviceCategory === "ER" ? "ER" : template.serviceCategory === "Scheduled" ? "SVC" : template.serviceCategory === "Sampling" ? "SMP" : template.serviceCategory === "Remediation" ? "REM" : "ABT", jobTypeVersion: 1,
    status, dispatchStatus: DISPATCH_LABEL[status], officeReviewStatus: OFFICE_REVIEW[status], priority: spec.priority || "Normal",
    requestedServiceAt: spec.requestedAt || start, scheduledStart: start, scheduledEnd: end, timezone: "America/Chicago",
    fieldLeadEmployeeId: empId(lead), locationName: spec.location, addressText: spec.address, latitude: spec.lat, longitude: spec.lng,
    onsiteContactName: contact?.name || spec.contactName || "", onsiteContactPhone: contact?.mobilePhone || contact?.phone || spec.contactPhone || "",
    generatorResponsibleParty: acct.name, customerPoNumber: spec.po || "", bioremedyPoNumber: spec.brPo || "", pricingSource: "2026 Rate Sheet",
    description: spec.description, equipmentNotes: spec.equipmentNotes || "", laborNotes: spec.laborNotes || "", vendorNotes: spec.vendorNotes || "",
    readinessStatus: spec.readiness || "Ready", completionPercent: COMPLETION[status],
    operationalDate: reached >= LADDER.indexOf("in_progress") ? firstDay : "",
    dailyNarratives: days.filter((d) => d.scene).map((d) => ({ date: d.date, sceneDescription: d.scene, sceneActivities: d.activities, updatedBy: empName(lead), updatedAt: at(d.date, "17:30", offset) })),
    postJobReview: status === "closed" || status === "office_review" ? { accidents: "No", nearMisses: spec.nearMiss ? "Yes" : "No", injuries: "No", notes: spec.reviewNotes || "", answeredBy: empName(lead), answeredAt: t.field_complete } : null,
    ...(spec.extra || {}),
  }, created, updatedAt);

  // Status events.
  for (let i = 1; i <= reached; i += 1) {
    const to = LADDER[i];
    const by = i <= 3 || i >= 9 ? (spec.dispatcher || NAME.logan) : empName(lead);
    push("jobStatusEvents", { id: `job-status-event-${spec.key}-${to}`, jobId: id, fromStatus: LADDER[i - 1], toStatus: to, occurredAt: t[to], by }, t[to]);
  }

  // Assignments.
  const assign = (empKey, role, isLead) => push("jobAssignments", { id: `ja-${spec.key}-${empKey}`, jobId: id, employeeId: empId(empKey), crewId: "crew-response-a", role, isFieldLead: isLead, status: reached >= LADDER.indexOf("closed") ? "Complete" : "Assigned", eligibilityStatus: "Eligible", eligibilityNote: "", plannedStart: start, plannedEnd: end }, t.scheduled);
  if (reached >= LADDER.indexOf("scheduled")) {
    assign(lead, "Field Lead", true);
    crew.forEach((k) => assign(k, "Technician", false));
  }
  if (reached >= LADDER.indexOf("scheduled")) push("jobScheduleSegments", { id: `segment-${spec.key}-1`, jobId: id, type: "Work", name: `${template.name} work`, sequence: 1, plannedStart: start, plannedEnd: end, status: reached >= LADDER.indexOf("closed") ? "Complete" : "Confirmed", lockedForDispatch: reached >= LADDER.indexOf("dispatched"), notes: "" }, t.scheduled);

  // Work plan from the template. `spec.completedStages` limits how far an in-progress job got.
  const stages = [...template.stages].sort((a, b) => a.sequence - b.sequence);
  const allDone = reached >= LADDER.indexOf("field_complete");
  const started = reached >= LADDER.indexOf("in_progress");
  const completedStages = allDone ? stages.length : started ? spec.completedStages ?? 1 : 0;
  const completedTasksInCurrent = started && !allDone ? spec.completedTasksInCurrent ?? 0 : 0;
  const actionsByType = {};
  stages.forEach((stage, stageIndex) => {
    const stageDone = stageIndex < completedStages;
    const stageCurrent = stageIndex === completedStages;
    const stepStatus = stageDone ? "Complete" : stageCurrent && (started || stageIndex === 0) ? (started ? "In progress" : "Available") : "Not started";
    const step = push("jobSteps", { id: `step-${spec.key}-${stage.key}`, jobId: id, key: stage.key, name: stage.name, sequence: stageIndex + 1, status: stepStatus, required: true }, created, stageDone ? t.field_complete : created);
    stage.tasks.forEach((task, taskIndex) => {
      let actionStatus = "Not started";
      if (stageDone) actionStatus = "Complete";
      else if (stageCurrent) {
        if (started) actionStatus = taskIndex < completedTasksInCurrent ? "Complete" : taskIndex === completedTasksInCurrent ? "Available" : "Blocked";
        else if (stageIndex === 0) actionStatus = taskIndex === 0 ? (reached >= LADDER.indexOf("acknowledged") && task.type === "Status transition" ? "Complete" : "Available") : "Blocked";
      }
      const action = push("jobActions", { id: `action-${spec.key}-${task.key}`, jobId: id, stepId: step.id, key: task.key, name: task.name, sequence: taskIndex + 1, type: task.type, status: actionStatus, required: Boolean(task.required), assigneeScope: task.assigneeScope, formName: task.type === "Status transition" ? "" : task.name, config: task.config || {} }, created, actionStatus === "Complete" ? t.field_complete : created);
      (actionsByType[task.type] ||= []).push({ action, done: actionStatus === "Complete" });
    });
  });
  const doneActions = (type) => (actionsByType[type] || []).filter((x) => x.done).map((x) => x.action);
  let subSeq = 0;
  const submit = (action, by, when, summary, payload) => {
    subSeq += 1;
    return push("jobFormSubmissions", { id: `form-sub-${spec.key}-${subSeq}`, jobId: id, actionId: action.id, formName: action.name, status: "Submitted", submittedBy: by, submittedAt: when, summary, payload }, when);
  };

  // Ad-hoc step and actions, the way Front Line's "+ Activity" creates them (repeatable Photo/Sample capture).
  let adHocStep = null;
  let adHocSeq = 0;
  const adHocAction = (type, when) => {
    if (!adHocStep) adHocStep = push("jobSteps", { id: `step-${spec.key}-adhoc`, jobId: id, name: "Additional field activity", sequence: stages.length + 1000, status: "Complete", adHoc: true }, when);
    adHocSeq += 1;
    return push("jobActions", { id: `action-${spec.key}-adhoc-${adHocSeq}`, jobId: id, stepId: adHocStep.id, sequence: adHocSeq, name: `Ad hoc: ${type}`, formName: `Ad hoc: ${type}`, type, assigneeScope: "Any assigned worker", status: "Complete", adHoc: true, config: {} }, when);
  };
  const attach = (actionId, file, caption, when, by) => {
    attachmentSeq += 1;
    const attachmentId = `job-task-attachment-${spec.key}-${attachmentSeq}`;
    const storageName = `${attachmentId}.jpg`;
    photoManifest.push({ src: file, dest: storageName });
    return push("jobTaskAttachments", { id: attachmentId, jobId: id, actionId, kind: "photo", fileName: file.replace(/\.(heic|HEIC|jpeg|JPG)$/, ".jpg"), storageName, mimeType: "image/jpeg", sizeBytes: 0, caption, uploadedAt: when, uploadedBy: by }, when);
  };

  // Field records per work day.
  const timerAction = doneActions("Timer")[0];
  const materialAction = doneActions("Material")[0];
  const templateSampleAction = doneActions("Sample")[0];
  const firstDayStart = days.length ? at(days[0].date, days[0].from || "08:00", offset) : t.in_progress;
  const lastDayEnd = days.length ? at(days[days.length - 1].date, days[days.length - 1].to || "17:00", offset) : t.field_complete;
  const hasPhotos = days.some((d) => (d.photos || []).length);
  const photoAction = hasPhotos ? doneActions("Photo")[0] || adHocAction("Photo", firstDayStart) : null;
  let photoCount = 0;
  let sampleSeq = 0;
  let mileageSeq = 0;
  days.forEach((day, dayIndex) => {
    const dayStart = at(day.date, day.from || "08:00", offset);
    const dayEnd = at(day.date, day.to || "17:00", offset);
    for (const [empKey, hours] of Object.entries(day.hours || {})) {
      push("timeEntries", { id: `time-entry-${spec.key}-${day.date}-${empKey}`, employeeId: empId(empKey), dispatchJobId: id, entryType: "work", startedAt: dayStart, endedAt: new Date(new Date(dayStart).getTime() + hours * 3600000).toISOString(), durationMinutes: Math.round(hours * 60), notes: `${spec.name} — day ${dayIndex + 1}`, source: "frontline-timesheet" }, dayEnd);
      if (timerAction) submit(timerAction, empName(empKey), dayEnd, `${hours} h on ${day.date}`, { hours, computedHours: hours, timerAnchor: timerAction.config?.anchor || "on_site", notes: "" });
    }
    if (day.miles && dayIndex === 0) {
      mileageSeq += 1;
      push("jobMileageEntries", { id: `mileage-${spec.key}-${mileageSeq}`, employeeId: empId(lead), dispatchJobId: id, mileageType: "travel_to", beginningOdometer: day.miles[0], endingOdometer: day.miles[1], calculatedDistance: day.miles[1] - day.miles[0], capturedAt: dayStart, notes: "Shop to site" }, dayStart);
    }
    (day.photos || []).forEach((file, photoIndex) => {
      photoCount += 1;
      attach(photoAction.id, file, (day.captions || {})[file] || `Day ${dayIndex + 1} — photo ${photoIndex + 1}`, dayEnd, empName(day.photographer || lead));
    });
    (day.materials || []).forEach(([inventoryItemId, quantity], materialIndex) => {
      const item = out.inventoryItems.find((i) => i.id === inventoryItemId);
      if (!item) throw new Error(`Unknown inventory item ${inventoryItemId}`);
      push("jobResources", { id: `job-resource-${spec.key}-${day.date}-m${materialIndex + 1}`, jobId: id, actionId: materialAction?.id || "", inventoryItemId, type: "Material", name: item.materialType, assetTag: "", quantity, unit: item.unit, status: "Consumed", consumedAt: dayEnd, consumedBy: empName(lead) }, dayEnd);
      push("materialUsage", { id: `mat-${spec.key}-${day.date}-${materialIndex + 1}`, projectId: project.id, accountId: acct.id, materialType: item.materialType, quantity, unit: item.unit, loggedBy: empName(lead), timestamp: dayEnd }, dayEnd);
    });
    (day.samples || []).forEach((sample) => {
      sampleSeq += 1;
      const when = at(day.date, sample.time || "10:00", offset);
      // One action per sample, as Front Line records them: the template's Sample task for the first, ad hoc after that.
      const action = sampleSeq === 1 && templateSampleAction ? templateSampleAction : adHocAction("Sample", when);
      const collector = empName(sample.collector || lead);
      const sampleId = `${spec.jobNumber}-${String(sampleSeq).padStart(2, "0")}`;
      const pool = SAMPLE_PHOTO_POOL;
      [["North view", pool.north[sampleSeq % pool.north.length]], ["Sample interval", pool.interval[sampleSeq % pool.interval.length]], ["Container label", pool.label[sampleSeq % pool.label.length]]].forEach(([caption, file]) => attach(action.id, file, caption, when, collector));
      const recordId = `sample-${spec.key}-${sampleSeq}`;
      const reportIds = (sample.labReports || []).map((file) => {
        reportSeq += 1;
        const reportId = `sample-lab-report-${String(reportSeq).padStart(3, "0")}`;
        const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
        const storageName = `${reportId}${extension}`;
        fileManifest.push({ src: join(LAB_REPORT_DIR, file), dest: storageName });
        push("sampleLabReports", { id: reportId, sampleId: recordId, fileName: file, storageName, mimeType: MIME[extension] || "application/octet-stream", sizeBytes: 0, uploadedAt: sample.labReceivedAt || NOW, uploadedBy: sample.reviewedBy || NAME.logan }, sample.labReceivedAt || NOW);
        return reportId;
      });
      push("sampleRecords", { id: recordId, sampleId, samplingSessionId: `session-${spec.key}`, samplingSessionName: `${spec.name} — sampling`, projectId: project.id, dispatchJobId: id, actionId: action.id, accountId: acct.id, facilityId: project.facilityId, sampleLocation: sample.location, sampleType: sample.type || "Soil", sampleMatrix: sample.matrix || "Soil", collectionMethod: sample.method || "Direct-push grab", depthInterval: sample.depth || "", collectionTime: when, collector, gpsAccuracyMeters: 3, latitude: sample.lat ?? spec.lat, longitude: sample.lng ?? spec.lng, containerSummary: sample.containers || "2 amber jars, 3 VOA vials", preservation: "Cooled to 4 °C", requestedAnalyses: sample.analyses || ["TPH (TX1005)", "BTEX"], fieldNotes: sample.notes || "", chainOfCustody: spec.coc || "", labName: sample.labName || "Eurofins Environment Testing — Austin", labStatus: sample.labStatus || "Pending", labResults: sample.results || "", photos: [], labReceivedAt: sample.labReceivedAt || "", reviewedBy: sample.reviewedBy || "", labReportUri: "" }, when, sample.labReceivedAt || when);
      submit(action, collector, when, `${sampleId} — ${sample.location}`, { sampleId, sampleLocation: sample.location, sampleMatrix: sample.matrix || "Soil", depthInterval: sample.depth || "", requestedAnalyses: (sample.analyses || ["TPH (TX1005)", "BTEX"]).join("\n"), notes: sample.notes || "" });
      (sample.analytics || []).forEach((row) => {
        resultSeq += 1;
        const resultValue = String(row.value);
        const parsed = Number(resultValue);
        const resultNumeric = resultValue !== "" && Number.isFinite(parsed) ? parsed : null;
        const actionLevel = row.actionLevel ?? null;
        push("sampleResults", { id: `sample-result-${String(resultSeq).padStart(3, "0")}`, sampleId: recordId, projectId: project.id, analyte: row.analyte, method: row.method || "TX1005", resultValue, resultNumeric, units: row.units || "mg/kg", detectionLimit: row.mdl ?? null, reportingLimit: row.rl ?? null, qualifier: row.qualifier || "", actionLevel, actionLevelSource: actionLevel != null ? row.source || "TRRP Tier 1 residential (sample data)" : "", exceedsActionLevel: resultNumeric != null && actionLevel != null && resultNumeric > actionLevel, labReportId: reportIds[0] || "", reportedOn: sample.labReceivedAt ? sample.labReceivedAt.slice(0, 10) : "", enteredBy: sample.reviewedBy || NAME.logan, deletedAt: "" }, sample.labReceivedAt || NOW);
      });
    });
  });
  if (photoAction) submit(photoAction, empName(lead), lastDayEnd, `${photoCount} photo${photoCount === 1 ? "" : "s"}`, { photoCount, minPhotos: 1 });

  // Equipment on the job.
  (spec.equipment || []).forEach((assetTag, index) => {
    const asset = out.equipmentAssets.find((a) => a.assetTag === assetTag);
    if (!asset) throw new Error(`Unknown asset ${assetTag}`);
    push("jobResources", { id: `job-resource-${spec.key}-e${index + 1}`, jobId: id, type: "Equipment", name: asset.equipment, assetTag, inventoryItemId: "", quantity: 1, unit: "each", status: allDone ? "Returned" : "Assigned" }, t.scheduled);
    if (!allDone && started) asset.assignedProjectId = project.id;
    push("equipmentLogs", { id: `equip-${spec.key}-${index + 1}`, projectId: project.id, accountId: acct.id, assetTag, equipment: asset.equipment, truckId: spec.truck || "TRK-101", checkedOut: t.en_route, returned: allDone ? t.field_complete : "", condition: "In service", user: empName(lead) }, t.en_route);
  });

  // The other completed forms: arrival, checklists, recap, signature.
  if (allDone) {
    for (const { action } of (actionsByType.Form || []).filter((x) => x.done)) {
      submit(action, empName(lead), /arriv/i.test(action.name) ? t.on_site : t.field_complete, /arriv/i.test(action.name) ? `On site, met ${contact?.name || "the customer"}` : spec.recap || "Work complete; site left clean.", /arriv/i.test(action.name) ? { siteContactVerified: true, contactName: contact?.name || "" } : { notes: spec.recap || "" });
    }
    for (const { action } of (actionsByType.Checklist || []).filter((x) => x.done)) {
      const options = action.config?.options || [];
      submit(action, empName(lead), t.in_progress, options.length ? `${options.length}/${options.length} items checked` : "Checklist complete", { checked: options, options });
    }
    for (const { action } of (actionsByType.Signature || []).filter((x) => x.done)) {
      submit(action, empName(lead), t.field_complete, `Signed by ${contact?.name || "customer"}`, { signerRole: "Customer", signedBy: contact?.name || "" });
    }
  }
  if (spec.messages) {
    spec.messages.forEach(([whenOffsetMinutes, from, to, body], index) => {
      const when = iso(startMs + whenOffsetMinutes * 60000);
      const fromEmp = from === "office" ? null : from;
      push("messages", { id: `message-${spec.key}-${index + 1}`, threadKey: id, dispatchJobId: id, senderId: fromEmp ? empId(fromEmp) : "office", senderName: fromEmp ? empName(fromEmp) : "Dispatch", senderRole: fromEmp ? "field" : "office", recipientId: to === "office" ? "office" : empId(to), recipientName: to === "office" ? "Dispatch" : empName(to), body, sentAt: when, readAt: reached >= LADDER.indexOf("closed") ? when : null }, when);
    });
  }
  if (spec.weather) {
    if (project.incidentReportedAt) push("weatherSnapshots", { id: `weather-${spec.key}-incident`, projectId: project.id, dispatchJobId: "", kind: "incident", observedFor: project.incidentReportedAt, latitude: spec.lat, longitude: spec.lng, anchorSource: "Emergency intake pin", anchorLocationId: "", anchorLabel: spec.location, requestedBy: spec.dispatcher || NAME.charlotte, fetchedAt: project.incidentReportedAt, status: "captured", error: "", provider: "Open-Meteo", providerEndpoint: "https://api.open-meteo.com/v1/forecast", observationTime: project.incidentReportedAt, ...spec.weather, temperatureF: Math.round((spec.weather.temperatureF - 3.4) * 10) / 10 }, project.incidentReportedAt);
    push("weatherSnapshots", { id: `weather-${spec.key}-response`, projectId: project.id, dispatchJobId: id, kind: "response", observedFor: t.in_progress, latitude: spec.lat, longitude: spec.lng, anchorSource: "Job site", anchorLocationId: "", anchorLabel: spec.location, requestedBy: empName(lead), fetchedAt: t.in_progress, status: "captured", error: "", provider: "Open-Meteo", providerEndpoint: "https://api.open-meteo.com/v1/forecast", observationTime: t.in_progress, ...spec.weather }, t.in_progress);
  }
  return job;
}

// Job request that became (or will become) a dispatch job.
export function request(key, spec) {
  const id = `req-${key}`;
  const acct = accountRow(spec.account);
  const contact = spec.contact ? contactRow(spec.contact) : null;
  push("jobRequests", { id, requestNumber: spec.number, projectId: PROJ[spec.project], receivedAt: spec.receivedAt, requestedServiceAt: spec.serviceAt, requestedTimeText: spec.timeText || "", status: spec.status || "Converted", priority: spec.priority || "Normal", serviceCategory: spec.category, accountId: acct.id, customerName: acct.name, customerPoNumber: spec.po || "", bioremedyPoNumber: "", generatorResponsibleParty: acct.name, calledInByName: spec.calledInBy || contact?.name || "", onsiteContactName: contact?.name || "", onsiteContactPhone: contact?.phone || "", addressText: spec.address, estimatedDurationMinutes: spec.minutes || 480, requestedEmployeeId: spec.requestedEmployee ? EMP[spec.requestedEmployee] : "", requestedAssignee: spec.requestedEmployee ? NAME[spec.requestedEmployee] : "", equipmentNotes: spec.equipmentNotes || "", laborNotes: spec.laborNotes || "", vendorNotes: spec.vendorNotes || "", pricingNotes: spec.pricingNotes || "", description: spec.description, customerPacketStatus: spec.packet || "On file", quoteStatus: spec.quoteStatus || "Accepted", convertedJobId: spec.convertedJobId || "", receivedBy: spec.receivedBy || NAME.charlotte, statusNote: spec.statusNote || "", statusChangedAt: spec.statusChangedAt || spec.receivedAt, statusChangedBy: spec.receivedBy || NAME.charlotte }, spec.receivedAt, spec.statusChangedAt || spec.receivedAt);
  return id;
}

// Invoice with itemized lines priced from the rate sheet.
let invoiceSeq = 0;
export function invoice(key, spec) {
  const id = `invoice-${key}`;
  const project = out.projects.find((p) => p.id === PROJ[spec.project]);
  const acct = out.accounts.find((a) => a.id === project.accountId);
  const tier = spec.tier || "standard";
  const items = spec.lines.map((line, index) => {
    const product = productById.get(line.productId);
    const r = rate(line.productId, line.tier || tier);
    const billable = Math.max(line.quantity, line.minimum || 0);
    return { lineKind: "item", productId: product.id, productName: product.name, productDescription: line.description || product.name, isProductOverridden: false, uomId: r.uomId, quantity: line.quantity, billableQuantity: billable, minimumQuantity: line.minimum || 0, minimumApplied: billable > line.quantity, rateTier: line.tier || tier, pricingMethod: "rate", unitCost: null, markupPercent: null, pricePerUnit: r.amount, extendedAmount: money(r.amount * billable), fuelSurchargeApplies: Boolean(product.fuelSurchargeApplies), manualDiscountAmount: 0, tax: 0, isOptional: false, isTaxable: false, operationalDate: line.day || "", sequenceNumber: index + 1 };
  });
  const t = totals(items);
  invoiceSeq += 1;
  push("invoices", { id, projectId: project.id, customer: acct.name, invoiceNumber: spec.number, invoiceDate: spec.date, dueDate: dayOffset(spec.date, 30), status: spec.status, priceLevelId: "price-standard-2026", quotedAmount: project.value || 0, reportedLocation: spec.location || "", termsText: "Net 30. Pricing per the 2026 rate sheet; emergency call-outs carry a 4-hour minimum.", notes: spec.notes || "", rateTier: tier, fuelSurchargePercent: 10, energySecurityFeePercent: 18, subtotalAmount: t.subtotal, fuelSurchargeAmount: t.fuelSurcharge, energySecurityFeeAmount: t.fee, totalAmount: t.total, totalAmountBase: t.total, taxRatePercent: 0, taxableAmount: 0, taxAmount: 0, invoiceAmount: t.total, fieldExpenses: spec.fieldExpenses || 0, qboStatus: spec.status === "Paid" || spec.status === "Sent" || spec.status === "Past due" ? "Exported" : "Not exported" }, at(spec.date, "10:00"), spec.paidAt || at(spec.date, "10:00"));
  [...items, ...generatedLines(t)].forEach((line, index) => push("invoiceLines", { id: `${id}-line-${index + 1}`, invoiceId: id, ...line, sequenceNumber: index + 1 }, at(spec.date, "10:00")));
  if (spec.status !== "Draft") push("qboExports", { id: `qbo-export-${key}`, invoiceId: id, status: "Exported — QuickBooks Online" }, at(spec.date, "10:30"));
  return t;
}

export { activity };
