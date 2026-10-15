import { auth, db, authPersistence } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
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
} from "firebase/firestore";
import QRCode from "qrcode";
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
    setStatus("#pharmacy-status", text("pharmacy24hNone"), "error");
  } else if (enabled) {
    setStatus(
      "#pharmacy-status",
      `${text("pharmacy24hCount")}: ${visibleItems.length}`,
      "success",
      "pharmacy24hCount",
      visibleItems.length,
    );
  } else if (pharmacyItems.length > 0) {
    setStatus(
      "#pharmacy-status",
      `${text("facilitiesFound")}: ${pharmacyItems.length}`,
      "success",
      "facilitiesFound",
      pharmacyItems.length,
    );
  }
}

async function findFacilities(latitude, longitude) {
  const facilityType = element("#facility-type").value;
  currentFacilityType = facilityType;
  setStatus("#pharmacy-status", text("pharmacyLoading"));
  clearPharmacyResults();
  try {
    const leaflet = await initializeMap();
    const response = await fetch("/api/pharmacies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latitude,
        longitude,
        radiusKm: Number(element("#search-radius").value),
        facilityType,
      }),
    });
    if (response.status === 404) {
      setStatus("#pharmacy-status", text("backendNotRunning"), "error");
      return;
    }
    if (response.status >= 500) {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        setStatus("#pharmacy-status", text("backendNotRunning"), "error");
        return;
      }
      setStatus("#pharmacy-status", text("mapServiceUnavailable"), "error");
      return;
    }
    if (!response.ok) throw new Error(`Pharmacy API returned ${response.status}`);
    const data = await response.json();
    const items = (data.elements || []).map((entry) => {
      const tags = entry.tags || {};
      const point = entry.center || entry;
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
      return {
        tags,
        name: tags.name || tags["name:en"] || tags["name:ar"] || text("unnamedPharmacy"),
        unnamed: !(tags.name || tags["name:en"] || tags["name:ar"]),
        address: [tags["addr:street"], tags["addr:housenumber"], tags["addr:city"]].filter(Boolean).join(", ") || text("noAddress"),
        addressMissing: !(tags["addr:street"] || tags["addr:housenumber"] || tags["addr:city"]),
        facilityLabelKey: facilityLabelKey(tags),
        open247: facilityType === "pharmacy" &&
          typeof tags.opening_hours === "string" &&
          tags.opening_hours.trim() === "24/7",
        lat: point.lat,
        lon: point.lon,
      };
    }).filter(Boolean);
    pharmacyItems = items;
    pharmacyLayer.clearLayers();
    leaflet.setView([latitude, longitude], 13);
    const results = element("#pharmacy-results");
    if (!items.length) {
      setStatus("#pharmacy-status", text("noFacilities"));
      return;
    }
    const bounds = [];
    for (const place of items) {
      const marker = window.L.marker([place.lat, place.lon]);
      pharmacyMarkers.push({ marker, open247: place.open247 });
      const popup = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = place.name;
      name.dir = "auto";
      if (place.unnamed) name.dataset.i18n = "unnamedPharmacy";
      const address = document.createElement("p");
      address.textContent = place.address;
      address.dir = "auto";
      if (place.addressMissing) address.dataset.i18n = "noAddress";
      const facility = document.createElement("p");
      facility.textContent = text(place.facilityLabelKey);
      facility.dataset.i18n = place.facilityLabelKey;
      popup.append(name, facility, address);
      marker.bindPopup(popup).addTo(pharmacyLayer);
      bounds.push([place.lat, place.lon]);
      const card = document.createElement("article");
      card.className = "pharmacy-card";
      const heading = document.createElement("h3");
      heading.textContent = place.name;
      heading.dir = "auto";
      if (place.unnamed) heading.dataset.i18n = "unnamedPharmacy";
      const addressLine = document.createElement("p");
      addressLine.textContent = `${text("address")}: ${place.address}`;
      addressLine.dataset.i18nAddress = "";
      addressLine.dataset.address = place.address;
      addressLine.dataset.addressMissing = String(place.addressMissing);
      const facilityLine = document.createElement("p");
      facilityLine.className = "pharmacy-facility-type";
      facilityLine.textContent = text(place.facilityLabelKey);
      facilityLine.dataset.i18n = place.facilityLabelKey;
      card.append(heading, facilityLine, addressLine);
      card.classList.toggle("is-open-24-hours", place.open247);
      if (place.open247) {
        const hoursBadge = document.createElement("span");
        hoursBadge.className = "pharmacy-hours-badge";
        hoursBadge.textContent = text("pharmacy24hBadge");
        hoursBadge.dataset.i18n = "pharmacy24hBadge";
        card.append(hoursBadge);
      }
      if (place.tags.phone) {
        const phoneLink = document.createElement("a");
        phoneLink.href = `tel:${place.tags.phone.replace(/[^\d+]/g, "")}`;
        phoneLink.textContent = place.tags.phone;
        card.append(phoneLink);
      }
      if (typeof place.tags.website === "string") {
        try {
          const website = new URL(place.tags.website);
          if (website.protocol === "https:" || website.protocol === "http:") {
            const websiteLink = document.createElement("a");
            websiteLink.href = website.href;
            websiteLink.target = "_blank";
            websiteLink.rel = "noopener noreferrer";
            websiteLink.textContent = text("facilityWebsite");
            websiteLink.dataset.i18n = "facilityWebsite";
            card.append(websiteLink);
          }
        } catch (error) {
          console.warn("Ignoring invalid facility website URL:", error.message);
        }
      }
      const mapLink = document.createElement("a");
      mapLink.href = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(place.lat)}&mlon=${encodeURIComponent(place.lon)}#map=18/${encodeURIComponent(place.lat)}/${encodeURIComponent(place.lon)}`;
      mapLink.target = "_blank";
      mapLink.rel = "noopener noreferrer";
      mapLink.textContent = text("openMap");
      card.append(mapLink);
      results.append(card);
    }
    if (bounds.length > 1) leaflet.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
    setStatus("#pharmacy-status", `${text("facilitiesFound")}: ${items.length}`, "success", "facilitiesFound", items.length);
    applyPharmacyHoursFilter();
  } catch (error) {
    console.error("Pharmacy search failed:", error);
    setStatus(
      "#pharmacy-status",
      error instanceof TypeError ? text("backendNotRunning") : text("pharmacyError"),
      "error",
    );
  }
}

async function geocodePlace(place) {
  const query = new URLSearchParams({ q: place, language });
  const response = await fetch(`/api/pharmacies/geocode?${query}`);
  if (response.status === 404) throw new Error("API_NOT_RUNNING");
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("API_NOT_RUNNING");
  }
  if (!response.ok) throw new Error(`Geocoding service returned ${response.status}`);
  const result = await response.json();
  return result.location === null ? null : result;
}

element("#pharmacy-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const place = element("#place-query").value.trim();
  if (!place) {
    setStatus("#pharmacy-status", text("required"), "error");
    return;
  }
  try {
    const form = element("#pharmacy-form");
    setBusy(form, true, "search");
    clearPharmacyResults();
    setStatus("#pharmacy-status", text("loading"));
    const point = await geocodePlace(place);
    if (!point) {
      setStatus("#pharmacy-status", text("noPlaceResult"), "error");
      return;
    }
    await findFacilities(point.latitude, point.longitude);
  } catch (error) {
    console.error("Place lookup failed:", error);
    setStatus(
      "#pharmacy-status",
      error.message === "API_NOT_RUNNING"
        ? text("backendNotRunning")
        : error instanceof TypeError
          ? text("backendNotRunning")
          : text("pharmacyError"),
      "error",
    );
  } finally {
    setBusy(element("#pharmacy-form"), false, "search");
  }
});

element("#pharmacy-24h-filter").addEventListener("change", applyPharmacyHoursFilter);
element("#facility-type").addEventListener("change", () => {
  currentFacilityType = element("#facility-type").value;
  applyPharmacyHoursFilter();
});

element("#locate-button").addEventListener("click", () => {
  if (!navigator.geolocation) {
    setStatus("#pharmacy-status", text("locationDenied"), "error");
    return;
  }
  setStatus("#pharmacy-status", text("loading"));
  element("#locate-button").disabled = true;
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      element("#locate-button").disabled = false;
      findFacilities(coords.latitude, coords.longitude);
    },
    (error) => {
      console.warn("Location permission or lookup failed:", error);
      element("#locate-button").disabled = false;
      setStatus("#pharmacy-status", text("locationDenied"), "error");
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 },
  );
});

function clearMedicineImage() {
  if (medicineImageUrl) URL.revokeObjectURL(medicineImageUrl);
  medicineImageUrl = null;
  element("#medicine-image").value = "";
  element("#image-preview-img").removeAttribute("src");
  element("#image-preview").hidden = true;
  element("#image-drop-zone").hidden = false;
  setStatus("#image-check-status", "");
}

function previewMedicineImage(file) {
  if (!file) return;
  if (!allowedMedicineImageTypes.has(file.type)) {
    setStatus("#image-check-status", text("imageInvalidType"), "error");
    return;
  }
  if (file.size > maxMedicineImageBytes) {
    setStatus("#image-check-status", text("imageTooLarge"), "error");
    return;
  }

  clearMedicineImage();
  medicineImageUrl = URL.createObjectURL(file);
  element("#image-preview-img").src = medicineImageUrl;
  element("#image-file-name").textContent = file.name;
  element("#image-file-size").textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB`;
  element("#image-preview").hidden = false;
  element("#image-drop-zone").hidden = true;
  setStatus("#image-check-status", text("imagePreviewReady"), "success");
}

element("#medicine-image").addEventListener("change", (event) => {
  previewMedicineImage(event.currentTarget.files?.[0]);
});

element("#remove-image").addEventListener("click", clearMedicineImage);

const imageDropZone = element("#image-drop-zone");
imageDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  imageDropZone.classList.add("is-dragging");
});
imageDropZone.addEventListener("dragleave", () => imageDropZone.classList.remove("is-dragging"));
imageDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  imageDropZone.classList.remove("is-dragging");
  previewMedicineImage(event.dataTransfer?.files?.[0]);
});

element("#medication-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = element("#medication-query").value.trim();
  if (!name) {
    setStatus("#medication-status", text("required"), "error");
    return;
  }
  const form = event.currentTarget;
  setBusy(form, true, "search");
  element("#medication-results").replaceChildren();
  setStatus("#medication-status", text("medicationLoading"));
  try {
    const endpoint = new URL("https://rxnav.nlm.nih.gov/REST/drugs.json");
    endpoint.searchParams.set("name", name);
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`RxNorm returned ${response.status}`);
    const data = await response.json();
    const candidates = data?.drugGroup?.conceptGroup?.flatMap((group) => group.conceptProperties || []) || [];
    const unique = [...new Map(candidates.map((item) => [item.rxcui, item])).values()].slice(0, 10);
    if (!unique.length) {
      setStatus("#medication-status", text("noMedication"));
      return;
    }
    const results = element("#medication-results");
    for (const item of unique) {
      const card = document.createElement("article");
      card.className = "medication-card";
      const title = document.createElement("h3");
      title.textContent = item.name;
      title.dir = "auto";
      const rxLink = document.createElement("a");
      rxLink.href = `https://rxnav.nlm.nih.gov/REST/rxcui/${encodeURIComponent(item.rxcui)}/allrelated.json`;
      rxLink.target = "_blank";
      rxLink.rel = "noopener noreferrer";
      rxLink.textContent = text("rxSource");
      rxLink.dataset.i18n = "rxSource";
      const labelLink = document.createElement("a");
      labelLink.href = `https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=${encodeURIComponent(item.name)}`;
      labelLink.target = "_blank";
      labelLink.rel = "noopener noreferrer";
      labelLink.textContent = text("labelSource");
      labelLink.dataset.i18n = "labelSource";
      card.append(title, rxLink, labelLink);
      results.append(card);
    }
    setStatus("#medication-status", "");
  } catch (error) {
    console.error("Medication lookup failed:", error);
    setStatus("#medication-status", text("medicationError"), "error");
  } finally {
    setBusy(form, false, "search");
  }
});

function renderInteractionInputs(values) {
  const container = element("#interaction-medications");
  if (!container) return;
  const existingValues = values || [...container.querySelectorAll('input[name="medication"]')]
    .map((input) => input.value);
  while (existingValues.length < 2) existingValues.push("");
  container.replaceChildren();
  existingValues.forEach((value, index) => {
    const row = document.createElement("div");
    row.className = "interaction-medication-row";
    const label = document.createElement("label");
    label.className = "interaction-medication-field";
    const caption = document.createElement("span");
    caption.textContent = `${text("interactionMedicine")} ${index + 1}`;
    const input = document.createElement("input");
    input.name = "medication";
    input.maxLength = 80;
    input.autocomplete = "off";
    input.required = true;
    input.value = value;
    label.append(caption, input);
    row.append(label);
    if (existingValues.length > 2) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "button button-danger";
      remove.textContent = text("removeMedicine");
      remove.addEventListener("click", () => {
        const nextValues = [...container.querySelectorAll('input[name="medication"]')]
          .map((field) => field.value);
        nextValues.splice(index, 1);
        renderInteractionInputs(nextValues);
      });
      row.append(remove);
    }
    container.append(row);
  });
  element("#add-interaction-medication").disabled = existingValues.length >= 5;
}

element("#add-interaction-medication").addEventListener("click", () => {
  const values = [...element("#interaction-medications").querySelectorAll('input[name="medication"]')]
    .map((input) => input.value);
  if (values.length < 5) renderInteractionInputs([...values, ""]);
});

element("#interaction-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const medications = [...form.querySelectorAll('input[name="medication"]')]
    .map((input) => input.value.trim())
    .filter(Boolean);
  if (medications.length < 2 || new Set(medications.map((name) => name.toLocaleLowerCase())).size < 2) {
    setStatus("#interaction-status", text("interactionNeedTwo"), "error");
    return;
  }

  setBusy(form, true, "checkInteractions");
  element("#interaction-results").replaceChildren();
  setStatus("#interaction-status", text("interactionLoading"));
  try {
    const params = new URLSearchParams({ medications: medications.join("|") });
    const response = await fetch(`/api/medications/interactions?${params}`);
    const result = await response.json().catch(() => ({}));
    if (response.status === 404) {
      setStatus("#interaction-status", text("backendNotRunning"), "error");
      return;
    }
    if (response.status === 429) {
      setStatus("#interaction-status", text("interactionRateLimited"), "error");
      return;
    }
    if (!response.ok) throw new Error(result.error || `Interaction lookup returned ${response.status}`);

    const results = element("#interaction-results");
    const missingLabels = result.medications.filter((medication) => !medication.found);
    if (missingLabels.length) {
      const note = document.createElement("p");
      note.className = "interaction-source-note";
      note.textContent = `${text("interactionNoLabel")}: ${missingLabels.map((item) => item.name).join(", ")}`;
      note.dir = "auto";
      results.append(note);
    }
    if (!result.interactions.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = text("interactionNoMention");
      results.append(empty);
    }
    for (const item of result.interactions) {
      const card = document.createElement("article");
      card.className = "interaction-result-card";
      const heading = document.createElement("h4");
      heading.textContent = item.medications.join(" + ");
      heading.dir = "auto";
      const badge = document.createElement("span");
      badge.className = `interaction-badge${item.warning === "avoid-combination" ? " is-avoid" : ""}`;
      badge.textContent = text(item.warning === "avoid-combination" ? "interactionAvoidLabel" : "interactionMentionLabel");
      const excerpt = document.createElement("blockquote");
      excerpt.textContent = item.excerpt;
      excerpt.dir = "auto";
      const source = document.createElement("a");
      source.href = item.sourceUrl;
      source.target = "_blank";
      source.rel = "noopener noreferrer";
      source.textContent = text("interactionSource");
      card.append(heading, badge, excerpt, source);
      results.append(card);
    }
    setStatus("#interaction-status", text("interactionComplete"), "success");
  } catch (error) {
    console.error("Medication interaction lookup failed:", error);
    setStatus("#interaction-status", text("interactionUnavailable"), "error");
  } finally {
    setBusy(form, false, "checkInteractions");
  }
});

const labFileInput = element("#lab-file");
const labDropZone = element("#lab-drop-zone");
const labImageInput = element("#lab-image-file");
const labImageDropZone = element("#lab-image-drop-zone");

function clearLabImage() {
  if (labImageUrl) URL.revokeObjectURL(labImageUrl);
  labImageUrl = null;
  labImageInput.value = "";
  element("#lab-image-preview-img").removeAttribute("src");
  element("#lab-image-preview").hidden = true;
  labImageDropZone.hidden = false;
}

function previewLabImage(file) {
  if (!file) return;
  if (!allowedMedicineImageTypes.has(file.type)) {
    setStatus("#lab-status", text("labImageInvalid"), "error");
    return;
  }
  if (file.size > maxMedicineImageBytes) {
    setStatus("#lab-status", text("labImageTooLarge"), "error");
    return;
  }

  clearLabImage();
  labImageUrl = URL.createObjectURL(file);
  element("#lab-image-preview-img").src = labImageUrl;
  element("#lab-image-file-name").textContent = file.name;
  element("#lab-image-preview").hidden = false;
  labImageDropZone.hidden = true;
  setStatus("#lab-status", text("labImageReady"), "success");
}

labImageInput.addEventListener("change", (event) => {
  previewLabImage(event.currentTarget.files?.[0]);
});
element("#remove-lab-image").addEventListener("click", () => {
  clearLabImage();
  setStatus("#lab-status", "");
});
labImageDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  labImageDropZone.classList.add("is-dragging");
});
labImageDropZone.addEventListener("dragleave", () => labImageDropZone.classList.remove("is-dragging"));
labImageDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  labImageDropZone.classList.remove("is-dragging");
  previewLabImage(event.dataTransfer?.files?.[0]);
});

async function loadLabFile(file) {
  if (!file) return;
  const extension = file.name.split(".").pop()?.toLocaleLowerCase();
  if (!["txt", "csv"].includes(extension) ||
    !["", "text/plain", "text/csv", "application/vnd.ms-excel"].includes(file.type)) {
    setStatus("#lab-status", text("labInvalidFile"), "error");
    return;
  }
  if (file.size > 20000) {
    setStatus("#lab-status", text("labFileTooLarge"), "error");
    return;
  }
  try {
    element("#lab-text").value = await file.text();
    setStatus("#lab-status", text("labFileLoaded"), "success");
  } catch (error) {
    console.error("Local lab file could not be read:", error);
    setStatus("#lab-status", text("labReadError"), "error");
  } finally {
    labFileInput.value = "";
  }
}

labFileInput.addEventListener("change", (event) => loadLabFile(event.currentTarget.files?.[0]));
labDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  labDropZone.classList.add("is-dragging");
});
labDropZone.addEventListener("dragleave", () => labDropZone.classList.remove("is-dragging"));
labDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  labDropZone.classList.remove("is-dragging");
  loadLabFile(event.dataTransfer?.files?.[0]);
});

element("#review-lab-results").addEventListener("click", () => {
  const lines = element("#lab-text").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const breakdown = element("#lab-result-breakdown");
  breakdown.replaceChildren();
  if (!lines.length) {
    setStatus("#lab-status", text("labEmpty"), "error");
    return;
  }
  if (lines.length > 200) {
    setStatus("#lab-status", text("labTooManyRows"), "error");
    return;
  }
  for (const line of lines) {
    const entry = document.createElement("p");
    entry.className = "lab-result-line";
    entry.textContent = line;
    entry.dir = "auto";
    breakdown.append(entry);
  }
  setStatus("#lab-status", text("labPreviewReady"), "success");
});

element("#clear-lab-results").addEventListener("click", () => {
  element("#lab-text").value = "";
  element("#lab-result-breakdown").replaceChildren();
  clearLabImage();
  setStatus("#lab-status", "");
});

function prepareShareSummary(summary, titleKey, statusSelector, channel) {
  const content = summary.trim();
  if (!content) {
    setStatus(statusSelector, text("shareNoContent"), "error");
    return;
  }

  if (channel === "whatsapp") {
    const shareUrl = new URL("https://wa.me/");
    shareUrl.searchParams.set("text", content);
    window.open(shareUrl.href, "_blank", "noopener,noreferrer");
    setStatus(statusSelector, text("shareOpenWhatsApp"), "success");
    return;
  }

  element("#share-print-title").textContent = text(titleKey);
  element("#share-print-date").textContent = new Intl.DateTimeFormat(
    language === "zh" ? "zh-CN" : language,
    { dateStyle: "medium", timeStyle: "short" },
  ).format(new Date());
  element("#share-print-content").textContent = content;
  element("#share-print-disclaimer").textContent = text("sharePrintDisclaimer");
  const printSheet = element("#share-print-sheet");
  printSheet.hidden = false;
  window.addEventListener("afterprint", () => {
    printSheet.hidden = true;
  }, { once: true });
  setStatus(statusSelector, text("sharePdfReady"), "success");
  window.print();
}

element("#prescription-pdf-button").addEventListener("click", () => {
  prepareShareSummary(
    element("#prescription-share-summary").value,
    "prescriptionShareLabel",
    "#prescription-share-status",
    "pdf",
  );
});
element("#prescription-whatsapp-button").addEventListener("click", () => {
  prepareShareSummary(
    element("#prescription-share-summary").value,
    "prescriptionShareLabel",
    "#prescription-share-status",
    "whatsapp",
  );
});
element("#lab-pdf-button").addEventListener("click", () => {
  prepareShareSummary(element("#lab-text").value, "labHeading", "#lab-share-status", "pdf");
});
element("#lab-whatsapp-button").addEventListener("click", () => {
  prepareShareSummary(element("#lab-text").value, "labHeading", "#lab-share-status", "whatsapp");
});

element("#medicine-price-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const query = element("#medicine-price-query").value.trim();
  if (!query) {
    setStatus("#medicine-price-status", text("required"), "error");
    return;
  }
  setStatus("#medicine-price-status", text("medicinePriceManual"), "success");
  window.open(
    "https://edaegypt.gov.eg/ar/%D8%A7%D9%84%D8%AE%D8%AF%D9%85%D8%A7%D8%AA/%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D8%AD%D8%B6%D8%B1%D8%A7%D8%AA-%D9%88%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D9%84%D8%B2%D9%85%D8%A7%D8%AA-%D8%A7%D9%84%D8%B7%D8%A8%D9%8A%D8%A9/",
    "_blank",
    "noopener,noreferrer",
  );
});

const triageSpecialties = {
  general: "specialtyPrimaryCare",
  heart: "specialtyCardiology",
  breathing: "specialtyPulmonology",
  skin: "specialtyDermatology",
  stomach: "specialtyGastroenterology",
  bones: "specialtyOrthopedics",
  eyes: "specialtyOphthalmology",
  mental: "specialtyMentalHealth",
  child: "specialtyPediatrics",
};

function renderTriageResult() {
  const result = element("#triage-result");
  if (!result) return;
  result.replaceChildren();
  if (!triageResultState) {
    result.hidden = true;
    return;
  }

  const emergency = triageResultState.emergency;
  result.hidden = false;
  result.className = `triage-result${emergency ? " is-emergency" : ""}`;
  const heading = document.createElement("h3");
  heading.textContent = text(emergency ? "triageEmergency" : "triageRoutine");
  result.append(heading);
  if (!emergency) {
    const specialty = document.createElement("p");
    specialty.textContent = `${text("suggestedSpecialty")}: ${text(triageSpecialties[triageResultState.topic])}`;
    result.append(specialty);
  } else {
    const emergencyText = document.createElement("p");
    emergencyText.textContent = text("triageEmergencyAction");
    result.append(emergencyText);
    const call = document.createElement("a");
    call.href = "tel:123";
    call.className = "button button-danger";
    call.textContent = `${text("callAmbulance")} 123`;
    call.dir = "ltr";
    result.append(call);
  }
  const limitation = document.createElement("p");
  limitation.className = "triage-limitation";
  limitation.textContent = text("triageLimitation");
  result.append(limitation);
}

element("#symptom-checker-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const hasRedFlag = form.querySelector('input[name="redFlag"]:checked') !== null;
  const topic = form.elements.topic.value;
  if (hasRedFlag) {
    triageResultState = { emergency: true };
  } else if (topic && triageSpecialties[topic]) {
    triageResultState = { emergency: false, topic };
  } else {
    triageResultState = null;
    renderTriageResult();
    setStatus("#triage-status", text("triageChooseTopic"), "error");
    return;
  }
  setStatus("#triage-status", "");
  renderTriageResult();
  element("#triage-result").scrollIntoView({ behavior: "smooth", block: "nearest" });
});

element("#symptom-checker-form").addEventListener("change", () => {
  const status = element("#triage-status");
  if (status) status.textContent = "";
});

element("#symptom-checker-form").addEventListener("reset", () => {
  triageResultState = null;
  setStatus("#triage-status", "");
  window.setTimeout(renderTriageResult, 0);
});

function makeCalculatorResult(type, data) {
  calculatorResults.set(type, data);
  renderCalculatorResult(type);
}

function renderCalculatorResult(type) {
  const target = element(`#${type}-result`);
  const result = calculatorResults.get(type);
  if (!target || !result) return;
  target.replaceChildren();

  const summary = document.createElement("p");
  summary.className = "calculator-summary";
  const progress = document.createElement("progress");
  progress.className = "indicator-bar";
  progress.setAttribute("aria-label", text("indicatorVisual"));

  if (type === "bmi") {
    summary.textContent = `${text("bmiResult")}: ${result.value.toFixed(1)} — ${text(result.categoryKey)}`;
    progress.max = 40;
    progress.value = Math.min(result.value, 40);
  } else if (type === "water") {
    summary.textContent = `${text("waterProgress")}: ${result.consumed.toFixed(1)} / ${result.reference.toFixed(1)} L`;
    progress.max = result.reference;
    progress.value = Math.min(result.consumed, result.reference);
  } else {
    summary.textContent = `${text("caloriesEstimate")}: ${Math.round(result.value).toLocaleString(language)} kcal/day`;
    progress.max = 5000;
    progress.value = Math.min(result.value, 5000);
  }
  target.append(summary, progress);
}

function renderCalculatorResults() {
  for (const type of calculatorResults.keys()) renderCalculatorResult(type);
}

document.querySelectorAll("[data-calc-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    for (const candidate of document.querySelectorAll("[data-calc-tab]")) {
      const selected = candidate === tab;
      candidate.classList.toggle("is-active", selected);
      candidate.setAttribute("aria-selected", String(selected));
      candidate.tabIndex = selected ? 0 : -1;
      element(`#${candidate.getAttribute("aria-controls")}`).hidden = !selected;
    }
  });
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll("[data-calc-tab]")];
    const currentIndex = tabs.indexOf(tab);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    tabs[nextIndex].focus();
    tabs[nextIndex].click();
  });
});

element("#bmi-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const height = Number(event.currentTarget.elements.height.value);
  const weight = Number(event.currentTarget.elements.weight.value);
  if (!Number.isFinite(height) || height < 120 || height > 230 || !Number.isFinite(weight) || weight < 25 || weight > 350) {
    calculatorResults.delete("bmi");
    setStatus("#bmi-result", text("calculatorInvalid"), "error");
    return;
  }
  const value = weight / ((height / 100) ** 2);
  const categoryKey = value < 18.5
    ? "bmiBelow"
    : value < 25
      ? "bmiWithin"
      : value < 30
        ? "bmiAbove"
        : "bmiHigh";
  setStatus("#bmi-result", "");
  makeCalculatorResult("bmi", { value, categoryKey });
});

element("#water-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const consumed = Number(event.currentTarget.elements.consumed.value);
  const reference = event.currentTarget.elements.reference.value === "female" ? 2.7 : 3.7;
  if (!Number.isFinite(consumed) || consumed < 0 || consumed > 15) {
    calculatorResults.delete("water");
    setStatus("#water-result", text("calculatorInvalid"), "error");
    return;
  }
  setStatus("#water-result", "");
  makeCalculatorResult("water", { consumed, reference });
});

element("#calories-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const age = Number(form.elements.age.value);
  const height = Number(form.elements.height.value);
  const weight = Number(form.elements.weight.value);
  const activity = Number(form.elements.activity.value);
  if (
    !Number.isFinite(age) || age < 18 || age > 75 ||
    !Number.isFinite(height) || height < 120 || height > 230 ||
    !Number.isFinite(weight) || weight < 30 || weight > 300 ||
    ![1.2, 1.375, 1.55, 1.725].includes(activity)
  ) {
    calculatorResults.delete("calories");
    setStatus("#calories-result", text("calculatorInvalid"), "error");
    return;
  }
  const sexAdjustment = form.elements.sex.value === "female" ? -161 : 5;
  const restingEnergy = (10 * weight) + (6.25 * height) - (5 * age) + sexAdjustment;
  const value = Math.max(0, restingEnergy * activity);
  setStatus("#calories-result", "");
  makeCalculatorResult("calories", { value });
});

function addChatMessage(role, content) {
  const message = document.createElement("p");
  message.className = `chat-message chat-${role}`;
  message.textContent = content;
  element("#chat-log").append(message);
  message.scrollIntoView({ block: "nearest" });
}

element("#assistant-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = element("#assistant-message");
  const message = input.value.trim();
  if (!message) {
    setStatus("#assistant-status", text("assistantEmpty"), "error");
    return;
  }
  setStatus("#assistant-status", text("assistantLoading"));
  element("#assistant-send").disabled = true;
  try {
    const response = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, language }),
    });
    const result = await response.json().catch(() => ({}));
    if (
      response.status >= 500 &&
      !response.headers.get("content-type")?.includes("application/json")
    ) {
      setStatus("#assistant-status", text("assistantBackendUnavailable"), "error");
      return;
    }
    if (response.status === 503 && result.code === "AI_NOT_CONFIGURED") {
      setStatus("#assistant-status", text("assistantSetup"), "error");
      return;
    }
    if (response.status === 404) {
      setStatus("#assistant-status", text("assistantBackendUnavailable"), "error");
      return;
    }
    if (!response.ok || typeof result.reply !== "string") throw new Error(result.error || "Assistant request failed");
    addChatMessage("user", message);
    addChatMessage("assistant", result.reply);
    input.value = "";
    setStatus("#assistant-status", "");
  } catch (error) {
    console.error("Assistant request failed:", error);
    setStatus(
      "#assistant-status",
      error instanceof TypeError ? text("assistantBackendUnavailable") : text("assistantError"),
      "error",
    );
  } finally {
    element("#assistant-send").disabled = false;
  }
});

element("#contact-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements.name.value.trim();
  const email = form.elements.email.value.trim();
  const message = form.elements.message.value.trim();
  if (!name || !email || !message) {
    setStatus("#contact-status", text("required"), "error");
    return;
  }

  const body = [
    `${text("fullName")}: ${name}`,
    `${text("email")}: ${email}`,
    "",
    `${text("contactMessage")}:`,
    message,
  ].join("\n");
  const query = new URLSearchParams({
    subject: text("contactEmailSubject"),
    body,
  });
  setStatus("#contact-status", text("contactOpened"), "success");
  window.location.href = `mailto:?${query.toString()}`;
});

applyLanguage(language);

setStatus("#auth-status", text("authLoading"));
authPersistence
  .then(() => {
    element("#firebase-message").hidden = true;
    return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      renderSignedOut();
      return;
    }
    renderSignedIn(user);
    try {
      await loadPatientData(user);
    } catch (error) {
      console.error("Private patient data could not be loaded:", error);
      setStatus("#profile-status", authErrorMessage(error), "error");
      setStatus("#record-status", authErrorMessage(error), "error");
      element("#records-list").textContent = authErrorMessage(error);
    }
    }, (error) => {
    console.error("Firebase authentication state failed:", error);
    element("#firebase-message").hidden = false;
    setStatus("#auth-status", text("firebaseSetup"), "error");
    });
  })
  .catch((error) => {
    console.error("Firebase authentication could not be initialized:", error);
    element("#firebase-message").hidden = false;
    setStatus("#auth-status", text("firebaseSetup"), "error");
  });

fetch("/api/assistant/status")
  .then((response) => {
    if (response.status === 404) throw new Error("API_NOT_RUNNING");
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error("API_NOT_RUNNING");
    }
    if (response.status >= 500) throw new Error("API_NOT_RUNNING");
    if (!response.ok) throw new Error(`Assistant status returned ${response.status}`);
    return response.json();
  })
  .then(({ configured }) => {
    if (!configured) setStatus("#assistant-status", text("assistantSetup"), "error");
  })
  .catch((error) => {
    console.warn("Assistant status could not be checked:", error);
    setStatus(
      "#assistant-status",
      error.message === "API_NOT_RUNNING" || error instanceof TypeError
        ? text("assistantBackendUnavailable")
        : text("assistantUnavailable"),
      "error",
    );
  });
