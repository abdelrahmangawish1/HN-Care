import { auth, db, authPersistence } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import QRCode from "https://esm.sh/qrcode";
import { languageNames, translate, translations } from "./translations.js";

const languageStorageKey = "hn-care-language";
const seniorAccessibilityStorageKey = "hn-care-senior-accessibility";
const supportedLanguages = Object.keys(languageNames);
let language = localStorage.getItem(languageStorageKey);
if (!supportedLanguages.includes(language)) language = "ar";
let seniorAccessibilityEnabled = localStorage.getItem(seniorAccessibilityStorageKey) === "true";
document.documentElement.classList.toggle("senior-accessibility", seniorAccessibilityEnabled);
let authMode = "login";
let currentUser = null;
let recordsById = new Map();
let medicationsById = new Map();
let passportData = null;
let triageResultState = null;
const calculatorResults = new Map();
let map;
let pharmacyLayer;
let mapAttribution;
let pharmacyItems = [];
let pharmacyMarkers = [];
let currentFacilityType = "pharmacy";
let medicineImageUrl = null;
let labImageUrl = null;
const maxMedicineImageBytes = 5 * 1024 * 1024;
const allowedMedicineImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const element = (selector) => document.querySelector(selector);
const text = (key) => translate(language, key);

function applyLanguage(nextLanguage) {
  language = supportedLanguages.includes(nextLanguage) ? nextLanguage : "en";
  localStorage.setItem(languageStorageKey, language);
  document.documentElement.lang = language === "zh" ? "zh-CN" : language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  document.title = text("appTitle");
  document.querySelector('meta[name="description"]').content = text("heroDescription");
  element("#language-select").value = language;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.dataset.i18n;
    if (key) node.textContent = text(key);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.placeholder = text(node.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((node) => {
    node.setAttribute("aria-label", text(node.dataset.i18nAria));
  });
  document.querySelectorAll("[data-i18n-alt]").forEach((node) => {
    node.alt = text(node.dataset.i18nAlt);
  });
  document.querySelectorAll("[data-i18n-address]").forEach((node) => {
    const address = node.dataset.addressMissing === "true"
      ? text("noAddress")
      : node.dataset.address;
    node.textContent = `${text("address")}: ${address}`;
  });
  document.querySelectorAll("form[data-busy-translation]").forEach((form) => {
    if (form.dataset.busyTranslation) {
      form.querySelector('button[type="submit"]').textContent = text("loading");
    }
  });
  renderAuthMode();
  renderInteractionInputs();
  renderPassportPreview();
  renderTriageResult();
  renderCalculatorResults();
  if (currentUser) {
    renderRecords();
    renderMedications();
  }
  element(".main-navigation").setAttribute("aria-label", text("mainNavigation"));
  element("#pharmacy-map").setAttribute("aria-label", text("pharmacyMap"));
  element(".hero-art").setAttribute("aria-label", text("healthcareIllustration"));
  if (element("#record-form").elements.recordId.value) {
    element('#record-form button[type="submit"]').textContent = text("save");
  }
  for (const [selector, state] of statusStates) {
    const message = state.key
      ? `${text(state.key)}${state.count === undefined ? "" : `: ${state.count}`}`
      : state.message;
    const target = element(selector);
    target.textContent = message;
    target.dataset.state = state.type;
  }
  if (map && mapAttribution) {
    map.attributionControl.removeAttribution(mapAttribution);
    mapAttribution = text("mapAttribution");
    map.attributionControl.addAttribution(mapAttribution);
  }
  document.dispatchEvent(new CustomEvent("hncare:languagechange", {
    detail: { open: text("openMenu"), close: text("closeMenu") },
  }));
}

const statusStates = new Map();

function setStatus(selector, message, type = "", keyOverride, count) {
  const target = element(selector);
  const key = Object.keys(translations[language]).find((candidate) => translations[language][candidate] === message);
  statusStates.set(selector, { key: keyOverride || key, count, message, type });
  target.textContent = message;
  target.dataset.state = type;
}

function setBusy(form, busy, submitText) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  button.disabled = busy;
  form.dataset.busyTranslation = busy ? submitText : "";
  button.textContent = busy ? text("loading") : text(submitText);
}

function renderAuthMode() {
  const signup = authMode === "signup";
  const reset = authMode === "reset";
  element("#auth-name-wrap").hidden = !signup;
  element("#auth-password-wrap").hidden = reset;
  element("#auth-confirm-wrap").hidden = !signup;
  element("#forgot-password").hidden = reset;
  element("#auth-submit").textContent = text(reset ? "sendReset" : signup ? "signUp" : "signIn");
  element("#auth-password").required = !reset;
  element("#auth-name").required = signup;
  element("#auth-confirm").required = signup;
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.authMode === authMode));
  });
}

function authErrorMessage(error) {
  switch (error?.code) {
    case "auth/invalid-email":
      return text("invalidEmail");
    case "auth/weak-password":
      return text("passwordLength");
    case "auth/unauthorized-domain":
      return text("authDomainNotAuthorized").replace("{domain}", window.location.hostname);
    case "auth/operation-not-allowed":
      return text("authEmailSignInDisabled");
    case "auth/configuration-not-found":
      return text("authProjectNotConfigured");
    case "auth/email-already-in-use":
      return text("authEmailAlreadyUsed");
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/user-disabled":
      return text("authInvalidCredentials");
    case "auth/network-request-failed":
      return text("authNetworkError");
    case "auth/invalid-api-key":
    case "auth/api-key-not-valid.-please-pass-a-valid-api-key.":
      return text("firebaseInvalidConfig");
    case "permission-denied":
    case "firestore/permission-denied":
      return text("firestoreRulesError");
    case "not-found":
    case "firestore/not-found":
    case "failed-precondition":
    case "firestore/failed-precondition":
      return text("firestoreDatabaseNotReady");
    case "auth/too-many-requests":
      return text("authError");
    default:
      return text("authError");
  }
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function userDoc(uid) {
  return doc(db, "users", uid);
}

function userRecords(uid) {
  return collection(db, "users", uid, "records");
}

function userMedications(uid) {
  return collection(db, "users", uid, "medications");
}

function userPassport(uid) {
  return doc(db, "users", uid, "passport", "current");
}

async function loadPatientData(user) {
  const profileForm = element("#profile-form");
  setStatus("#profile-status", text("loading"));
  element("#records-list").textContent = text("loading");
  const [profileSnapshot, recordsSnapshot, medicationsSnapshot, passportSnapshot] = await Promise.all([
    getDoc(userDoc(user.uid)),
    getDocs(query(userRecords(user.uid), orderBy("updatedAt", "desc"))),
    getDocs(userMedications(user.uid)),
    getDoc(userPassport(user.uid)),
  ]);
  const profile = profileSnapshot.exists() ? profileSnapshot.data() : {};
  profileForm.elements.displayName.value = profile.displayName || user.displayName || "";
  profileForm.elements.birthDate.value = profile.birthDate || "";
  element("#profile-email").value = user.email || "";
  recordsById = new Map(recordsSnapshot.docs.map((record) => [record.id, record.data()]));
  medicationsById = new Map(medicationsSnapshot.docs.map((medication) => [medication.id, medication.data()]));
  passportData = passportSnapshot.exists() ? passportSnapshot.data() : null;
  renderPassport();
  renderRecords();
  renderMedications();
  setStatus("#profile-status", "");
}

function renderPassport() {
  const form = element("#passport-form");
  const passport = passportData || {};
  form.elements.bloodType.value = passport.bloodType || "";
  form.elements.chronicConditions.value = passport.chronicConditions || "";
  form.elements.drugAllergies.value = passport.drugAllergies || "";
  form.elements.qrConsent.checked = false;
  element("#passport-qr-panel").hidden = true;
  renderPassportPreview();
}

function renderPassportPreview() {
  const form = element("#passport-form");
  if (!form) return;
  const data = getPassportFormData();
  const details = [
    ["#passport-preview-name", data.displayName || text("notProvided")],
    ["#passport-preview-blood", data.bloodType === "unknown" ? text("bloodUnknown") : data.bloodType || text("notProvided")],
    ["#passport-preview-conditions", data.chronicConditions || text("notProvided")],
    ["#passport-preview-allergies", data.drugAllergies || text("notProvided")],
  ];
  for (const [selector, value] of details) {
    const node = element(selector);
    node.textContent = value;
    node.dir = "auto";
  }
}

function getPassportFormData() {
  const form = element("#passport-form");
  return {
    displayName: element("#profile-form").elements.displayName.value.trim().slice(0, 100),
    bloodType: form.elements.bloodType.value,
    chronicConditions: form.elements.chronicConditions.value.trim(),
    drugAllergies: form.elements.drugAllergies.value.trim(),
  };
}

element("#passport-form").addEventListener("input", (event) => {
  if (event.target.name !== "qrConsent") {
    element("#passport-qr-panel").hidden = true;
    renderPassportPreview();
  }
});

element("#profile-form").addEventListener("input", () => {
  renderPassportPreview();
  element("#passport-qr-panel").hidden = true;
});

element("#passport-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  const payload = getPassportFormData();
  if (payload.chronicConditions.length > 300 || payload.drugAllergies.length > 300) {
    setStatus("#passport-status", text("passportInvalid"), "error");
    return;
  }
  const form = event.currentTarget;
  setBusy(form, true, "savePassport");
  try {
    await setDoc(userPassport(currentUser.uid), {
      ...payload,
      updatedAt: serverTimestamp(),
    });
    passportData = payload;
    renderPassportPreview();
    element("#passport-qr-panel").hidden = true;
    setStatus("#passport-status", text("passportSaved"), "success");
  } catch (error) {
    console.error("Emergency passport save failed:", error);
    setStatus("#passport-status", authErrorMessage(error), "error");
  } finally {
    setBusy(form, false, "savePassport");
  }
});

element("#generate-passport-qr").addEventListener("click", async () => {
  if (!currentUser) return;
  const form = element("#passport-form");
  if (!form.elements.qrConsent.checked) {
    setStatus("#passport-status", text("passportConsentRequired"), "error");
    return;
  }
  const data = getPassportFormData();
  const hasMedicalDetail = data.bloodType || data.chronicConditions || data.drugAllergies;
  if (!hasMedicalDetail) {
    setStatus("#passport-status", text("passportNoDetails"), "error");
    return;
  }

  const qrPayload = {
    version: 1,
    name: data.displayName || undefined,
    bloodType: data.bloodType || undefined,
    chronicConditions: data.chronicConditions || undefined,
    drugAllergies: data.drugAllergies || undefined,
    notice: text("passportQrNotice"),
  };
  try {
    await QRCode.toCanvas(element("#passport-qr-canvas"), JSON.stringify(qrPayload), {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 256,
      color: { dark: "#0f172a", light: "#ffffff" },
    });
    element("#passport-qr-panel").hidden = false;
    setStatus("#passport-status", text("passportQrReady"), "success");
  } catch (error) {
    console.error("Emergency passport QR generation failed:", error);
    setStatus("#passport-status", text("passportQrError"), "error");
  }
});

element("#delete-passport").addEventListener("click", async () => {
  if (!currentUser || !window.confirm(text("passportDeleteConfirm"))) return;
  try {
    await deleteDoc(userPassport(currentUser.uid));
    passportData = null;
    renderPassport();
    setStatus("#passport-status", text("passportDeleted"), "success");
  } catch (error) {
    console.error("Emergency passport deletion failed:", error);
    setStatus("#passport-status", authErrorMessage(error), "error");
  }
});

function formatDate(value) {
  if (!value || typeof value.toDate !== "function") return "";
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(value.toDate());
}

function renderRecords() {
  const list = element("#records-list");
  list.replaceChildren();
  if (!recordsById.size) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = text("noRecords");
    list.append(empty);
    return;
  }
  for (const [id, record] of recordsById) {
    const card = document.createElement("article");
    card.className = "record-card";
    const category = document.createElement("p");
    category.className = "record-category";
    category.textContent = text(record.category);
    const title = document.createElement("h4");
    title.textContent = record.title;
    title.dir = "auto";
    const details = document.createElement("p");
    details.className = "record-details";
    details.textContent = record.details || "";
    details.dir = "auto";
    const timestamp = document.createElement("time");
    timestamp.textContent = `${text("created")}: ${formatDate(record.createdAt)} · ${text("updated")}: ${formatDate(record.updatedAt)}`;
    const actions = document.createElement("div");
    actions.className = "button-row record-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "button button-secondary";
    edit.textContent = text("edit");
    edit.addEventListener("click", () => startEditingRecord(id, record));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button-danger";
    remove.textContent = text("delete");
    remove.addEventListener("click", () => removeRecord(id));
    actions.append(edit, remove);
    card.append(category, title, details, timestamp, actions);
    list.append(card);
  }
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function renderMedications() {
  const list = element("#medication-tracker-list");
  if (!list) return;
  list.replaceChildren();
  const today = localDateKey();
  const medications = [...medicationsById.entries()].sort((first, second) =>
    (first[1].doseTime || "").localeCompare(second[1].doseTime || ""),
  );
  const completed = medications.filter(([, medication]) => medication.takenDate === today).length;
  element("#tracker-progress").max = medications.length || 1;
  element("#tracker-progress").value = completed;
  element("#tracker-progress-label").textContent = `${text("trackerProgress")}: ${completed}/${medications.length}`;
  if (!medications.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = text("trackerEmpty");
    list.append(empty);
    return;
  }

  for (const [id, medication] of medications) {
    const card = document.createElement("article");
    card.className = "tracker-card";
    const details = document.createElement("div");
    details.className = "tracker-card-details";
    const name = document.createElement("h4");
    name.textContent = medication.name;
    name.dir = "auto";
    const schedule = document.createElement("p");
    schedule.textContent = `${medication.dosage} · ${medication.doseTime}`;
    schedule.dir = "auto";
    const state = document.createElement("span");
    const isTaken = medication.takenDate === today;
    state.className = `tracker-state${isTaken ? " is-taken" : ""}`;
    state.textContent = text(isTaken ? "trackerTaken" : "trackerPending");
    details.append(name, schedule, state);

    const actions = document.createElement("div");
    actions.className = "button-row tracker-actions";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "button button-secondary";
    toggle.textContent = text(isTaken ? "trackerMarkPending" : "trackerMarkTaken");
    toggle.addEventListener("click", () => toggleMedicationTaken(id, isTaken));
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "button button-secondary";
    edit.textContent = text("edit");
    edit.addEventListener("click", () => startEditingMedication(id, medication));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button-danger";
    remove.textContent = text("delete");
    remove.addEventListener("click", () => removeMedication(id));
    actions.append(toggle, edit, remove);
    card.append(details, actions);
    list.append(card);
  }
}

function startEditingMedication(id, medication) {
  const form = element("#medication-tracker-form");
  form.elements.medicationId.value = id;
  form.elements.name.value = medication.name;
  form.elements.dosage.value = medication.dosage;
  form.elements.doseTime.value = medication.doseTime;
  form.querySelector('button[type="submit"]').textContent = text("save");
  element("#cancel-medication-edit").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetMedicationForm() {
  const form = element("#medication-tracker-form");
  if (!form) return;
  form.reset();
  form.elements.medicationId.value = "";
  form.querySelector('button[type="submit"]').textContent = text("trackerAdd");
  element("#cancel-medication-edit").hidden = true;
}

function startEditingRecord(id, record) {
  const form = element("#record-form");
  form.elements.recordId.value = id;
  form.elements.category.value = record.category;
  form.elements.title.value = record.title;
  form.elements.details.value = record.details || "";
  form.querySelector('button[type="submit"]').textContent = text("save");
  element("#cancel-edit").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetRecordForm() {
  const form = element("#record-form");
  form.reset();
  form.elements.recordId.value = "";
  form.querySelector('button[type="submit"]').textContent = text("addRecord");
  element("#cancel-edit").hidden = true;
}

function renderSignedIn(user) {
  currentUser = user;
  element("#auth-panel").hidden = true;
  element("#patient-dashboard").hidden = false;
  element("#account-label").textContent = user.email || "";
  setStatus("#auth-status", "");
}

function renderSignedOut() {
  currentUser = null;
  recordsById = new Map();
  medicationsById = new Map();
  passportData = null;
  setStatus("#auth-status", "");
  setStatus("#profile-status", "");
  setStatus("#record-status", "");
  setStatus("#medication-tracker-status", "");
  element("#auth-panel").hidden = false;
  element("#patient-dashboard").hidden = true;
  element("#records-list").replaceChildren();
  element("#profile-form").reset();
  resetRecordForm();
  resetMedicationForm();
  element("#medication-tracker-list").replaceChildren();
  element("#tracker-progress-label").textContent = "";
  element("#tracker-progress").value = 0;
  element("#passport-form").reset();
  renderPassportPreview();
  element("#passport-qr-panel").hidden = true;
  element("#passport-qr-canvas").getContext("2d").clearRect(0, 0, 256, 256);
  setStatus("#passport-status", "");
  renderAuthMode();
}

element("#language-select").addEventListener("change", (event) => applyLanguage(event.target.value));
const seniorAccessibilityToggle = element("#senior-accessibility");
seniorAccessibilityToggle.checked = seniorAccessibilityEnabled;
seniorAccessibilityToggle.addEventListener("change", () => {
  seniorAccessibilityEnabled = seniorAccessibilityToggle.checked;
  document.documentElement.classList.toggle("senior-accessibility", seniorAccessibilityEnabled);
  localStorage.setItem(seniorAccessibilityStorageKey, String(seniorAccessibilityEnabled));
});
document.querySelectorAll("[data-auth-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    authMode = button.dataset.authMode;
    setStatus("#auth-status", "");
    renderAuthMode();
  });
});

element("#forgot-password").addEventListener("click", () => {
  authMode = "reset";
  setStatus("#auth-status", "");
  renderAuthMode();
});

element("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = element("#auth-email").value.trim();
  const password = element("#auth-password").value;
  const fullName = element("#auth-name").value.trim();
  setStatus("#auth-status", "");
  if (!validEmail(email)) {
    setStatus("#auth-status", text("invalidEmail"), "error");
    return;
  }
  if (authMode === "signup" && password.length < 8) {
    setStatus("#auth-status", text("passwordLength"), "error");
    return;
  }
  if (authMode === "login" && !password) {
    setStatus("#auth-status", text("required"), "error");
    return;
  }
  if (authMode === "signup" && fullName.length < 2) {
    setStatus("#auth-status", text("required"), "error");
    return;
  }
  if (authMode === "signup" && password !== element("#auth-confirm").value) {
    setStatus("#auth-status", text("passwordMismatch"), "error");
    return;
  }

  const submitKey = authMode === "reset" ? "sendReset" : authMode === "signup" ? "signUp" : "signIn";
  setBusy(form, true, submitKey);
  try {
    await authPersistence;
    if (authMode === "reset") {
      await sendPasswordResetEmail(auth, email);
      setStatus("#auth-status", text("resetSent"), "success");
      return;
    }
    if (authMode === "signup") {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      try {
        await setDoc(userDoc(credential.user.uid), {
          displayName: fullName,
          email: credential.user.email,
          birthDate: "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        console.error("New account created, but Firestore profile setup failed:", error);
        renderSignedIn(credential.user);
        setStatus("#profile-status", authErrorMessage(error), "error");
      }
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    console.error("Authentication request failed:", error);
    if (authMode === "reset" && error?.code === "auth/user-not-found") {
      setStatus("#auth-status", text("resetSent"), "success");
    } else {
      setStatus("#auth-status", authErrorMessage(error), "error");
    }
  } finally {
    setBusy(form, false, submitKey);
  }
});

element("#sign-out").addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Sign out failed:", error);
    setStatus("#profile-status", authErrorMessage(error), "error");
  }
});

element("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  const form = event.currentTarget;
  const displayName = form.elements.displayName.value.trim();
  const birthDate = form.elements.birthDate.value;
  if (displayName.length < 2 || displayName.length > 100) {
    setStatus("#profile-status", text("required"), "error");
    return;
  }
  setBusy(form, true, "saveProfile");
  try {
    const existingProfile = await getDoc(userDoc(currentUser.uid));
    await setDoc(userDoc(currentUser.uid), {
      displayName,
      email: currentUser.email || "",
      birthDate,
      ...(!existingProfile.data()?.createdAt && { createdAt: serverTimestamp() }),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    setStatus("#profile-status", text("profileSaved"), "success");
    renderPassportPreview();
  } catch (error) {
    console.error("Profile save failed:", error);
    setStatus("#profile-status", authErrorMessage(error), "error");
  } finally {
    setBusy(form, false, "saveProfile");
  }
});

element("#record-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  const form = event.currentTarget;
  const category = form.elements.category.value;
  const title = form.elements.title.value.trim();
  const details = form.elements.details.value.trim();
  if (!languageNames[language] || !title || title.length > 120 || details.length > 4000) {
    setStatus("#record-status", text("required"), "error");
    return;
  }
  setBusy(form, true, form.elements.recordId.value ? "save" : "addRecord");
  const payload = { category, title, details, updatedAt: serverTimestamp() };
  try {
    const recordId = form.elements.recordId.value;
    if (recordId) await updateDoc(doc(db, "users", currentUser.uid, "records", recordId), payload);
    else await addDoc(userRecords(currentUser.uid), { ...payload, createdAt: serverTimestamp() });
    await loadPatientData(currentUser);
    resetRecordForm();
    setStatus("#record-status", text("recordSaved"), "success");
  } catch (error) {
    console.error("Health record save failed:", error);
    setStatus("#record-status", authErrorMessage(error), "error");
  } finally {
    setBusy(form, false, "addRecord");
  }
});

element("#cancel-edit").addEventListener("click", resetRecordForm);

async function removeRecord(id) {
  if (!currentUser || !window.confirm(text("confirmDelete"))) return;
  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "records", id));
    await loadPatientData(currentUser);
    setStatus("#record-status", text("recordDeleted"), "success");
  } catch (error) {
    console.error("Health record deletion failed:", error);
    setStatus("#record-status", authErrorMessage(error), "error");
  }
}

element("#medication-tracker-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  const form = event.currentTarget;
  const name = form.elements.name.value.trim();
  const dosage = form.elements.dosage.value.trim();
  const doseTime = form.elements.doseTime.value;
  if (
    name.length < 1 || name.length > 100 ||
    dosage.length < 1 || dosage.length > 120 ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(doseTime)
  ) {
    setStatus("#medication-tracker-status", text("trackerInvalid"), "error");
    return;
  }

  const medicationId = form.elements.medicationId.value;
  const submitKey = medicationId ? "save" : "trackerAdd";
  setBusy(form, true, submitKey);
  try {
    const payload = { name, dosage, doseTime, updatedAt: serverTimestamp() };
    if (medicationId) {
      await updateDoc(doc(db, "users", currentUser.uid, "medications", medicationId), payload);
    } else {
      await addDoc(userMedications(currentUser.uid), { ...payload, createdAt: serverTimestamp() });
    }
    await loadPatientData(currentUser);
    resetMedicationForm();
    setStatus("#medication-tracker-status", text("trackerSaved"), "success");
  } catch (error) {
    console.error("Medication schedule save failed:", error);
    setStatus("#medication-tracker-status", authErrorMessage(error), "error");
  } finally {
    setBusy(form, false, medicationId ? "save" : "trackerAdd");
  }
});

element("#cancel-medication-edit").addEventListener("click", resetMedicationForm);

async function toggleMedicationTaken(id, isTaken) {
  if (!currentUser) return;
  const medicationRef = doc(db, "users", currentUser.uid, "medications", id);
  try {
    await updateDoc(medicationRef, isTaken
      ? { takenDate: deleteField(), takenAt: deleteField(), updatedAt: serverTimestamp() }
      : { takenDate: localDateKey(), takenAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await loadPatientData(currentUser);
    setStatus("#medication-tracker-status", text(isTaken ? "trackerPendingSaved" : "trackerTakenSaved"), "success");
  } catch (error) {
    console.error("Medication dose status update failed:", error);
    setStatus("#medication-tracker-status", authErrorMessage(error), "error");
  }
}

async function removeMedication(id) {
  if (!currentUser || !window.confirm(text("confirmMedicationDelete"))) return;
  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "medications", id));
    await loadPatientData(currentUser);
    setStatus("#medication-tracker-status", text("trackerDeleted"), "success");
  } catch (error) {
    console.error("Medication schedule deletion failed:", error);
    setStatus("#medication-tracker-status", authErrorMessage(error), "error");
  }
}

async function initializeMap() {
  if (map) return map;
  if (!window.L) throw new Error("Leaflet failed to load");
  map = window.L.map("pharmacy-map").setView([26.8206, 30.8025], 5);
  mapAttribution = text("mapAttribution");
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: mapAttribution,
  }).addTo(map);
  pharmacyLayer = window.L.layerGroup().addTo(map);
  return map;
}

function makeTimeoutSignal(milliseconds) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), milliseconds);
  return { signal: controller.signal, clear: () => window.clearTimeout(timer) };
}

function clearPharmacyResults() {
  element("#pharmacy-results").replaceChildren();
  pharmacyLayer?.clearLayers();
  pharmacyItems = [];
  pharmacyMarkers = [];
  map?.setView([26.8206, 30.8025], 5);
}

function facilityLabelKey(tags) {
  if (tags.amenity === "pharmacy") return "pharmacyType";
  if (tags.amenity === "hospital" || tags.healthcare === "hospital") return "hospitalType";
  if (tags.amenity === "clinic" || tags.healthcare === "clinic") return "clinicType";
  if (tags.amenity === "doctors" || tags.healthcare === "doctor") return "doctorType";
  if (tags.emergency === "ambulance_station" || tags.amenity === "ambulance_station") return "emergencyType";
  return "medicalType";
}

function applyPharmacyHoursFilter() {
  const filter = element("#pharmacy-24h-filter");
  const filterLabel = filter.closest(".pharmacy-hours-filter");
  const medicalFacilitiesSelected = currentFacilityType !== "pharmacy";
  filter.disabled = medicalFacilitiesSelected;
  filterLabel.classList.toggle("is-disabled", medicalFacilitiesSelected);
  if (medicalFacilitiesSelected && filter.checked) filter.checked = false;

  const enabled = filter.checked && !medicalFacilitiesSelected;
  const visibleItems = pharmacyItems.filter((item) => !enabled || item.open247);
  [...element("#pharmacy-results").children].forEach((card, index) => {
    const item = pharmacyItems[index];
    card.classList.toggle("is-filtered-out", enabled && !item?.open247);
  });
  pharmacyMarkers.forEach(({ marker, open247 }) => {
    marker.setOpacity(enabled && !open247 ? 0.2 : 1);
  });

  if (enabled && visibleItems.length === 0 && pharmacyItems.length > 0) {
    setStatus("#pharmacy-status", text("pharmacyNo247"), "error");
  }
}