(function () {
  const form = document.getElementById("intake-form");
  const alertBox = document.getElementById("alert");
  const submitButton = document.getElementById("submit-button");
  const successState = document.getElementById("success-state");
  const successTitle = document.getElementById("success-title");
  const successMessage = document.getElementById("success-message");
  const languageInput = document.getElementById("language");
  const languageLabel = document.getElementById("language-label");
  const cidInput = document.getElementById("cid");

  const insuranceStatus = document.getElementById("insurance_status");
  const payerName = document.getElementById("payer_name");
  const memberId = document.getElementById("member_id");
  const patientIsSubscriber = document.getElementById("patient_is_subscriber");
  const subscriberSection = document.getElementById("subscriber-section");
  const subscriberName = document.getElementById("subscriber_name");
  const subscriberDob = document.getElementById("subscriber_dob");
  const subscriberRelationship = document.getElementById("subscriber_relationship");
  const secondarySection = document.getElementById("secondary-section");
  const hasSecondary = document.getElementById("has_secondary");
  const secondaryPayer = document.getElementById("secondary_payer");
  const secondaryMemberId = document.getElementById("secondary_member_id");
  const priorAuth = document.getElementById("prior_auth");
  const priorAuthNumber = document.getElementById("prior_auth_number");
  const planChangeThisYear = document.getElementById("plan_change_this_year");
  const planChangeDetails = document.getElementById("plan_change_details");
  const primaryInsuranceSection = document.getElementById("primary-insurance-section");

  const config = window.INTAKE_FORM_CONFIG || {};
  const submitUrl = config.submitUrl || "";

  const params = new URLSearchParams(window.location.search);
  const cid = params.get("cid") || "";
  const lang = (params.get("lang") || "en").toLowerCase().startsWith("es") ? "es" : "en";

  cidInput.value = cid;
  languageInput.value = lang;
  languageLabel.textContent = `Language: ${lang === "es" ? "Spanish" : "English"}`;

  function showAlert(message, tone) {
    alertBox.className = `alert alert-${tone}`;
    alertBox.textContent = message;
    alertBox.classList.remove("hidden");
  }

  function clearAlert() {
    alertBox.className = "alert hidden";
    alertBox.textContent = "";
  }

  function hideForm() {
    form.classList.add("hidden");
    submitButton.disabled = true;
  }

  function setFieldValue(name, value) {
    if (value === null || value === undefined || value === "") return;
    const field = form.elements.namedItem(name);
    if (!field) return;

    if (field instanceof RadioNodeList) {
      for (const option of field) {
        if (option.value === String(value)) {
          option.checked = true;
        }
      }
      return;
    }

    field.value = String(value);
  }

  function applyPrefill(booking) {
    if (!booking || typeof booking !== "object") return;

    [
      "first_name",
      "appointment_text",
      "reason",
      "patient_status",
      "callback_number",
      "full_legal_name",
      "dob",
      "gender",
      "email",
      "contact_number",
      "mailing_address",
      "insurance_status",
      "payer_name",
      "member_id",
      "group_number",
      "plan_type",
      "payer_id",
      "customer_service_number",
      "patient_is_subscriber",
      "subscriber_name",
      "subscriber_dob",
      "subscriber_relationship",
      "subscriber_employer",
      "has_secondary",
      "secondary_payer",
      "secondary_member_id",
      "primary_plan",
      "plan_change_this_year",
      "plan_change_details",
      "referring_provider",
      "provider_name",
      "npi",
      "tax_id",
      "cpt_codes",
      "prior_auth",
      "prior_auth_number",
      "seen_other_provider",
      "notes",
    ].forEach((name) => setFieldValue(name, booking[name]));

    if (booking.language) {
      languageInput.value = String(booking.language).toLowerCase().startsWith("es") ? "es" : "en";
      languageLabel.textContent = `Language: ${languageInput.value === "es" ? "Spanish" : "English"}`;
    }
  }

  function showSubmittedState(title, message) {
    clearAlert();
    hideForm();
    if (successTitle) successTitle.textContent = title;
    if (successMessage) successMessage.textContent = message;
    successState.classList.remove("hidden");
  }

  function setRequired(element, required) {
    if (!element) return;
    element.required = required;
  }

  function setSectionVisibility(element, visible) {
    if (!element) return;
    element.classList.toggle("hidden", !visible);
  }

  function insuranceRequiresCardFields() {
    return ["covered", "partial", "pending"].includes(insuranceStatus.value);
  }

  function updateConditionalUI() {
    const needsInsuranceFields = insuranceRequiresCardFields();
    const subscriberDifferent = needsInsuranceFields && patientIsSubscriber.value === "false";
    const hasSecondaryCoverage = needsInsuranceFields && hasSecondary.value === "true";
    const hasPriorAuthorization = priorAuth.value === "true";
    const hasPlanChange = planChangeThisYear.value === "true";

    setSectionVisibility(primaryInsuranceSection, needsInsuranceFields);
    setSectionVisibility(secondarySection, needsInsuranceFields);
    setSectionVisibility(subscriberSection, subscriberDifferent);

    setRequired(payerName, needsInsuranceFields);
    setRequired(memberId, needsInsuranceFields);
    setRequired(patientIsSubscriber, needsInsuranceFields);
    setRequired(hasSecondary, needsInsuranceFields);

    setRequired(subscriberName, subscriberDifferent);
    setRequired(subscriberDob, subscriberDifferent);
    setRequired(subscriberRelationship, subscriberDifferent);

    setRequired(secondaryPayer, hasSecondaryCoverage);
    setRequired(secondaryMemberId, hasSecondaryCoverage);
    setRequired(priorAuthNumber, hasPriorAuthorization);
    setRequired(planChangeDetails, hasPlanChange);

    document.querySelectorAll(".secondary-only").forEach((element) => {
      setSectionVisibility(element, hasSecondaryCoverage);
    });
    document.querySelectorAll(".prior-auth-only").forEach((element) => {
      setSectionVisibility(element, hasPriorAuthorization);
    });
    document.querySelectorAll(".plan-change-only").forEach((element) => {
      setSectionVisibility(element, hasPlanChange);
    });
  }

  function toPlainObject(formElement) {
    const formData = new FormData(formElement);
    const payload = {};

    formData.forEach((value, key) => {
      if (typeof value !== "string") return;
      const trimmed = value.trim();
      if (trimmed === "") return;
      payload[key] = trimmed;
    });

    payload.intake_method = "form";
    payload.language = languageInput.value || "en";
    payload.cid = cidInput.value;

    return payload;
  }

  async function loadExistingBooking() {
    if (!cid || !submitUrl || submitUrl.includes("YOUR_SUPABASE_PROJECT")) return;

    try {
      const response = await fetch(`${submitUrl}?cid=${encodeURIComponent(cid)}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      const data = await response.json().catch(() => ({}));
      if (response.status === 404) {
        showAlert("You have unauthorized access to this form.", "error");
        hideForm();
        return;
      }
      if (!response.ok || data.ok !== true || !data.booking) {
        showAlert("Unable to load this secure form right now. Please use the original link sent after the call.", "error");
        hideForm();
        return;
      }

      if (data.booking.form_status === "submitted") {
        showSubmittedState(
          "Already submitted",
          "You have already filled in this form. Our team will review your details and follow up if anything else is needed."
        );
        return;
      }

      applyPrefill(data.booking);
      updateConditionalUI();
    } catch (_) {
      // Keep the form usable even if prefill lookup fails.
    }
  }

  insuranceStatus.addEventListener("change", updateConditionalUI);
  patientIsSubscriber.addEventListener("change", updateConditionalUI);
  hasSecondary.addEventListener("change", updateConditionalUI);
  priorAuth.addEventListener("change", updateConditionalUI);
  planChangeThisYear.addEventListener("change", updateConditionalUI);

  updateConditionalUI();

  if (!cid) {
    showAlert("You have unauthorized access to this form.", "error");
    hideForm();
  } else if (!submitUrl || submitUrl.includes("YOUR_SUPABASE_PROJECT")) {
    showAlert("This form is not configured yet. Update config.js with the deployed submit-form endpoint before using it.", "error");
    hideForm();
  }

  loadExistingBooking();

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    clearAlert();

    if (!form.reportValidity()) return;
    if (!cidInput.value) {
      showAlert("Missing secure call reference.", "error");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Submitting...";

    try {
      const payload = toPlainObject(form);
      const response = await fetch(submitUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) {
        throw new Error(data.error || "Submission failed. Please try again.");
      }

      showSubmittedState(
        "Thank you",
        "Your intake form was submitted successfully. If you reopen this secure link, we will show this confirmation instead of asking you to fill the form again."
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : "Submission failed. Please try again.", "error");
      submitButton.disabled = false;
      submitButton.textContent = "Submit Intake Form";
    }
  });
})();
