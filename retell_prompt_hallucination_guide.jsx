import { useState } from "react";

const sections = [
  {
    id: "structure",
    icon: "ti-layout-list",
    label: "Prompt Structure",
    color: "accent",
  },
  {
    id: "llm",
    icon: "ti-adjustments-horizontal",
    label: "LLM Config",
    color: "success",
  },
  {
    id: "guardrails",
    icon: "ti-shield-check",
    label: "Guardrails",
    color: "warning",
  },
  {
    id: "kb",
    icon: "ti-database",
    label: "Knowledge Base",
    color: "pro",
  },
  {
    id: "tools",
    icon: "ti-tool",
    label: "Tool Calling",
    color: "danger",
  },
  {
    id: "checklist",
    icon: "ti-checklist",
    label: "Checklist",
    color: "accent",
  },
];

const pillStyle = (color) => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 11,
  fontWeight: 500,
  padding: "3px 10px",
  borderRadius: 20,
  background: `var(--bg-${color})`,
  color: `var(--text-${color})`,
  border: `0.5px solid var(--border-${color})`,
});

const tagStyle = {
  display: "inline-block",
  fontSize: 11,
  fontWeight: 500,
  padding: "2px 8px",
  borderRadius: 4,
  background: "var(--surface-1)",
  border: "0.5px solid var(--border)",
  color: "var(--text-secondary)",
  fontFamily: "var(--font-mono)",
};

const cardStyle = {
  background: "var(--surface-2)",
  border: "0.5px solid var(--border)",
  borderRadius: 12,
  padding: "1rem 1.25rem",
  marginBottom: 12,
};

const codeBlock = {
  background: "var(--surface-1)",
  border: "0.5px solid var(--border)",
  borderRadius: 8,
  padding: "1rem 1.25rem",
  fontFamily: "var(--font-mono)",
  fontSize: 12.5,
  lineHeight: 1.65,
  color: "var(--text-primary)",
  overflowX: "auto",
  margin: "10px 0",
  whiteSpace: "pre",
};

const ruleRow = ({ icon, label, desc, tag, color = "accent" }) => (
  <div
    style={{
      display: "flex",
      gap: 12,
      padding: "10px 0",
      borderBottom: "0.5px solid var(--border)",
    }}
  >
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        background: `var(--bg-${color})`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <i
        className={`ti ${icon}`}
        style={{ fontSize: 16, color: `var(--text-${color})` }}
        aria-hidden="true"
      />
    </div>
    <div style={{ flex: 1 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 2,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 500 }}>{label}</span>
        {tag && <span style={tagStyle}>{tag}</span>}
      </div>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
        {desc}
      </p>
    </div>
  </div>
);

function StructureSection() {
  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 0 }}>
        Retell's official docs confirm: sectioned prompts with markdown headers
        are the single biggest structural improvement you can make. LLMs process
        structured sections more accurately than prose blobs.
      </p>

      <div style={{ ...cardStyle, borderLeft: "3px solid var(--border-accent)" }}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "var(--text-accent)",
            margin: "0 0 8px",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Official Retell recommended structure
        </p>
        <pre style={codeBlock}>{`## Identity
You are Layla, an AI receptionist for [Clinic Name].
Your role is to book appointments for patients.
You have expertise in scheduling and clinic procedures.

## Style Guardrails
Be concise: Keep responses under 2 sentences unless necessary.
Be conversational: Use natural language and contractions.
Be empathetic: Acknowledge the patient's situation warmly.

## Response Guidelines
Return dates in spoken form: Say "July ninth" not "7/9".
Ask one question at a time: Never stack multiple questions.
Confirm understanding: Repeat key details back to the caller.

## Task Instructions
[step-by-step flow here]

## Tool Usage Instructions
[explicit trigger conditions here]

## Boundaries
[what the agent must never say or do]

## Objection Handling
[specific scripts for known edge cases]`}</pre>
      </div>

      <h3 style={{ fontSize: 15, fontWeight: 500, marginTop: 20 }}>
        Section-by-section rules
      </h3>

      {ruleRow({
        icon: "ti-id",
        label: "## Identity",
        desc: "Name, role, clinic name, what expertise it has. Keep to 3-4 lines. Never mention it's an AI unless legally required.",
        tag: "required",
        color: "accent",
      })}
      {ruleRow({
        icon: "ti-palette",
        label: "## Style Guardrails",
        desc: "Tone, response length, speaking style. 'Be concise', 'Be empathetic', 'Speak dates as words'. This section directly controls naturalness.",
        tag: "required",
        color: "accent",
      })}
      {ruleRow({
        icon: "ti-list-check",
        label: "## Task Instructions",
        desc: "Numbered step-by-step flow. Each step is one action. Use arrows (→) for conditional branches. Never write prose paragraphs here.",
        tag: "required",
        color: "accent",
      })}
      {ruleRow({
        icon: "ti-tool",
        label: "## Tool Usage Instructions",
        desc: "Explicit trigger words for every function. Reference functions by exact name. Define what NOT to call and when.",
        tag: "required",
        color: "accent",
      })}
      {ruleRow({
        icon: "ti-ban",
        label: "## Boundaries",
        desc: "Hard rules: never diagnose, never quote prices unless confirmed, never promise timelines. These prevent the most dangerous hallucinations.",
        tag: "required",
        color: "danger",
      })}
      {ruleRow({
        icon: "ti-message-exclamation",
        label: "## Objection Handling",
        desc: "Exact scripts for known edge cases. 'If patient says X → say Y'. Prevents the agent from improvising in high-stakes moments.",
        tag: "recommended",
        color: "warning",
      })}

      <div
        style={{
          ...cardStyle,
          background: "var(--bg-warning)",
          border: "0.5px solid var(--border-warning)",
          marginTop: 16,
        }}
      >
        <p
          style={{
            fontSize: 13,
            color: "var(--text-warning)",
            margin: 0,
            fontWeight: 500,
          }}
        >
          <i
            className="ti ti-alert-triangle"
            style={{ marginRight: 6 }}
            aria-hidden="true"
          />
          Prompt length warning
        </p>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "6px 0 0" }}>
          Retell billing is base rate up to ~3,500 tokens. Beyond that, costs
          scale proportionally and latency grows linearly. Target under 5,000
          tokens active at any time. Long single-prompt agents are "prompt
          spaghetti" — use Conversation Flow instead for complex agents.
        </p>
      </div>
    </div>
  );
}

function LLMSection() {
  const [temp, setTemp] = useState(0.2);

  const getLabel = (t) => {
    if (t <= 0.3) return { label: "Deterministic", color: "success" };
    if (t <= 0.6) return { label: "Balanced", color: "accent" };
    if (t <= 0.8) return { label: "Creative", color: "warning" };
    return { label: "High variance", color: "danger" };
  };

  const getRec = (t) => {
    if (t <= 0.3) return "Appointment booking, data capture, HIPAA flows";
    if (t <= 0.5) return "General customer support, clinic reception";
    if (t <= 0.7) return "Sales outreach, casual support";
    return "Not recommended for production clinic agents";
  };

  const { label, color } = getLabel(temp);

  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 0 }}>
        LLM configuration is where most teams leave the biggest hallucination
        gap. Retell's docs give exact temperature ranges by use case, and
        Structured Output is a separate must-have for function reliability.
      </p>

      <div style={cardStyle}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "var(--text-secondary)",
            margin: "0 0 12px",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Temperature simulator
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={temp}
            onChange={(e) => setTemp(parseFloat(e.target.value))}
            style={{ flex: 1 }}
          />
          <span
            style={{ fontWeight: 500, fontFamily: "var(--font-mono)", minWidth: 32 }}
          >
            {temp.toFixed(2)}
          </span>
          <span style={pillStyle(color)}>{label}</span>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
          <strong>Best for:</strong> {getRec(temp)}
        </p>
      </div>

      <h3 style={{ fontSize: 15, fontWeight: 500 }}>Retell official ranges</h3>
      {[
        { range: "0.1 – 0.3", use: "Appointment booking, data capture", tag: "Layla / Vera", color: "success" },
        { range: "0.3 – 0.5", use: "Customer support, clinic reception", tag: "General", color: "accent" },
        { range: "0.5 – 0.7", use: "Sales outreach", tag: "Outbound", color: "warning" },
        { range: "0.7 – 0.9", use: "Virtual companion, casual chat", tag: "Not for clinic", color: "danger" },
      ].map((row) => (
        <div
          key={row.range}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "9px 0",
            borderBottom: "0.5px solid var(--border)",
          }}
        >
          <span
            style={{
              ...tagStyle,
              background: `var(--bg-${row.color})`,
              color: `var(--text-${row.color})`,
              border: `0.5px solid var(--border-${row.color})`,
              minWidth: 80,
              textAlign: "center",
            }}
          >
            {row.range}
          </span>
          <span style={{ fontSize: 13, flex: 1 }}>{row.use}</span>
          <span style={pillStyle(row.color)}>{row.tag}</span>
        </div>
      ))}

      <h3 style={{ fontSize: 15, fontWeight: 500, marginTop: 20 }}>
        Other critical LLM settings
      </h3>

      {ruleRow({
        icon: "ti-checkup-list",
        label: "Structured Output",
        desc: "Enable for any agent with critical function calls (booking, insurance lookup). Eliminates missing/malformed function arguments. Required for Layla and Vera.",
        tag: "enable",
        color: "success",
      })}
      {ruleRow({
        icon: "ti-rocket",
        label: "Fast Tier",
        desc: "1.5× cost but gives 50% reduction in latency variance and 25% better average response time. Worth enabling for patient-facing production agents.",
        tag: "recommended",
        color: "accent",
      })}
      {ruleRow({
        icon: "ti-repeat",
        label: "Retries & Timeouts",
        desc: "Set sensible retry counts for function calls. A failed tool call that goes unretried is a hallucination waiting to happen — the agent will improvise.",
        tag: "configure",
        color: "warning",
      })}
    </div>
  );
}

function GuardrailsSection() {
  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 0 }}>
        Guardrails are the most underbuilt layer in clinic voice AI. Retell
        recently shipped native Agent Guardrails — but prompt-level boundaries
        are still your first and most important line of defense.
      </p>

      <div style={{ ...cardStyle, borderLeft: "3px solid var(--border-danger)" }}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "var(--text-danger)",
            margin: "0 0 8px",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          The three hallucination types in clinic voice AI
        </p>
        {[
          {
            type: "Confabulated facts",
            example: '"We have a branch in Lahore" — when you don\'t',
            risk: "Patient acts on false info",
          },
          {
            type: "Workflow deviation",
            example: "Skips insurance check, invents approval step",
            risk: "HIPAA / compliance breach",
          },
          {
            type: "Commitment drift",
            example: '"You\'re confirmed for 3pm" — before booking ran',
            risk: "Unauthorized binding commitment",
          },
        ].map((row) => (
          <div
            key={row.type}
            style={{
              padding: "8px 0",
              borderBottom: "0.5px solid var(--border)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 8,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500 }}>{row.type}</span>
              <span style={pillStyle("danger")}>risk</span>
            </div>
            <p
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                margin: "3px 0 0",
                fontFamily: "var(--font-mono)",
              }}
            >
              {row.example}
            </p>
            <p
              style={{ fontSize: 12, color: "var(--text-danger)", margin: "2px 0 0" }}
            >
              → {row.risk}
            </p>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 15, fontWeight: 500, marginTop: 16 }}>
        Prompt-level guardrail patterns
      </h3>

      <div style={cardStyle}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 500,
            margin: "0 0 8px",
            color: "var(--text-accent)",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          ## Boundaries section template
        </p>
        <pre style={codeBlock}>{`## Boundaries
NEVER diagnose or suggest medical conditions.
NEVER quote prices unless retrieved from the system.
NEVER confirm an appointment before book_appointment runs successfully.
NEVER promise callback times ("within the hour").
NEVER say the clinic has services, staff, or locations not in your knowledge base.

If you don't have the answer: say "I don't have that information —
let me transfer you to the front desk." Then call transfer_to_human.`}</pre>
      </div>

      <div style={cardStyle}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 500,
            margin: "0 0 8px",
            color: "var(--text-success)",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Abstention as a success state
        </p>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
          Engineer "I don't know" explicitly into the prompt. The LLM should
          treat uncertainty disclosure as success, not failure. Without this
          line, the model reaches into training data when retrieval returns
          empty — exactly how hallucinations originate.
        </p>
        <pre style={{ ...codeBlock, marginTop: 10 }}>{`If the information is not in your knowledge base:
Say: "I don't have that information right now."
Then: offer to transfer or take a message.
NEVER guess or infer.`}</pre>
      </div>

      <h3 style={{ fontSize: 15, fontWeight: 500 }}>Native Retell guardrails</h3>
      {ruleRow({
        icon: "ti-shield-lock",
        label: "Agent Guardrails (native)",
        desc: "Retell's built-in guardrails block jailbreaks, prompt extraction, unauthorized tool calls, and harmful outputs. Enable in dashboard — this is separate from your prompt.",
        tag: "dashboard setting",
        color: "success",
      })}
      {ruleRow({
        icon: "ti-git-branch",
        label: "Conversation Flow for critical paths",
        desc: "For insurance verification (Vera), booking confirmation (Layla) — use Conversation Flow nodes. Node-based structure enforces step completion before advancement, reducing hallucination rate versus pure generative conversation.",
        tag: "architectural",
        color: "accent",
      })}
    </div>
  );
}

function KBSection() {
  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 0 }}>
        KB health is the single biggest predictor of hallucination rate — more
        than model choice. A retrieval system that always returns something is a
        hallucination machine. Here's the full architecture from Retell's own
        production guide.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10,
          marginBottom: 16,
        }}
      >
        {[
          { label: "Chunk size", value: "512 tokens", sub: "with 10–15% overlap", color: "accent" },
          { label: "Similarity threshold", value: "0.65+", sub: "raise to 0.70 for HIPAA", color: "success" },
          { label: "Chunks to retrieve", value: "3–5", sub: "never exceed 5 for voice", color: "warning" },
          { label: "Auto-refresh", value: "24 hrs", sub: "for URL sources", color: "pro" },
        ].map((m) => (
          <div
            key={m.label}
            style={{
              background: "var(--surface-1)",
              borderRadius: 8,
              padding: "0.75rem 1rem",
              borderLeft: `3px solid var(--border-${m.color})`,
            }}
          >
            <p
              style={{
                fontSize: 11,
                color: "var(--text-secondary)",
                margin: "0 0 4px",
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}
            >
              {m.label}
            </p>
            <p
              style={{
                fontSize: 20,
                fontWeight: 500,
                margin: "0 0 2px",
                color: `var(--text-${m.color})`,
              }}
            >
              {m.value}
            </p>
            <p
              style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}
            >
              {m.sub}
            </p>
          </div>
        ))}
      </div>

      {ruleRow({
        icon: "ti-file-text",
        label: "Format: structured markdown",
        desc: "One H1 per document, one H2 per resolvable question. Replace all 'click here' or 'as above' references — each chunk is retrieved alone and must make sense alone.",
        tag: "required",
        color: "accent",
      })}
      {ruleRow({
        icon: "ti-tag",
        label: "Tag every chunk with metadata",
        desc: "At minimum: product, version, region, audience, last_verified_date. Prevents wrong-region content from bleeding into calls (e.g. wrong insurance rules per state).",
        tag: "required",
        color: "accent",
      })}
      {ruleRow({
        icon: "ti-table-off",
        label: "Rewrite tables as prose",
        desc: "Chunking pipelines can't preserve table spatial relationships. A cell retrieved without its column header is raw hallucination fuel. 'The Pro plan supports 50 users and includes API access' beats a table cell.",
        tag: "important",
        color: "warning",
      })}
      {ruleRow({
        icon: "ti-circle-x",
        label: "Add refusal instruction",
        desc: `Add to prompt: "Only answer using ## Related Knowledge Base Contexts. If missing or irrelevant, say there is no related information and offer to transfer." This single line is the most effective anti-hallucination control.`,
        tag: "critical",
        color: "danger",
      })}
      {ruleRow({
        icon: "ti-refresh",
        label: "Keep KB current",
        desc: "Stale knowledge is hallucination's quiet partner. Enable auto-refresh on URL sources. Assign a named owner with a quarterly review schedule. A KB that worked at launch drifts as policies change.",
        tag: "operational",
        color: "success",
      })}

      <div
        style={{
          ...cardStyle,
          background: "var(--bg-danger)",
          border: "0.5px solid var(--border-danger)",
          marginTop: 16,
        }}
      >
        <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-danger)", margin: "0 0 6px" }}>
          <i className="ti ti-alert-circle" style={{ marginRight: 6 }} aria-hidden="true" />
          Don't put agent behavior instructions in the KB
        </p>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
          KB is for factual content, not behavioral instructions. If you upload
          "How the agent should behave when X happens" to the KB, the retriever
          will rank those instructions against factual queries and pull them at
          wrong moments. Behavior goes in the prompt; facts go in the KB.
        </p>
      </div>
    </div>
  );
}

function ToolSection() {
  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 0 }}>
        LLMs struggle to determine when to call tools based on descriptions
        alone. Without explicit trigger conditions, Layla will skip
        book_appointment or call it at the wrong time. These patterns are
        directly from Retell's official prompt guide.
      </p>

      <div style={cardStyle}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 500,
            margin: "0 0 8px",
            color: "var(--text-accent)",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Explicit tool trigger template (Layla)
        </p>
        <pre style={codeBlock}>{`## Tool Usage Instructions

1. Gather: patient name, preferred date, reason for visit.

2. Determine request type:
   - Patient mentions "book", "schedule", "appointment":
     → Call \`check_availability\` with date and provider
   - Patient confirms a slot:
     → Call \`book_appointment\` with all collected fields
   - Patient asks about insurance:
     → Call \`get_insurance_info\` — do NOT improvise coverage details
   - Patient wants to cancel/reschedule:
     → Call \`cancel_appointment\` first, then re-run booking flow

3. After tool runs:
   - Summarize the result back to the patient
   - Only confirm appointment AFTER book_appointment returns success
   - If tool fails, say: "I'm having trouble with that — let me connect you
     to our front desk." Then call \`transfer_to_human\`.

4. NEVER call book_appointment without all required fields.
4. NEVER tell the patient they're confirmed before the tool succeeds.`}</pre>
      </div>

      <h3 style={{ fontSize: 15, fontWeight: 500 }}>Tool calling rules</h3>

      {ruleRow({
        icon: "ti-key",
        label: "Use exact function names",
        desc: "Reference every tool by its exact camelCase/snake_case name in the prompt. LLMs match against string literals — a mismatch causes silent non-calls.",
        tag: "syntax",
        color: "accent",
      })}
      {ruleRow({
        icon: "ti-list-numbers",
        label: "Define trigger words explicitly",
        desc: "List the exact words/phrases that fire each tool. Don't rely on the LLM to infer. 'If patient says book, schedule, or appointment → call check_availability.'",
        tag: "required",
        color: "accent",
      })}
      {ruleRow({
        icon: "ti-arrow-right-bar",
        label: "Define sequences for multi-step flows",
        desc: "Vera's VOB flow: call get_insurance first → then verify_benefits → then update_booking. Explicit sequences prevent the agent from skipping steps.",
        tag: "required for Vera",
        color: "success",
      })}
      {ruleRow({
        icon: "ti-lock",
        label: "Gate confirmations on tool success",
        desc: "The most common commitment-drift hallucination: agent says 'You're confirmed!' before the booking API returns. Explicitly write: only confirm AFTER tool returns success.",
        tag: "critical",
        color: "danger",
      })}
      {ruleRow({
        icon: "ti-ban",
        label: "Enable Structured Output for critical calls",
        desc: "In LLM Options, enable Structured Output for any agent doing booking or insurance. This enforces valid function arguments — eliminates malformed calls entirely.",
        tag: "dashboard",
        color: "warning",
      })}

      <div style={{ ...cardStyle, marginTop: 16 }}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 500,
            margin: "0 0 8px",
            color: "var(--text-pro)",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Vera-specific pattern (outbound insurance)
        </p>
        <pre style={codeBlock}>{`## Tool Usage Instructions (Vera)

When connected to insurance representative:
1. Call \`verify_benefits\` with member_id and plan_id
2. While waiting: say "Just a moment while I pull that up..."
3. After result:
   - If verified: Call \`update_booking_vob\` then confirm to rep
   - If denied: Call \`flag_for_review\` — do NOT improvise coverage decisions
   - If on hold: Wait silently — do NOT call any tools
4. NEVER guess coverage amounts or policy details.
5. NEVER make commitments on behalf of the clinic.`}</pre>
      </div>
    </div>
  );
}

const checklistItems = [
  { group: "Prompt Structure", color: "accent", items: [
    "Prompt uses ## markdown headers for every section",
    "## Identity: name, role, clinic, expertise (≤4 lines)",
    "## Style Guardrails: concise, conversational, empathetic",
    "## Task Instructions: numbered steps with → branches",
    "## Tool Usage Instructions: explicit trigger words per tool",
    "## Boundaries: explicit NEVER statements",
    "## Objection Handling: scripted responses for edge cases",
    "Prompt is under 5,000 tokens total",
  ]},
  { group: "LLM Configuration", color: "success", items: [
    "Temperature set to 0.1–0.3 for appointment booking",
    "Temperature set to 0.3–0.5 for general reception",
    "Structured Output enabled for booking/insurance agents",
    "Fast Tier enabled for patient-facing production agents",
    "Retry count configured for tool call failures",
  ]},
  { group: "Guardrails", color: "danger", items: [
    "Native Agent Guardrails enabled in dashboard",
    "NEVER statements cover: diagnose, quote prices, confirm before tool",
    "Abstention instruction: 'if not in KB, say I don't know + transfer'",
    "Transfer fallback defined for all failure paths",
    "Conversation Flow used for critical booking/VOB paths",
  ]},
  { group: "Knowledge Base", color: "pro", items: [
    "All documents formatted as structured markdown",
    "Similarity threshold set to 0.65+ (0.70 for HIPAA)",
    "Chunks to retrieve: 3–5 max",
    "Refusal instruction added to agent prompt",
    "Tables rewritten as prose",
    "Auto-refresh enabled on URL sources",
    "Named KB owner assigned with quarterly review",
    "Behavior instructions removed from KB",
  ]},
  { group: "Tool Calling", color: "warning", items: [
    "All tools referenced by exact function name in prompt",
    "Trigger words listed explicitly for each tool",
    "Multi-step sequences defined (especially Vera VOB flow)",
    "Confirmations gated: only after tool returns success",
    "Failure paths defined: what to say + which tool to call",
  ]},
];

function ChecklistSection() {
  const [checked, setChecked] = useState({});
  const total = checklistItems.reduce((a, g) => a + g.items.length, 0);
  const done = Object.values(checked).filter(Boolean).length;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0 }}>
          Pre-launch anti-hallucination checklist for Layla and Vera
        </p>
        <span style={pillStyle(done === total ? "success" : "accent")}>
          {done} / {total} done
        </span>
      </div>

      <div
        style={{
          height: 4,
          background: "var(--surface-1)",
          borderRadius: 4,
          marginBottom: 20,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${(done / total) * 100}%`,
            background: done === total ? "var(--fill-success)" : "var(--fill-accent)",
            borderRadius: 4,
            transition: "width 0.2s ease",
          }}
        />
      </div>

      {checklistItems.map((group) => (
        <div key={group.group} style={{ marginBottom: 16 }}>
          <p
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: `var(--text-${group.color})`,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              margin: "0 0 8px",
            }}
          >
            {group.group}
          </p>
          {group.items.map((item, i) => {
            const key = `${group.group}-${i}`;
            const isChecked = !!checked[key];
            return (
              <div
                key={key}
                onClick={() =>
                  setChecked((c) => ({ ...c, [key]: !c[key] }))
                }
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "7px 10px",
                  borderRadius: 6,
                  cursor: "pointer",
                  marginBottom: 2,
                  background: isChecked ? "var(--bg-success)" : "transparent",
                  transition: "background 0.15s ease",
                }}
              >
                <i
                  className={
                    isChecked
                      ? "ti ti-square-check-filled"
                      : "ti ti-square"
                  }
                  style={{
                    fontSize: 16,
                    flexShrink: 0,
                    marginTop: 1,
                    color: isChecked
                      ? "var(--text-success)"
                      : "var(--text-muted)",
                  }}
                  aria-hidden="true"
                />
                <span
                  style={{
                    fontSize: 13,
                    color: isChecked
                      ? "var(--text-success)"
                      : "var(--text-primary)",
                    textDecoration: isChecked ? "line-through" : "none",
                  }}
                >
                  {item}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [active, setActive] = useState("structure");

  const renderSection = () => {
    switch (active) {
      case "structure": return <StructureSection />;
      case "llm": return <LLMSection />;
      case "guardrails": return <GuardrailsSection />;
      case "kb": return <KBSection />;
      case "tools": return <ToolSection />;
      case "checklist": return <ChecklistSection />;
      default: return null;
    }
  };

  return (
    <div style={{ paddingTop: "1rem" }}>
      <h2 className="sr-only">Retell AI anti-hallucination guide for voice agents</h2>

      <div style={{ marginBottom: 20 }}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "var(--text-muted)",
            margin: "0 0 4px",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Research — Retell AI Docs · Production Case Studies · 2025–2026
        </p>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 500,
            margin: "0 0 6px",
          }}
        >
          Making Retell agents follow prompts exactly
        </h1>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0 }}>
          Every layer from prompt structure to KB retrieval — no hallucinations,
          no improvisation.
        </p>
      </div>

      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          marginBottom: 20,
          padding: "10px",
          background: "var(--surface-1)",
          borderRadius: 10,
          border: "0.5px solid var(--border)",
        }}
      >
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: 6,
              border: active === s.id
                ? `0.5px solid var(--border-${s.color})`
                : "0.5px solid transparent",
              background: active === s.id
                ? `var(--bg-${s.color})`
                : "transparent",
              color: active === s.id
                ? `var(--text-${s.color})`
                : "var(--text-secondary)",
              fontSize: 13,
              fontWeight: active === s.id ? 500 : 400,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <i className={`ti ${s.icon}`} style={{ fontSize: 14 }} aria-hidden="true" />
            {s.label}
          </button>
        ))}
      </div>

      <div>{renderSection()}</div>
    </div>
  );
}
