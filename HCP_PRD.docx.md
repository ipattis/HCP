  
PRODUCT REQUIREMENTS DOCUMENT

**Human Coordination Plane (HCP)**

*Infrastructure for Human-Agent Collaboration in Autonomous Systems*

| Version | 0.1 — Draft |
| :---- | :---- |
| **Status** | For Review |
| **Date** | February 2026 |
| **Author** | AI Platform Team |
| **Audience** | Engineering, Product, AI Safety |

# **1\. Executive Summary**

As autonomous agentic systems take on longer-horizon tasks — spanning hours, days, and complex multi-step workflows — a critical infrastructure gap has emerged: there is no standardised, reliable mechanism for agents to coordinate with the humans who are ultimately responsible for their actions.

The Human Coordination Plane (HCP) is that infrastructure. It is a dedicated runtime layer, orthogonal to agent orchestration and execution, that manages every interaction where an autonomous system needs to involve a human: to seek approval, surface ambiguity, request clarification, escalate risk, or hand off control.

The HCP treats human attention as a scarce, high-value resource. It packages context intelligently, routes requests to the right people at the right time, and maintains a verifiable audit trail of every human decision. Agents express their coordination needs through a simple, declarative API; the HCP handles everything else.

| Problem in One Sentence |
| :---- |
| Autonomous agents frequently reach decision points that require human judgment, but today there is no shared infrastructure to reliably surface those moments, capture decisions, and feed them back — leading to stuck pipelines, silent failures, and unacceptable risk. |

# **2\. Background & Motivation**

## **2.1  The Rise of Long-Horizon Agents**

Modern LLM-based agents are increasingly trusted to execute multi-step plans: browsing the web, writing and running code, managing files, calling external APIs, and communicating on behalf of users. The operational surface area of a single agent run can span dozens of discrete actions over an extended period.

This creates a fundamental tension: the more autonomous we make agents, the more critical it becomes to maintain meaningful human oversight — particularly at high-stakes or high-uncertainty moments.

## **2.2  The Missing Layer**

Current agentic architectures include an LLM layer (reasoning), a tool layer (execution), and an orchestration layer (agent-to-agent coordination). What they lack is a first-class human coordination layer — one that is:

* Asynchronous by design — humans are not always available in real time

* Context-rich — humans need enough information to make a good decision quickly

* Auditable — every human decision must be logged and attributable

* Composable — any agent or workflow should be able to invoke it without bespoke integration

* Safe-by-default — if human coordination fails or times out, the system degrades safely

## **2.3  Existing Approaches and Their Limits**

| Approach | Limitation |
| :---- | :---- |
| Ad-hoc callbacks in agent code | Non-standard, brittle, no audit trail, hard to monitor across agents |
| Email / Slack notifications | No structured context, no machine-readable response, no SLA enforcement |
| Synchronous human-in-the-loop pauses | Blocks agent execution; doesn't scale to async, long-running workflows |
| Hardcoded approval gates in pipelines | Inflexible; cannot adapt to runtime context or dynamic risk level |
| No escalation — agent halts and errors out | Silent failure; humans unaware of why or when agent stopped |

# **3\. Goals and Non-Goals**

## **3.1  Goals**

* Provide a single, reliable surface for agents to request human input, approval, or escalation

* Enable asynchronous human response with configurable timeout policies and fallback behaviours

* Package sufficient context automatically so humans can make decisions without needing to re-investigate agent state

* Route coordination requests to the correct human(s) based on policy, role, availability, and urgency

* Maintain a complete, tamper-evident audit log of every human-agent interaction

* Expose a composable API that any agent framework (LangChain, LlamaIndex, custom, etc.) can integrate with minimal effort

* Support risk-tiered workflows: low-risk requests auto-approve; high-risk requests require multi-party sign-off

* Degrade gracefully — when humans are unavailable, agents receive clear, policy-driven guidance on how to proceed

## **3.2  Non-Goals**

* HCP is not an agent orchestration framework — it does not manage agent-to-agent coordination

* HCP is not an observability platform — it complements but does not replace tools like Langfuse, Datadog, or similar

* HCP is not a general task management system — it handles only human interactions that originate from autonomous agents

* HCP does not make decisions on behalf of humans — it facilitates and records human decisions, never substitutes for them

* HCP does not enforce what agents do after receiving a human response — that remains the agent's responsibility

# **4\. User Personas**

## **4.1  The Agent (Primary Invoker)**

An autonomous agent or orchestrated workflow that needs human input at runtime. The agent treats HCP as a service: it submits a coordination request and later receives a structured response. The agent does not need to know who the human is or how they were reached.

## **4.2  The Responder (Human Decision Maker)**

A human who receives a coordination request and must act on it. This could be an end user, a domain expert, a manager, or an AI safety reviewer. Responders interact through a lightweight, context-rich interface — they should be able to make a good decision in under two minutes without needing additional context.

## **4.3  The Coordinator (Human Workflow Designer)**

A platform engineer or product team member who configures routing policies, approval rules, timeout behaviours, and notification templates. Coordinators define what kinds of requests go to whom, under what conditions, and with what SLAs.

## **4.4  The Auditor**

A compliance, safety, or governance stakeholder who reviews decision logs. Auditors need a complete, queryable record of what was requested, who decided, what was decided, and when — without being involved in real-time decisions.

# **5\. Core Concepts & Mental Model**

## **5.1  The Coordination Request**

The fundamental unit of the HCP is a Coordination Request (CR). A CR is a structured payload submitted by an agent that contains everything needed for a human to make a decision. It is immutable once submitted.

| Field | Type | Description |
| :---- | :---- | :---- |
| request\_id | UUID | Unique identifier, generated by HCP |
| agent\_id | string | Identity of the submitting agent or pipeline |
| intent | enum | Type of coordination needed (see 5.2) |
| urgency | enum | low | medium | high | critical |
| context\_package | object | Structured context for the human (see 5.3) |
| response\_schema | JSON Schema | Expected shape of the human response |
| timeout\_policy | object | What happens if no response arrives in time |
| routing\_hints | object | Optional hints to assist routing (role, team, user) |
| trace\_id | string | Links back to the originating agent run / trace |
| submitted\_at | ISO 8601 | Timestamp of submission |

## **5.2  Coordination Intent Types**

The intent field drives routing, SLA, and UI rendering. Initial supported intents:

| Intent | Description |
| :---- | :---- |
| APPROVAL\_REQUIRED | Agent needs explicit go/no-go before proceeding with a consequential action |
| CLARIFICATION\_NEEDED | Agent has encountered ambiguity it cannot resolve autonomously |
| INFORMATION\_REQUEST | Agent needs a piece of information only a human can supply |
| RISK\_ESCALATION | Agent has detected a situation that exceeds its authorised risk threshold |
| TASK\_HANDOFF | Agent is handing a task back to a human for completion or continuation |
| ANOMALY\_REPORT | Agent has observed something unexpected; human review recommended |
| COMPLETION\_NOTIFICATION | Informational — agent completed a task and human should be aware |

## **5.3  The Context Package**

A well-formed context package is what separates HCP from a generic notification system. The context package is automatically assembled by the HCP SDK from the agent's runtime state and contains:

* Summary: a one-paragraph natural language summary of the situation, generated by the agent or HCP

* Decision required: a clear, specific statement of what the human needs to decide or provide

* Options (if applicable): structured list of available choices with agent-assessed implications

* Evidence: relevant excerpts from agent memory, tool outputs, or retrieved documents

* Risk assessment: agent's estimate of risk level and confidence, with reasoning

* Trace link: deep link to the full agent run in the observability platform

* Prior context: summary of any previous CRs in the same workflow

## **5.4  Response Schema and Structured Responses**

Agents declare the expected response schema at submission time. HCP enforces schema validation before returning a response to the agent. This ensures agent code can rely on typed, structured input rather than parsing free-form human text. Examples:

* Binary approval: { approved: boolean, reason?: string }

* Choice selection: { selected\_option: string, notes?: string }

* Free-form input: { value: string, confidence?: 'high' | 'low' }

* Multi-field form: arbitrary JSON Schema — HCP renders an appropriate UI

## **5.5  Timeout Policy and Fallback Behaviours**

Because agents operate asynchronously and humans may be unavailable, every CR must declare a timeout policy. This consists of a timeout duration and a fallback behaviour, chosen from:

| Fallback Behaviour | Description |
| :---- | :---- |
| ESCALATE | Re-route to the next human in the escalation chain |
| AUTO\_APPROVE | Proceed as if approved — only valid for low-risk intents |
| AUTO\_REJECT | Proceed as if rejected — conservative safe default |
| SUSPEND\_AGENT | Pause the agent run until a human responds or an admin intervenes |
| ABORT\_WITH\_REASON | Terminate the agent run and notify the originating user |
| CUSTOM\_CALLBACK | Invoke a developer-supplied function with the timed-out CR |

# **6\. System Architecture**

## **6.1  Layered Architecture Overview**

The HCP is composed of five layers. Each layer has a single responsibility and exposes a clean interface to adjacent layers.

| Layer 5 | Agent SDK / Client Libraries |
| :---- | :---- |
| **Layer 4** | HCP Gateway — intake, validation, authentication, rate limiting |
| **Layer 3** | Coordination Engine — routing, SLA tracking, escalation, state machine |
| **Layer 2** | Responder Interface — notification delivery, response capture, context rendering |
| **Layer 1** | Audit & Storage — immutable log, queryable store, trace linkage |

## **6.2  Request Lifecycle**

A Coordination Request moves through the following state machine from the moment it is submitted to the moment the agent receives a response:

| State | Description |
| :---- | :---- |
| SUBMITTED | CR received and validated by the HCP Gateway |
| ROUTING | Coordination Engine selecting the appropriate responder(s) |
| PENDING\_RESPONSE | Notification delivered; waiting for human response |
| ESCALATED | Timeout triggered; CR re-routed to escalation chain |
| RESPONDED | Human response received and schema-validated |
| DELIVERED | Response returned to the agent via callback or polling |
| TIMED\_OUT | All escalation levels exhausted; fallback behaviour executed |
| CANCELLED | Agent or admin cancelled the CR before response |

## **6.3  Key Components**

### **HCP Gateway**

Single ingress point for all CRs. Responsibilities: authentication (API key / JWT), schema validation against the declared response schema, rate limiting per agent, idempotency key enforcement, and initial persistence to the audit store.

### **Coordination Engine**

The stateful core of HCP. Maintains the CR state machine, evaluates routing policies to select responders, manages SLA timers, triggers escalation chains, and executes fallback behaviours. Designed to be horizontally scalable with distributed locking for state transitions.

### **Routing Policy Engine**

Evaluates declarative routing rules against CR metadata (intent, urgency, agent\_id, tags, time of day) to select one or more responders. Policies are defined by Coordinators and support: role-based routing, round-robin, load balancing across a pool, always-on escalation chains, and skill-based routing for domain-specific decisions.

### **Responder Interface Layer**

Handles the last-mile delivery to humans and the capture of their responses. Pluggable notification channels (email, Slack, Teams, SMS, in-app). Each channel renders the context package in a format optimised for that medium. Response capture is channel-native: a form embedded in an email, a slash-command in Slack, a button in Teams.

### **Audit Store**

An append-only, time-series store of all CR events. Every state transition is recorded with a timestamp, actor, and payload. Exposes a query API for audit and compliance use cases. Integrates with observability platforms (Langfuse, Datadog, OpenTelemetry) via trace\_id propagation.

# **7\. Developer-Facing API**

## **7.1  Agent SDK (Primary Interface)**

The SDK abstracts the HTTP API into idiomatic, language-native calls. The primary method is coordinate(), which submits a CR and awaits a response:

| SDK Example — Python |
| :---- |
| from hcp import HCPClient, Intent, Urgency, FallbackBehaviour |
|  |
| hcp \= HCPClient(api\_key='...') |
|  |
| response \= await hcp.coordinate( |
|     intent=Intent.APPROVAL\_REQUIRED, |
|     urgency=Urgency.HIGH, |
|     summary='Agent is about to send an email to 1,200 customers.', |
|     decision\_required='Approve or reject this bulk send.', |
|     options=\[ |
|         {'id': 'approve', 'label': 'Send now'}, |
|         {'id': 'reject',  'label': 'Do not send'}, |
|     \], |
|     response\_schema={'type': 'object', 'required': \['approved'\]}, |
|     timeout=timedelta(hours=2), |
|     fallback=FallbackBehaviour.AUTO\_REJECT, |
|     trace\_id=current\_trace\_id(), |
| ) |
|  |
| if response.data\['approved'\]: |
|     await send\_emails() |

## **7.2  REST API Endpoints**

| Endpoint | Description |
| :---- | :---- |
| POST /v1/requests | Submit a new Coordination Request |
| GET /v1/requests/{id} | Poll for the status and response of a CR |
| DELETE /v1/requests/{id} | Cancel a pending CR |
| GET /v1/requests | List CRs with filters (agent\_id, status, date range) |
| POST /v1/requests/{id}/respond | Submit a human response (used by Responder Interface) |
| GET /v1/policies | List routing and escalation policies |
| PUT /v1/policies/{id} | Update a policy (Coordinator only) |
| GET /v1/audit | Query the audit log (Auditor role required) |

## **7.3  Webhooks and Event Streaming**

Agents may register a webhook URL to receive CR lifecycle events asynchronously, eliminating the need to poll. Events are delivered as signed HTTP POST payloads. Supported events include: request.submitted, request.escalated, request.responded, request.timed\_out, request.cancelled. HCP also exposes a server-sent events (SSE) endpoint for real-time consumption in agent runtimes that support streaming.

# **8\. Responder Experience**

## **8.1  Design Principles for the Responder Interface**

* Time-to-decision under 90 seconds for well-formed CRs in most intents

* Zero new UI to learn — responses happen inline within existing channels

* Every required piece of context is present; no need to investigate elsewhere

* Response is captured in a structured, schema-validated form — not free text

* The interface communicates stakes clearly — urgency, risk level, and consequences are visible

## **8.2  Channel Adaptors**

HCP ships first-class adaptors for the following channels, each rendering the context package appropriately for the medium:

| Channel | Response Mechanism |
| :---- | :---- |
| Email | Rich HTML email with embedded approve/reject/escalate buttons and a form link for complex responses |
| Slack | Block Kit message with action buttons; modal form for multi-field responses |
| Microsoft Teams | Adaptive Card with inline action buttons |
| In-app (HCP Portal) | Full-featured web UI showing complete context package and response form |
| SMS | Plain-text summary with numeric reply codes for binary decisions |
| Webhook (custom) | Raw JSON payload delivered to a developer-supplied endpoint |

## **8.3  The HCP Portal**

For Responders who prefer a centralised view, or for complex multi-field responses, HCP provides a lightweight web portal. The portal shows all pending CRs assigned to the responder, ordered by urgency and deadline. Each CR detail page renders the full context package with syntax-highlighted evidence, risk indicators, a trace link to the observability platform, and a response form generated from the declared JSON Schema.

# **9\. Routing and Escalation Policy**

## **9.1  Policy Definition**

Routing policies are defined in a declarative YAML format and managed by Coordinators through the HCP Portal or API. A policy consists of a match expression evaluated against CR metadata and a target, which is a responder or a pool of responders.

| Policy Example — YAML |
| :---- |
| \- name: high-risk-financial-approvals |
|   match: |
|     intent: APPROVAL\_REQUIRED |
|     urgency: \[high, critical\] |
|     agent\_tags: \[finance, payments\] |
|   target: |
|     role: finance-approver |
|     require\_quorum: 2          \# requires 2 of N approvers |
|   timeout: 4h |
|   escalation: |
|     \- after: 2h |
|       target: { role: finance-director } |
|     \- after: 3h |
|       target: { role: cto } |
|   fallback: SUSPEND\_AGENT |

## **9.2  Risk-Tiered Auto-Approval**

For low-risk, high-volume coordination events, requiring human response for every CR is operationally unsustainable. HCP supports risk-tiered auto-approval rules that allow certain CR types to be automatically approved based on agent identity, intent, and policy-defined parameters — with the decision logged as a system decision rather than a human decision. Auto-approval rules are versioned and auditable.

# **10\. Security, Trust, and Safety**

## **10.1  Trust Boundaries**

The HCP sits at the boundary between autonomous systems and humans. This makes trust model design critical. HCP enforces the following trust boundaries:

* Agents can submit CRs but cannot impersonate human responders or inject responses

* Responders can only respond to CRs routed to them; they cannot access other responders' queues

* Coordinators can modify policies but cannot retroactively alter audit logs

* The audit log is append-only; no principal — including infrastructure admins — can delete entries

* All CR submissions are authenticated; anonymous CRs are rejected

## **10.2  Prompt Injection and Adversarial Agents**

Because context packages include content derived from agent execution (web pages, documents, tool outputs), there is a risk that adversarial content in the environment could be included in a CR context package in a way that misleads the human responder. HCP mitigates this through:

* Context sanitisation: HTML and markdown rendering with a strict allowlist

* Provenance labelling: every piece of evidence is labelled with its source type and origin URL

* Injection warnings: if context package content matches heuristic patterns for prompt injection attempts, the responder is warned and the evidence is quarantined

* Agent attestation: agents must sign their CRs with a key registered at onboarding

## **10.3  Human Override and Emergency Stop**

Any human with the appropriate role can issue an Emergency Stop against an agent run, which cancels all pending CRs for that run and transitions the agent to a suspended state. The HCP also exposes a global kill-switch that immediately suspends all agent runs across the platform — designed for use by an AI safety officer in the event of unexpected system behaviour.

## **10.4  Data Retention and Privacy**

CRs and their context packages may contain sensitive information. HCP enforces configurable data retention policies, supports field-level encryption for sensitive context fields, and integrates with enterprise identity providers (SAML, OIDC) to ensure that only authorised responders can view CR details. Context packages are purged according to retention policy; audit metadata (timestamps, decisions, actors) is retained indefinitely.

# **11\. Metrics and Success Criteria**

## **11.1  Platform Health Metrics**

| Metric | Target |
| :---- | :---- |
| CR intake latency (p99) | \< 200ms from submission to PENDING\_RESPONSE |
| Response delivery latency (p99) | \< 5s from human response submission to agent delivery |
| Audit log write latency (p99) | \< 100ms |
| Platform availability | 99.9% monthly uptime |
| Data durability | 99.9999% (six nines) for audit records |

## **11.2  Agent Outcome Metrics**

| Metric | Target (v1) |
| :---- | :---- |
| CR response rate (human responds before timeout) | \> 85% within configured SLA |
| Time to first response (median) | \< 15 minutes for high-urgency CRs |
| Fallback execution rate | \< 5% of CRs should trigger a fallback |
| Auto-approval rate (low-risk CRs) | Configurable per policy; target 60–80% for eligible CRs |
| Responder satisfaction score (NPS-style) | \> 7/10 on context quality and decision clarity |

## **11.3  Definition of Done — v1**

* Any agent can submit a CR via SDK in fewer than 10 lines of code

* A CR with APPROVAL\_REQUIRED intent reaches a Slack responder within 30 seconds of submission

* A human response is delivered back to a waiting agent within 5 seconds of submission

* Every state transition for every CR is present in the audit log

* A Coordinator can define a new routing policy via the Portal without engineer involvement

* Platform handles 1,000 concurrent pending CRs without degradation

# **12\. Phased Delivery Roadmap**

| Phase | Scope | Target |
| :---- | :---- | :---- |
| Phase 0 — Foundation | Core data model, Gateway, REST API, Audit Store, Python SDK. Slack adaptor only. Manual routing (agent specifies responder directly). | Q2 2026 |
| Phase 1 — Routing & Escalation | Policy Engine, role-based routing, escalation chains, timeout \+ fallback behaviours. Email adaptor. HCP Portal (basic). | Q3 2026 |
| Phase 2 — Responder Experience | Teams adaptor, context package auto-assembly from trace, rich portal with full context rendering, response schema builder. | Q4 2026 |
| Phase 3 — Risk Intelligence | Risk-tiered auto-approval, anomaly detection on CR patterns, injection detection, quorum approvals, multi-agent workflow support. | Q1 2027 |
| Phase 4 — Ecosystem | SDK for TypeScript/JS, Java, Go. OpenTelemetry native integration. Marketplace of routing policy templates. Enterprise SSO & RBAC. | Q2 2027 |

# **13\. Open Questions & Risks**

| Question / Risk | Notes / Proposed Resolution |
| :---- | :---- |
| How do we prevent CR flooding? An agent loop could submit thousands of CRs per minute. | Rate limiting at the Gateway; agent-level quotas; circuit breakers. Define escalation policy for quota violations. |
| Who owns the HCP routing policies? Engineering or Product? | Propose a Coordinator role sitting in Platform Engineering, with self-service for product teams within guardrails. |
| How should HCP interact with existing ITSM / ticketing systems (Jira, ServiceNow)? | Phase 2: bidirectional adaptor so a CR can be materialised as an ITSM ticket and its resolution synced back. |
| What is the data residency model for CRs containing PII or proprietary information? | Needs legal review. Initial approach: single-region deployment with field-level encryption. Multi-region in Phase 4\. |
| How do we handle agent runs that span multiple organisations (B2B multi-tenant)? | Out of scope for Phase 0–1. Phase 3: tenant-isolated routing namespaces. |
| Can a human respond on behalf of another human (delegation)? | Phase 2: explicit delegation chains with time-bound delegation grants, audited separately. |

# **14\. Appendix — Glossary**

| Term | Definition |
| :---- | :---- |
| HCP | Human Coordination Plane — the infrastructure described in this document |
| CR | Coordination Request — the atomic unit of human-agent interaction |
| Intent | The type of human coordination an agent is requesting (e.g., APPROVAL\_REQUIRED) |
| Context Package | The structured bundle of information HCP surfaces to a human responder |
| Routing Policy | A declarative rule that maps CR metadata to a set of responders |
| Escalation Chain | An ordered list of fallback responders invoked if earlier responders time out |
| Fallback Behaviour | The action taken when a CR times out across all escalation levels |
| Responder | A human who receives and acts on a Coordination Request |
| Coordinator | A human who configures routing policies and escalation chains |
| Auditor | A human who queries the audit log for compliance or review purposes |
| Auto-Approval | A policy-driven decision to approve a CR without human involvement |
| Emergency Stop | A privileged action that suspends an agent run immediately |
| Trace ID | An identifier linking a CR to the originating agent run in the observability platform |

*Human Coordination Plane (HCP) — Product Requirements Document v0.1*

For internal review only. Not for external distribution.