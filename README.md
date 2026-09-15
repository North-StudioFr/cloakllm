# 🛡️ CloakLLM (v3.0 Enterprise)

> **Ultra-Solid Open-Source Local GDPR & Privacy Firewall, AI Policy Engine & MCP Proxy for LLMs**  
> *Empower enterprise AI adoption with zero-cost deterministic security, prompt firewalling, bi-directional response DLP, and reversible pseudonymization. Never leak sensitive PII, banking details, or credentials to cloud LLMs or agentic tools.*

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Version: 3.0.0](https://img.shields.io/badge/Version-3.0.0_Enterprise-indigo.svg)](#)
[![Cost: 0 €](https://img.shields.io/badge/Cost-0_%E2%82%AC_(Zero_Cost)-emerald.svg)](#)
[![Stack: 100% Native TypeScript](https://img.shields.io/badge/Stack-Native_TypeScript_(Zero_Deps)-blue.svg)](#)
[![Zero Cloud Leak](https://img.shields.io/badge/Security-Zero_Cloud_Leak-green.svg)](#)
[![OpenAI Compatible](https://img.shields.io/badge/Compatibility-OpenAI_API_v1-orange.svg)](#)
[![MCP Security Proxy](https://img.shields.io/badge/MCP-JSON--RPC_2.0_Proxy-purple.svg)](#)
[![OWASP GenAI 2025](https://img.shields.io/badge/OWASP-GenAI_Top_10_2025_Ready-red.svg)](#)

*Lire cette documentation en [Français](README.fr.md).*

---

## 🎯 What is CloakLLM v3?

Enterprises, Data Protection Officers (DPOs), and CISOs restrict LLM and AI Agent adoption (ChatGPT, Claude, Cursor, Copilot, LibreChat) over legitimate privacy, compliance, and security risks:
- **Personal Data Leaks (PII):** US SSN, UK NINO, French NIR, emails, phone numbers, client identities.
- **Financial & Corporate Secrets:** IBAN (validated via Modulo 97), credit cards (Luhn Mod 10), trade secrets.
- **Technical & Cryptographic Secrets:** API keys (OpenAI, AWS, GitHub, Stripe, HuggingFace), private RSA/SSH keys, database URIs, unknown random high-entropy credentials.
- **Prompt Injections & Jailbreaks (OWASP LLM01):** Instruction overrides, system prompt extraction, roleplay jailbreaks (DAN), homoglyph & zero-width smuggling.
- **Agentic Runaway Loops & DoS (OWASP LLM10):** Infinite tool-calling ping-pongs, runaway API token consumption.
- **Model Context Protocol (MCP) Vulnerabilities:** Insecure tool parameters and tainted returns from untrusted tools.
- **Regulatory Penalties:** GDPR (Articles 25, 32, 44+), CCPA, HIPAA, and the EU AI Act.

**CloakLLM v3 solves this completely.**  
It functions as a **high-speed (<5ms overhead) transparent local HTTP proxy** and **stdio MCP proxy** with **0 EUR execution cost** and **zero runtime npm dependencies**:

```text
[User / Cursor / Claude Code / LibreChat]
           │
           ▼  (Prompt with real PII, internal IPs, or prompt injection attempts)
   ┌────────────────────────────────────────────────────────────┐
   │                  CLOAKLLM v3 ENTERPRISE                    │
   │  1. Prompt Firewall & Unicode Canonicalizer (NFKC)         │ ──▶ [403 Forbidden on Jailbreak]
   │  2. FinOps Cost Guard & Agentic Loop Circuit Breaker       │ ──▶ [429 / 503 on Runaway Loops]
   │  3. Multi-Detector (Regex, Luhn, Mod97, Shannon Entropy)   │
   │  4. Declarative AI Policy Engine (ALLOW, CLOAK, REDACT)    │
   │  5. Cryptographic Canary Engine (Honeytokens)              │
   │  6. Tamper-Evident SHA-256 Hash-Chain Audit Logger         │ ──▶ Syslog RFC 5424 / SIEM Webhook
   │  7. Ephemeral In-Memory SessionVault (Zero Disk Leak)      │
   └────────────────────────────────────────────────────────────┘
           │
           ▼  (100% sanitized: [PERSON_1], [INTERNAL_IP_1], [REDACTED_NIR])
   [Cloud LLM (OpenAI / Anthropic / Mistral / vLLM)]
           │
           ▼  (Model responds referencing placeholders or hallucinating leaks)
   ┌────────────────────────────────────────────────────────────┐
   │  8. Bidirectional Response DLP & StreamDeanonymizer (SSE)  │
   │     - Legitimate placeholders restored on-the-fly          │
   │     - Hallucinated/leaked model secrets automatically masked│
   │     - Canary leak alerts triggered if prompt exfiltrated   │
   └────────────────────────────────────────────────────────────┘
           │
           ▼  (Real authorized data restored cleanly for the user)
[User / Cursor / Claude Code / LibreChat]
```

---

## 🚀 Key Features in V3

### 1. 📜 Declarative AI Policy Engine ("Policy as Code")
Configure organizational rules in declarative YAML or JSON files:
- **Actions:** `ALLOW`, `CLOAK` (reversible pseudonymization), `REDACT` (irreversible masking), `BLOCK` (403 rejection), and `WARN`.
- **Targeting:** by `department` (`X-Department`), `role` (`X-Role`), `provider`, `model` (wildcard matching e.g. `gpt-*`), `entities`, and `minRiskScore`.

```yaml
# policy.yaml
defaultAction: CLOAK
rules:
  - id: block-secrets-public-llm
    match:
      entities: [SECRET, CREDIT_CARD]
      model: ["gpt-4o", "claude-*"]
    action: BLOCK
    reason: "Secrets and credit cards are strictly forbidden on public cloud models."

  - id: redact-hr-social-security
    match:
      department: hr
      entities: [NIR, SSN]
    action: REDACT
    reason: "Permanently redact social security numbers for HR prompts."

  - id: allow-dev-internal-ips
    match:
      role: developer
      entities: [INTERNAL_IP]
    action: ALLOW
```

### 2. 🛡️ Deterministic Prompt Firewall & Unicode Canonicalization
- **Canonicalization:** NFKC normalization, invisible zero-width character stripping (`\u200B-\u200D`, `\uFEFF`), and homoglyph decoding (Cyrillic and Greek lookalikes mapped to Latin).
- **High-Speed Heuristics (<1ms):** Weighted risk scoring (0–100) detecting:
  - Instruction override & rule hijacks (`ignore previous instructions`, `system override`)
  - System prompt exfiltration (`repeat everything above`, `show developer prompt`)
  - Roleplay jailbreaks (`DAN mode`, `developer mode enabled`, `uncensored mode`)
  - Delimiter smuggling (`---BEGIN SYSTEM---`, `<<SYS>>`, `<system>`)
  - Obfuscation indicators (`base64 decode and execute`)

### 3. 🔬 Shannon Entropy Detector & RFC 1918 Network Filtering
- **Sliding-Window Shannon Entropy ($H = -\sum p_i \log_2 p_i$):** Pure native mathematical computation across sliding windows to intercept unknown high-entropy secrets, raw cryptographic keys, and Base64 tokens without requiring known regex patterns.
- **RFC 1918 Binary Subnet Classifier:** Automatically tags private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, IPv6 ULA/Link-local, IPv4-mapped IPv6) as `INTERNAL_IP` to prevent enterprise infrastructure exposure.

### 4. 🔍 Bidirectional Response DLP (Data Loss Prevention)
- Inspects LLM completions before delivering them back to users (both JSON and SSE streaming).
- Reversibly restores legitimate placeholders from the SessionVault (`[PERSON_1]` -> `Jean Dupont`), while actively detecting and neutralizing **new secrets, credit cards, or internal IPs** leaked or hallucinated by the model.

### 5. 🪤 Cryptographic Canaries (Honeytokens)
- Generates HMAC-SHA256 signed decoy tokens (`CL-CANARY-<prefix>-<sig>`).
- Injects sentinel markers into system prompts and monitors responses or tool returns. If a model or sub-agent regurgitates a canary, an immediate cutoff and high-priority security alarm is triggered.

### 6. ⏱️ FinOps Cost Guard & Agentic Loop Circuit Breaker
- In-memory sliding window rate limiting (requests/minute and token budgets).
- **Agentic Loop Circuit Breaker:** Detects repetitive infinite loops in autonomous agents (identical prompts or rapid alternating tool calls). Trips state machine (`CLOSED` -> `OPEN` -> `HALF_OPEN`) returning HTTP 429 with `Retry-After`.

### 7. 🔌 Model Context Protocol (MCP) Security Proxy
- Built-in JSON-RPC 2.0 proxy for Anthropic Claude Code, Cursor, and LibreChat MCP servers.
- Sanitizes incoming `tools/call` parameters and outbound tool return text to prevent indirect prompt injection and PII leakage across external tools.
- Usable over stdio (`cloakllm mcp-proxy [-- command ...]`) or via the proxy `/mcp` HTTP endpoint with automatic direction detection.

### 8. 📄 Deterministic Textual Document Scanner
- Multi-format text extraction and sanitization without heavy dependencies:
  - **CSV / TSV:** Cell-by-cell sanitization preserving delimiters and quotes.
  - **JSON / NDJSON:** Recursive traversal and sanitization of string values.
  - **XML / HTML:** Tag-aware text sanitization preserving markup structure.
  - **Email (.eml / RFC 822):** Header (From, To, Subject) and body sanitization.
  - **Markdown & Plaintext:** Fast token sanitization.

### 9. ⛓️ Tamper-Evident SHA-256 Hash-Chain Audit & SIEM Export
- Every zero-knowledge audit record seals the SHA-256 hash of the preceding record (`previousHash`), forming an immutable cryptographic audit trail.
- Integrated **Syslog RFC 5424** formatter and **SIEM Webhook Exporter** for Splunk HEC, Elastic Ingest, Datadog, and Microsoft Sentinel.
- Cryptographic verification via CLI (`cloakllm verify-audit <file>`).

---

## ⚡ Quickstart in 30 Seconds

CloakLLM runs natively on **Node.js >= 20** with **zero runtime npm dependencies**:

```bash
# Start proxy server (default port: 8080)
npm start

# Run automated test suite (120+ unit and integration tests)
npm test
```

Access the interactive web dashboard at `http://127.0.0.1:8080/dashboard` or `http://127.0.0.1:8080/`.

---

## 💻 CLI Commands & Options

```bash
# Start proxy with custom policy and persistent audit file
cloakllm start -p 8080 -P policy.yaml --audit-log /var/log/cloakllm/audit.jsonl

# Start as detached background daemon
cloakllm -d -p 8080 -P policy.yaml

# Check status of running daemon
cloakllm status

# View live daemon logs
cloakllm logs -f

# Verify cryptographic SHA-256 hash-chain of an audit log file
cloakllm verify-audit /var/log/cloakllm/audit.jsonl

# Scan and sanitize an enterprise document
cloakllm scan-doc customer_export.csv -o sanitized_customers.csv

# Run stdio MCP security filter
npx -y @modelcontextprotocol/server-postgres ... | cloakllm mcp-proxy
```

---

## 🛡️ OWASP Top 10 for LLM Applications (2025) Coverage

| OWASP Vulnerability | Threat Description | CloakLLM v3 Countermeasure |
| :--- | :--- | :--- |
| **LLM01: Prompt Injection** | Direct jailbreaks & indirect injection | NFKC Unicode normalization, zero-width stripping, weighted heuristic firewall, MCP sanitization |
| **LLM02: Sensitive Information Disclosure** | PII, secrets, and internal data leakage | Multi-pattern PII detectors, Shannon entropy detector, RFC 1918 filter, Response DLP |
| **LLM07: System Prompt Leakage** | Extraction of developer instructions | Prompt firewall extraction detector, HMAC-SHA256 canary honeytokens |
| **LLM08: Vector and Embedding Weaknesses** | Tainted documents in RAG pipelines | Multi-format document scanner (CSV, JSON, XML, EML, Markdown) |
| **LLM10: Excessive Agency & DoS** | Runaway agentic loops and cost spikes | FinOps Cost Guard, token quota tracker, agentic loop circuit breaker |

---

## 📜 License & Agency Backing

Developed and open-sourced under the **Apache-2.0 License** by **Agence Web & Automation (North Studio)**.  
Designed for enterprise zero-trust security and GDPR compliance.
