import { createGenerator, parseAccountInput } from "./totp.js";

const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = "cep2fa.accounts.v1";
const list = $("#accounts");
const accountDialog = $("#account-dialog");
const deleteDialog = $("#delete-dialog");
const form = $("#account-form");
const nameInput = $("#account-name");
const secretInput = $("#account-secret");
const saveButton = $("#save-account");
let accounts = [];
let editingId = null;
let deletingId = null;
let loaded = false;
let saving = false;
let timer;
let renderVersion = 0;
let ticking = false;
let rows = new Map();

const icons = {
  copy: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
  edit: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 4 5 5M4 20l5-1L20 8a2.2 2.2 0 0 0-5-5L4 14z"/></svg>',
  delete:
    '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>',
  timer:
    '<svg class="timer-ring" aria-hidden="true" viewBox="0 0 24 24"><circle class="ring-track" cx="12" cy="12" r="10"/><circle class="ring-progress" cx="12" cy="12" r="10"/></svg>',
};

function toast(message, error = false) {
  clearTimeout(timer);
  const element = $("#toast");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.hidden = false;
  timer = setTimeout(() => {
    element.hidden = true;
  }, 2600);
}

function showError(selector, message) {
  const element = $(selector);
  element.textContent = message;
  element.hidden = !message;
}

function actionButton(icon, label, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `icon-button ${className}`;
  button.innerHTML = icons[icon];
  button.setAttribute("aria-label", label);
  button.title = label;
  return button;
}

function applySearch() {
  const query = $("#search").value.trim().toLocaleLowerCase("en");
  let visible = 0;
  for (const account of accounts) {
    const row = rows.get(account.id);
    if (!row) continue;
    row.card.hidden = !account.name.toLocaleLowerCase("en").includes(query);
    if (!row.card.hidden) visible++;
  }
  $("#empty-state").hidden = !loaded || accounts.length !== 0;
  $("#no-results").hidden = !loaded || accounts.length === 0 || visible > 0;
}

function render() {
  renderVersion++;
  rows = new Map();
  list.replaceChildren();
  $("#account-count").textContent = accounts.length;
  list.setAttribute("aria-busy", "false");
  accounts.forEach((account, index) => {
    const card = document.createElement("article");
    card.className = "account-card";
    card.dataset.accountId = account.id;
    const top = document.createElement("div");
    top.className = "account-top";
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.dataset.tone = index % 5;
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = Array.from(account.name)[0].toLocaleUpperCase("en");
    const title = document.createElement("h2");
    title.className = "account-title";
    title.textContent = account.name;
    title.title = account.name;
    const actions = document.createElement("div");
    actions.className = "card-actions";
    const edit = actionButton("edit", `Edit ${account.name}`);
    edit.addEventListener("click", () => openAccount(account));
    const remove = actionButton("delete", `Delete ${account.name}`, "delete");
    remove.addEventListener("click", () => openDelete(account));
    actions.append(edit, remove);
    top.append(avatar, title, actions);
    const codeRow = document.createElement("div");
    codeRow.className = "code-row";
    const codeButton = document.createElement("button");
    codeButton.type = "button";
    codeButton.className = "code-button";
    codeButton.setAttribute("aria-label", `Copy code for ${account.name}`);
    codeButton.title = "Copy current code";
    const code = document.createElement("span");
    code.className = "code-text";
    code.textContent = "··· ···";
    codeButton.append(code);
    codeButton.insertAdjacentHTML("beforeend", icons.copy);
    const countdown = document.createElement("div");
    countdown.className = "countdown";
    countdown.innerHTML = icons.timer;
    const seconds = document.createElement("span");
    countdown.append(seconds);
    codeRow.append(codeButton, countdown);
    card.append(top, codeRow);
    list.append(card);
    const generator = createGenerator(account);
    const row = {
      card,
      code,
      codeButton,
      countdown,
      seconds,
      ring: countdown.querySelector(".ring-progress"),
      generator,
      step: -1,
    };
    generator.catch(() => markInvalid(row));
    rows.set(account.id, row);
    codeButton.addEventListener("click", async () => {
      try {
        const generate = await generator;
        await navigator.clipboard.writeText(await generate(Date.now()));
        toast("Code copied");
      } catch {
        toast(
          "Could not copy the code. Check the account and try again.",
          true,
        );
      }
    });
  });
  applySearch();
  void tick();
}

function markInvalid(row) {
  row.card.classList.add("invalid");
  row.code.textContent = "Check your secret";
  row.codeButton.disabled = true;
  row.countdown.hidden = true;
}

async function tick() {
  if (ticking) return;
  ticking = true;
  const version = renderVersion;
  try {
    await Promise.all(
      accounts.map(async (account) => {
        const row = rows.get(account.id);
        if (!row) return;
        try {
          const timestamp = Date.now();
          const elapsed = (timestamp / 1000) % account.period;
          const remaining = Math.ceil(account.period - elapsed);
          const step = Math.floor(timestamp / 1000 / account.period);
          row.seconds.textContent = `${remaining}s`;
          row.countdown.title = `Refreshes in ${remaining} seconds`;
          row.ring.style.strokeDashoffset = String(
            (62.832 * elapsed) / account.period,
          );
          row.card.classList.toggle("expiring", remaining <= 5);
          if (row.step !== step) {
            const generate = await row.generator;
            const code = await generate(timestamp);
            if (version !== renderVersion) return;
            const split = code.length / 2;
            row.code.textContent = `${code.slice(0, split)} ${code.slice(split)}`;
            row.step = step;
          }
        } catch {
          markInvalid(row);
        }
      }),
    );
  } finally {
    ticking = false;
  }
}

function setSecretVisible(visible) {
  secretInput.type = visible ? "text" : "password";
  $("#toggle-secret").textContent = visible ? "Hide" : "Show";
  $("#toggle-secret").setAttribute(
    "aria-label",
    visible ? "Hide secret" : "Show secret",
  );
  $("#toggle-secret").setAttribute("aria-pressed", String(visible));
}

function openAccount(account = null) {
  if (!loaded || saving) return;
  editingId = account?.id ?? null;
  form.reset();
  setSecretVisible(false);
  nameInput.value = account?.name ?? "";
  secretInput.value = account?.secret ?? "";
  $("#dialog-title").textContent = account
    ? "Edit account"
    : "Add a new account";
  saveButton.textContent = account ? "Save changes" : "Save account";
  showError("#form-error", "");
  accountDialog.showModal();
  nameInput.focus();
}

function closeAccount() {
  if (saving) return;
  accountDialog.close();
}

function openDelete(account) {
  if (saving) return;
  deletingId = account.id;
  $("#delete-description").textContent =
    `“${account.name}” will be removed from this browser.`;
  showError("#delete-error", "");
  deleteDialog.showModal();
  $("#cancel-delete").focus();
}

async function persist(next) {
  // Change the displayed state only after the browser has saved it successfully.
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  accounts = next;
  render();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saving || !loaded) return;
  showError("#form-error", "");
  saving = true;
  saveButton.disabled = true;
  let next;
  try {
    const current = accounts.find((account) => account.id === editingId);
    const parsed = parseAccountInput(secretInput.value, current);
    const name = (nameInput.value.trim() || parsed.suggestedName).slice(0, 100);
    if (!name) {
      nameInput.focus();
      throw new Error("Enter a name so you can find this account easily.");
    }
    const duplicate = accounts.find(
      (account) =>
        account.id !== editingId &&
        account.secret === parsed.secret &&
        account.algorithm === parsed.algorithm &&
        account.digits === parsed.digits &&
        account.period === parsed.period,
    );
    if (duplicate) throw new Error("This 2FA secret is already saved.");
    const account = {
      id: editingId ?? crypto.randomUUID(),
      name,
      secret: parsed.secret,
      algorithm: parsed.algorithm,
      digits: parsed.digits,
      period: parsed.period,
    };
    await createGenerator(account);
    next = editingId
      ? accounts.map((item) => (item.id === editingId ? account : item))
      : [...accounts, account];
  } catch (error) {
    showError("#form-error", error.message);
    saving = false;
    saveButton.disabled = false;
    return;
  }
  try {
    await persist(next);
    const wasEditing = Boolean(editingId);
    accountDialog.close();
    toast(wasEditing ? "Account updated" : "Account added");
  } catch {
    showError(
      "#form-error",
      "Could not save the account. Check your browser storage and try again.",
    );
  } finally {
    saving = false;
    saveButton.disabled = false;
  }
});

$("#delete-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saving || !deletingId) return;
  saving = true;
  $("#confirm-delete").disabled = true;
  try {
    await persist(accounts.filter((account) => account.id !== deletingId));
    deleteDialog.close();
    toast("Account deleted");
  } catch {
    showError(
      "#delete-error",
      "Could not delete the account. Please try again.",
    );
  } finally {
    saving = false;
    $("#confirm-delete").disabled = false;
  }
});

$("#add-account").addEventListener("click", () => openAccount());
$("#add-first").addEventListener("click", () => openAccount());
$("#close-dialog").addEventListener("click", closeAccount);
$("#cancel-dialog").addEventListener("click", closeAccount);
$("#toggle-secret").addEventListener("click", () =>
  setSecretVisible(secretInput.type === "password"),
);
$("#cancel-delete").addEventListener("click", () => {
  if (!saving) deleteDialog.close();
});
$("#search").addEventListener("input", applySearch);
accountDialog.addEventListener("cancel", (event) => {
  if (saving) event.preventDefault();
});
deleteDialog.addEventListener("cancel", (event) => {
  if (saving) event.preventDefault();
});
accountDialog.addEventListener("close", () => {
  form.reset();
  editingId = null;
  setSecretVisible(false);
});
deleteDialog.addEventListener("close", () => {
  deletingId = null;
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void tick();
});

function readRecords(stored) {
  if (stored === undefined) return [];
  if (!Array.isArray(stored)) throw new Error("Invalid storage");
  const ids = new Set();
  for (const account of stored) {
    if (
      !account ||
      typeof account.id !== "string" ||
      ids.has(account.id) ||
      typeof account.name !== "string" ||
      !account.name.trim() ||
      typeof account.secret !== "string"
    ) {
      throw new Error("Invalid storage");
    }
    ids.add(account.id);
  }
  return stored;
}

async function load() {
  try {
    if (!globalThis.chrome?.storage?.local)
      throw new Error("Extension context required");
    await chrome.storage.local.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    accounts = readRecords(stored[STORAGE_KEY]);
    loaded = true;
    render();
    setInterval(() => {
      void tick();
    }, 250);
  } catch {
    $("#add-account").disabled = true;
    list.setAttribute("aria-busy", "false");
    showError(
      "#storage-error",
      "Could not load accounts. Open this page using the extension icon in Chrome or Edge.",
    );
  }
}

void load();
