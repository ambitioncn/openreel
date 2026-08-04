const $ = selector => document.querySelector(selector);
let adminKey = "";

$("#load-applications").onclick = async () => { adminKey = $("#admin-key").value; await load(); };
$("#application-filter").onchange = () => adminKey && load();

async function load() {
  try {
    const status = $("#application-filter").value, applications = await request(`/api/v1/admin/key-applications${status ? `?status=${status}` : ""}`);
    $("#admin-state").textContent = `${applications.length} application(s)`;
    $("#application-list").replaceChildren(...applications.map(card));
  } catch (error) { $("#admin-state").textContent = `Error: ${error.message}`; }
}

function card(application) {
  const article = document.createElement("article"); article.className = "application-card";
  const heading = document.createElement("h2"); heading.textContent = application.email;
  const details = document.createElement("p"); details.textContent = `${application.status} · requested ${application.requestedLimitMicros} microcredits · ${application.reason}`;
  article.append(heading, details);
  if (application.status === "pending") article.append(actionForm(application, "approve"), actionForm(application, "reject"));
  if (application.status === "approved") article.append(actionForm(application, "stop"));
  if (application.reviewNote) { const note = document.createElement("p"); note.textContent = `Review: ${application.reviewNote}`; article.append(note); }
  return article;
}

function actionForm(application, action) {
  const form = document.createElement("form"); form.className = "application-action";
  const note = input("Review note", "text", action === "approve" ? "Approved for controlled use" : "Reason required"); form.append(note.label);
  let limit, expiry;
  if (action === "approve") { limit = input("Hard limit (microcredits)", "number", application.requestedLimitMicros); expiry = input("Access expires", "date", futureDate(30)); form.append(limit.label, expiry.label); }
  const button = document.createElement("button"); button.type = "submit"; button.textContent = action[0].toUpperCase() + action.slice(1); if (action !== "approve") button.className = "danger"; form.append(button);
  form.onsubmit = async event => { event.preventDefault(); button.disabled = true; try { const payload = { reviewNote: note.input.value }; if (action === "approve") Object.assign(payload, { plan: "manual", hardLimitMicros: Number(limit.input.value), periodEndsAt: new Date(`${expiry.input.value}T23:59:59.999Z`).toISOString() }); await request(`/api/v1/admin/key-applications/${application.id}/${action}`, { method: "POST", body: JSON.stringify(payload) }); await load(); } catch (error) { $("#admin-state").textContent = `Error: ${error.message}`; } finally { button.disabled = false; } };
  return form;
}

function input(labelText, type, value) { const label = document.createElement("label"), input = document.createElement("input"); label.textContent = labelText; input.type = type; input.value = value; input.required = true; if (type === "number") input.min = "1"; label.append(input); return { label, input }; }
function futureDate(days) { const date = new Date(Date.now() + days * 86400000); return date.toISOString().slice(0, 10); }
async function request(path, options = {}) { const response = await fetch(path, { ...options, headers: { "content-type": "application/json", "x-openreel-admin-key": adminKey } }), value = await response.json(); if (!response.ok) throw new Error(value.error?.message || "Request failed"); return value; }
