(function () {
  const form = document.getElementById("intake-form");
  const alertBox = document.getElementById("alert");
  const submitButton = document.getElementById("submit-button");
  const successState = document.getElementById("success-state");
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

  insuranceStatus.addEventListener("change", updateConditionalUI);
  patientIsSubscriber.addEventListener("change", updateConditionalUI);
  hasSecondary.addEventListener("change", updateConditionalUI);
  priorAuth.addEventListener("change", updateConditionalUI);
  planChangeThisYear.addEventListener("change", updateConditionalUI);

  updateConditionalUI();

  if (!cid) {
    showAlert("This form link is missing the secure call reference. Please use the link that was sent to you after the call.", "error");
    submitButton.disabled = true;
  } else if (!submitUrl || submitUrl.includes("YOUR_SUPABASE_PROJECT")) {
    showAlert("This form is not configured yet. Update config.js with the deployed submit-form endpoint before using it.", "error");
    submitButton.disabled = true;
  }

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

      form.classList.add("hidden");
      successState.classList.remove("hidden");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : "Submission failed. Please try again.", "error");
      submitButton.disabled = false;
      submitButton.textContent = "Submit Intake Form";
    }
  });
})();
