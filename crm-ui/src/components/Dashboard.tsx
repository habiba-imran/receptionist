"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";
import type { Booking, MessageLog } from "../types/crm";
import { dispatchCRMAction, fetchCRMData } from "../utils/api";
import {
  fallback,
  formatBoolean,
  formatDateOnly,
  formatDateTime,
  getStatusDetails,
  getStatusTone,
  humanizeToken,
  isUrgentTriage,
} from "../utils/format";

type TabKey = "summary" | "notes";
type CRMAction = "resend_confirmation" | "resend_form";
type FilterKey = "all" | "needs_review" | "form_pending" | "confirmation_pending" | "urgent";
type ActionFeedback = {
  tone: "success" | "error";
  message: string;
};

const AUTO_REFRESH_MS = 15000;

export default function Dashboard() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [messages, setMessages] = useState<MessageLog[]>([]);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("summary");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<CRMAction | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const deferredSearch = useDeferredValue(search);
  const backgroundRefreshInFlight = useRef(false);

  async function loadDashboard(options?: { background?: boolean }) {
    const background = options?.background ?? false;
    if (background && backgroundRefreshInFlight.current) return;

    try {
      if (background) {
        backgroundRefreshInFlight.current = true;
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      const data = await fetchCRMData();
      setBookings(data.bookings ?? []);
      setMessages(data.messages ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load CRM data.");
    } finally {
      if (background) {
        backgroundRefreshInFlight.current = false;
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    let intervalId: number | null = null;

    const stopAutoRefresh = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const startAutoRefresh = () => {
      stopAutoRefresh();
      if (document.visibilityState !== "visible") return;

      intervalId = window.setInterval(() => {
        void loadDashboard({ background: true });
      }, AUTO_REFRESH_MS);
    };

    const syncAutoRefresh = () => {
      if (document.visibilityState === "visible") {
        void loadDashboard({ background: true });
        startAutoRefresh();
        return;
      }

      stopAutoRefresh();
    };

    syncAutoRefresh();
    document.addEventListener("visibilitychange", syncAutoRefresh);
    window.addEventListener("focus", syncAutoRefresh);
    window.addEventListener("blur", stopAutoRefresh);

    return () => {
      stopAutoRefresh();
      document.removeEventListener("visibilitychange", syncAutoRefresh);
      window.removeEventListener("focus", syncAutoRefresh);
      window.removeEventListener("blur", stopAutoRefresh);
    };
  }, []);

  useEffect(() => {
    if (!bookings.length) {
      setSelectedBookingId(null);
      return;
    }

    if (!selectedBookingId || !bookings.some((booking) => booking.id === selectedBookingId)) {
      setSelectedBookingId(bookings[0].id);
    }
  }, [bookings, selectedBookingId]);

  useEffect(() => {
    setActionFeedback(null);
  }, [selectedBookingId]);

  const query = deferredSearch.trim().toLowerCase();
  const filteredBookings = bookings.filter((booking) => {
    const matchesFilter = matchesQuickFilter(booking, activeFilter);
    if (!matchesFilter) return false;

    if (!query) return true;

    const haystack = [
      booking.first_name,
      booking.full_legal_name,
      booking.contact_number,
      booking.reason,
      booking.appointment_text,
      booking.call_id,
      booking.payer_name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });

  const filterCounts: Record<FilterKey, number> = {
    all: bookings.length,
    needs_review: bookings.filter((booking) => matchesQuickFilter(booking, "needs_review")).length,
    form_pending: bookings.filter((booking) => matchesQuickFilter(booking, "form_pending")).length,
    confirmation_pending: bookings.filter((booking) => matchesQuickFilter(booking, "confirmation_pending")).length,
    urgent: bookings.filter((booking) => matchesQuickFilter(booking, "urgent")).length,
  };

  const selectedBooking =
    filteredBookings.find((booking) => booking.id === selectedBookingId) ??
    bookings.find((booking) => booking.id === selectedBookingId) ??
    null;

  const selectedStatus = selectedBooking
    ? getStatusDetails(selectedBooking.triage_flag, selectedBooking.needs_review)
    : null;
  const relatedMessages = selectedBooking
    ? messages
        .filter((message) => {
          if (message.booking_id && message.booking_id === selectedBooking.id) return true;
          if (message.call_id && message.call_id === selectedBooking.call_id) return true;
          return false;
        })
        .sort((left, right) => {
          const leftTime = new Date(left.created_at).getTime();
          const rightTime = new Date(right.created_at).getTime();
          return rightTime - leftTime;
        })
    : [];

  const canResendConfirmation = Boolean(selectedBooking?.call_id && selectedBooking?.contact_number);
  const canResendForm = Boolean(
    selectedBooking?.call_id &&
      selectedBooking?.contact_number &&
      selectedBooking?.intake_method === "form" &&
      selectedBooking?.form_status !== "submitted"
  );

  const resendFormDisabledReason = !selectedBooking
    ? "Select a booking first."
    : !selectedBooking.call_id
      ? "This booking is missing a call ID."
      : !selectedBooking.contact_number
        ? "This booking has no contact number."
        : selectedBooking.intake_method !== "form"
          ? "Resend form is only relevant for form-intake bookings."
          : selectedBooking.form_status === "submitted"
            ? "The intake form has already been submitted."
            : "";

  const resendConfirmationDisabledReason = !selectedBooking
    ? "Select a booking first."
    : !selectedBooking.call_id
      ? "This booking is missing a call ID."
      : !selectedBooking.contact_number
        ? "This booking has no contact number."
        : "";

  async function runAction(action: CRMAction) {
    if (!selectedBooking?.call_id) return;

    try {
      setActiveAction(action);
      setActionFeedback(null);
      await dispatchCRMAction(action, selectedBooking.call_id);
      await loadDashboard({ background: true });
      setActionFeedback({
        tone: "success",
        message:
          action === "resend_confirmation"
            ? "Confirmation message sent successfully."
            : "Form link sent successfully.",
      });
    } catch (actionError) {
      setActionFeedback({
        tone: "error",
        message: actionError instanceof Error ? actionError.message : "Action failed.",
      });
    } finally {
      setActiveAction(null);
    }
  }

  return (
    <div className="app-container">
      <header className="main-navbar">
        <div className="navbar-brand">
          <div className="logo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
            <h2>Awaaz Labs</h2>
          </div>
          <span className="subtitle">Agent CRM</span>
        </div>
        <div className="top-bar-actions">
          <div className="search-bar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              placeholder="Search bookings..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-outline top-bar-button"
            onClick={() => void loadDashboard({ background: true })}
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      <main className="main-content">

        {error && bookings.length ? (
          <div className="system-feedback system-feedback-error">
            <span>{error}</span>
          </div>
        ) : null}

        <div className={`dashboard-layout ${mobileView === "detail" ? "show-detail" : "show-list"}`}>
          <section className="list-section">
            <div className="section-header">
              <h3>Recent AI Bookings</h3>
              <span className="badge">{filteredBookings.length}</span>
            </div>

            <div className="filters">
              <select 
                className="filter-dropdown"
                value={activeFilter}
                onChange={(e) => setActiveFilter(e.target.value as FilterKey)}
              >
                <option value="all">All Bookings ({filterCounts.all})</option>
                <option value="needs_review">Needs Review ({filterCounts.needs_review})</option>
                <option value="form_pending">Form Pending ({filterCounts.form_pending})</option>
                <option value="confirmation_pending">Confirmation Pending ({filterCounts.confirmation_pending})</option>
                <option value="urgent">Urgent ({filterCounts.urgent})</option>
              </select>
            </div>

            <div className="bookings-list">
              {loading ? (
                <div className="panel-state">
                  <p>Loading bookings...</p>
                </div>
              ) : error ? (
                <div className="panel-state panel-state-error">
                  <p>{error}</p>
                  <button type="button" className="btn btn-outline" onClick={() => void loadDashboard()}>
                    Retry
                  </button>
                </div>
              ) : filteredBookings.length === 0 ? (
                <div className="panel-state">
                  <p>
                    {bookings.length
                      ? "No bookings match the current search and filter."
                      : "No bookings available yet."}
                  </p>
                </div>
              ) : (
                filteredBookings.map((booking) => {
                  const status = getStatusDetails(booking.triage_flag, booking.needs_review);
                  const isSelected = selectedBooking?.id === booking.id;
                  const patientName =
                    fallback(booking.first_name) !== "--"
                      ? fallback(booking.first_name)
                      : fallback(booking.full_legal_name, "Unknown caller");

                  return (
                    <button
                      type="button"
                      key={booking.id}
                      className={`booking-item ${isSelected ? "selected" : ""}`}
                      onClick={() => {
                        setSelectedBookingId(booking.id);
                        setActiveTab("summary");
                        setMobileView("detail");
                      }}
                    >
                      <div className="b-header">
                        <span className="b-name">{patientName}</span>
                        <span className={`b-status ${status.class}`}>{status.text}</span>
                      </div>

                      <p className="b-reason">{fallback(booking.reason, "No reason captured yet.")}</p>

                      <div className="booking-meta">
                        <span>{fallback(booking.appointment_text, "Timing pending")}</span>
                        <span>{humanizeToken(booking.intake_method, "Intake pending")}</span>
                      </div>

                      <div className="b-footer">
                        <div className="b-time">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                          </svg>
                          {formatDateTime(booking.call_started_at ?? booking.created_at)}
                        </div>

                        <span>
                          {booking.needs_review ? "Review" : humanizeToken(booking.confirmation_status, "Pending")}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="detail-section">
            {!selectedBooking ? (
              <div className="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                <p>{loading ? "Loading CRM details..." : "Select a booking to view details"}</p>
              </div>
            ) : (
              <div className="booking-details">
                <button 
                  className="mobile-back-btn" 
                  onClick={() => setMobileView("list")}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="19" y1="12" x2="5" y2="12"></line>
                    <polyline points="12 19 5 12 12 5"></polyline>
                  </svg>
                  Back to Bookings
                </button>
                <div className="detail-header">
                  <div className="patient-title">
                    <h2>{fallback(selectedBooking.full_legal_name ?? selectedBooking.first_name, "Unknown caller")}</h2>
                    <span className={`status-badge ${selectedStatus?.class ?? "status-normal"}`}>
                      {selectedStatus?.badgeText ?? "READY"}
                    </span>
                  </div>

                  <div className="action-buttons">
                    <button
                      className="btn btn-outline"
                      type="button"
                      onClick={() => void loadDashboard({ background: true })}
                    >
                      {refreshing ? "Refreshing..." : "Refresh Data"}
                    </button>
                    <button
                      className="btn btn-outline"
                      type="button"
                      disabled={!canResendForm || activeAction !== null}
                      title={canResendForm ? "Resend intake form" : resendFormDisabledReason}
                      onClick={() => void runAction("resend_form")}
                    >
                      {activeAction === "resend_form" ? "Sending Form..." : "Resend Form"}
                    </button>
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={!canResendConfirmation || activeAction !== null}
                      title={canResendConfirmation ? "Resend confirmation message" : resendConfirmationDisabledReason}
                      onClick={() => void runAction("resend_confirmation")}
                    >
                      {activeAction === "resend_confirmation" ? "Sending Confirmation..." : "Resend Confirmation"}
                    </button>
                  </div>
                </div>

                {actionFeedback ? (
                  <div className={`action-feedback action-feedback-${actionFeedback.tone}`}>
                    <span>{actionFeedback.message}</span>
                  </div>
                ) : null}

                {(selectedBooking.triage_flag || selectedBooking.needs_review) && (
                  <div className="alert urgent-alert">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                      <line x1="12" y1="9" x2="12" y2="13"></line>
                      <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>

                    <div>
                      <strong>{selectedBooking.triage_flag ? "Triage Flag Present" : "Needs Review"}</strong>
                      <p>
                        {selectedBooking.triage_flag
                          ? humanizeToken(selectedBooking.triage_flag)
                          : `Review reasons: ${selectedBooking.review_reasons.join(", ")}`}
                      </p>
                    </div>
                  </div>
                )}

                <div className="detail-grid">
                  <AccordionCard title="Appointment Details" defaultOpen={true}>
                    <InfoRow label="Preferred timing" value={fallback(selectedBooking.appointment_text)} />
                    <InfoRow label="Appointment date" value={formatDateTime(selectedBooking.appointment_at)} />
                    <InfoRow label="Doctor" value={fallback(selectedBooking.assigned_doctor)} />
                    <InfoRow label="Reason" value={fallback(selectedBooking.reason)} />
                    <InfoRow label="Patient status" value={humanizeToken(selectedBooking.patient_status)} />
                    <InfoRow label="Language" value={humanizeToken(selectedBooking.language)} />
                  </AccordionCard>

                  <AccordionCard title="Patient & Contact" defaultOpen={true}>
                    <InfoRow label="First name" value={fallback(selectedBooking.first_name)} />
                    <InfoRow label="Full legal name" value={fallback(selectedBooking.full_legal_name)} />
                    <InfoRow label="DOB" value={formatDateOnly(selectedBooking.dob)} />
                    <InfoRow label="Contact number" value={fallback(selectedBooking.contact_number)} />
                    <InfoRow label="Callback number" value={fallback(selectedBooking.callback_number)} />
                    <InfoRow label="WhatsApp suitable" value={formatBoolean(selectedBooking.whatsapp_suitable)} />
                    <InfoRow label="Email" value={fallback(selectedBooking.email)} />
                    <InfoRow label="Address" value={fallback(selectedBooking.mailing_address)} />
                  </AccordionCard>

                  <AccordionCard title="Insurance" className="full-width" defaultOpen={false}>
                    <div className="insurance-grid">
                      <InfoRow
                        label="Insurance status"
                        value={humanizeToken(selectedBooking.insurance_status)}
                        tone={getStatusTone("insurance", selectedBooking.insurance_status)}
                      />
                      <InfoRow label="Payer" value={fallback(selectedBooking.payer_name)} />
                      <InfoRow label="Member ID" value={fallback(selectedBooking.member_id)} />
                      <InfoRow label="Group number" value={fallback(selectedBooking.group_number)} />
                      <InfoRow label="Plan type" value={fallback(selectedBooking.plan_type)} />
                      <InfoRow label="Payer ID" value={fallback(selectedBooking.payer_id)} />
                      <InfoRow label="Customer service" value={fallback(selectedBooking.customer_service_number)} />
                      <InfoRow label="Prior auth" value={formatBoolean(selectedBooking.prior_auth)} />
                      <InfoRow label="Prior auth number" value={fallback(selectedBooking.prior_auth_number)} />
                      <InfoRow label="CPT codes" value={fallback(selectedBooking.cpt_codes)} />
                    </div>
                  </AccordionCard>

                  <AccordionCard title="Subscriber & Secondary Coverage" defaultOpen={false}>
                    <InfoRow label="Patient is subscriber" value={formatBoolean(selectedBooking.patient_is_subscriber)} />
                    <InfoRow label="Subscriber name" value={fallback(selectedBooking.subscriber_name)} />
                    <InfoRow label="Subscriber DOB" value={formatDateOnly(selectedBooking.subscriber_dob)} />
                    <InfoRow label="Relationship" value={fallback(selectedBooking.subscriber_relationship)} />
                    <InfoRow label="Subscriber employer" value={fallback(selectedBooking.subscriber_employer)} />
                    <InfoRow label="Has secondary plan" value={formatBoolean(selectedBooking.has_secondary)} />
                    <InfoRow label="Secondary payer" value={fallback(selectedBooking.secondary_payer)} />
                    <InfoRow label="Secondary member ID" value={fallback(selectedBooking.secondary_member_id)} />
                    <InfoRow label="Primary plan" value={humanizeToken(selectedBooking.primary_plan)} />
                    <InfoRow label="Plan changed this year" value={formatBoolean(selectedBooking.plan_change_this_year)} />
                  </AccordionCard>

                  <AccordionCard title="Operational Status" defaultOpen={false}>
                    <InfoRow label="Call ID" value={fallback(selectedBooking.call_id)} />
                    <InfoRow
                      label="Intake method"
                      value={humanizeToken(selectedBooking.intake_method)}
                      tone={getStatusTone("intake", selectedBooking.intake_method)}
                    />
                    <InfoRow
                      label="Form status"
                      value={humanizeToken(selectedBooking.form_status)}
                      tone={getStatusTone("form", selectedBooking.form_status)}
                    />
                    <InfoRow
                      label="Confirmation status"
                      value={humanizeToken(selectedBooking.confirmation_status)}
                      tone={getStatusTone("confirmation", selectedBooking.confirmation_status)}
                    />
                    <InfoRow label="Confirmation channel" value={humanizeToken(selectedBooking.confirmation_channel)} />
                    <InfoRow label="Needs review" value={formatBoolean(selectedBooking.needs_review)} />
                    <InfoRow
                      label="Review reasons"
                      value={selectedBooking.review_reasons.length ? selectedBooking.review_reasons.join(", ") : "--"}
                    />
                    <InfoRow
                      label="Triage flag"
                      value={humanizeToken(selectedBooking.triage_flag)}
                      tone={getStatusTone("triage", selectedBooking.triage_flag)}
                    />
                    <InfoRow label="Transfer initiated" value={formatBoolean(selectedBooking.transfer_initiated)} />
                  </AccordionCard>

                  <AccordionCard title="AI Call Analysis" className="full-width analysis-card" defaultOpen={false}>
                    <div className="tabs">
                      <button
                        type="button"
                        className={`tab-btn ${activeTab === "summary" ? "active" : ""}`}
                        onClick={() => setActiveTab("summary")}
                      >
                        Summary
                      </button>
                      <button
                        type="button"
                        className={`tab-btn ${activeTab === "notes" ? "active" : ""}`}
                        onClick={() => setActiveTab("notes")}
                      >
                        Notes
                      </button>
                    </div>

                    <div className="ai-box">
                      {activeTab === "summary" && <p>{fallback(selectedBooking.call_summary, "No summary available yet.")}</p>}
                      {activeTab === "notes" && <p>{fallback(selectedBooking.notes, "No additional notes.")}</p>}
                    </div>
                  </AccordionCard>

                  <AccordionCard title="Message History" className="full-width" defaultOpen={false}>
                    {relatedMessages.length === 0 ? (
                      <p className="message-empty">No related messages found for this booking yet.</p>
                    ) : (
                      <div className="message-list">
                        {relatedMessages.map((message) => (
                          <div key={message.id} className="message-item">
                            <div className="message-header">
                              <div className="message-header-main">
                                <span className="message-purpose">{humanizeToken(message.purpose, "Message")}</span>
                                <span
                                  className={`status-chip status-chip-${getMessageTone(message.status)}`}
                                >
                                  {humanizeToken(message.status, "Unknown")}
                                </span>
                              </div>
                              <span className="message-time">{formatDateTime(message.created_at)}</span>
                            </div>

                            <div className="message-meta">
                              <span>{humanizeToken(message.channel, "Channel unknown")}</span>
                              <span>{humanizeToken(message.provider, "Provider unknown")}</span>
                              <span>{fallback(message.to_number, "No destination number")}</span>
                            </div>

                            <p className="message-body">{fallback(message.body, "No message body captured.")}</p>

                            {message.error ? (
                              <p className="message-error">Error: {message.error}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </AccordionCard>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function AccordionCard({
  title,
  defaultOpen = false,
  className = "",
  children,
}: {
  title: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`card accordion-card ${className}`}>
      <button 
        type="button" 
        className="accordion-header" 
        onClick={() => setIsOpen(!isOpen)}
      >
        <h3>{title}</h3>
        <svg 
          className={`chevron ${isOpen ? "rotate" : ""}`} 
          width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
      {isOpen && <div className="accordion-content">{children}</div>}
    </div>
  );
}

function InfoRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger" | "warning" | "success" | "info" | "neutral";
}) {
  return (
    <div className="info-row">
      <span className="label">{label}</span>
      <span className="value">
        {tone ? <span className={`status-chip status-chip-${tone}`}>{value}</span> : value}
      </span>
    </div>
  );
}

function matchesQuickFilter(booking: Booking, filter: FilterKey) {
  if (filter === "all") return true;
  if (filter === "needs_review") return booking.needs_review;
  if (filter === "form_pending") {
    return booking.intake_method === "form" && booking.form_status !== "submitted";
  }
  if (filter === "confirmation_pending") {
    return booking.confirmation_status === "pending";
  }
  if (filter === "urgent") {
    return isUrgentTriage(booking.triage_flag);
  }
  return true;
}

function getMessageTone(status: string | null | undefined): "danger" | "warning" | "success" | "info" | "neutral" {
  const normalized = (status ?? "").toLowerCase();

  if (normalized === "sent") return "success";
  if (normalized === "failed") return "danger";
  if (normalized === "pending") return "warning";
  if (normalized) return "info";
  return "neutral";
}
