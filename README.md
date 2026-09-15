# 🛡️ CloakLLM

> **Open-Source Local GDPR & Privacy Firewall for LLMs**  
> *Empower enterprise AI adoption with bi-directional reversible pseudonymization. Never leak sensitive PII, banking details, or credentials to cloud LLMs.*

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Cost: 0 €](https://img.shields.io/badge/Cost-0_%E2%82%AC_(Zero_Cost)-emerald.svg)](#)
[![Stack: 100% Native TypeScript](https://img.shields.io/badge/Stack-Native_TypeScript-blue.svg)](#)
[![Zero Cloud Leak](https://img.shields.io/badge/Security-Zero_Cloud_Leak-green.svg)](#)
[![OpenAI Compatible](https://img.shields.io/badge/Compatibility-OpenAI_API_v1-orange.svg)](#)
[![Local SLM: Ollama | LM Studio | Hugging Face](https://img.shields.io/badge/Local_SLM-Ollama_%7C_LM_Studio_%7C_HuggingFace-purple.svg)](#)

*Lire cette documentation en [Français](README.fr.md).*

---

## 🎯 Why CloakLLM?

Enterprises, Data Protection Officers (DPOs), and security teams frequently restrict LLM adoption (ChatGPT, Claude, Cursor, Copilot, LibreChat) over legitimate privacy and regulatory concerns:
- **Personal Data Leaks (PII):** Names, emails, phone numbers, US Social Security Numbers (SSN), UK National Insurance Numbers (NINO), French NIR.
- **Financial & Corporate Secrets:** IBAN, bank account numbers, confidential invoices, pricing margins.
- **Technical Secrets:** API keys (OpenAI, AWS, GitHub, Stripe, HuggingFace), Slack tokens, database connection strings, private cryptographic keys.
- **Regulatory Penalties:** GDPR, CCPA, HIPAA, and EU AI Act non-compliance.

**CloakLLM solves this dilemma completely.**  
It functions as a **transparent local HTTP proxy** placed between your corporate client applications and external cloud LLMs:

```text
[User / App / Cursor / LibreChat]
           │
           ▼  (contains real PII, SSN, IBAN, secrets)
   ┌───────────────┐
   │   CloakLLM    │ ───> Local SLM / HuggingFace / Fast Regex (0 € cost)
   │  Proxy Engine │ <─── Stores mapping in secure in-memory SessionVault
   └───────────────┘
           │
           ▼  (100% sanitized: [PERSON_1], [SSN_1], [IBAN_1], [AMOUNT_1])
   [Cloud LLM (OpenAI / Anthropic / vLLM)]
           │
           ▼  (LLM generates answer referencing placeholders)
   ┌───────────────┐
   │   CloakLLM    │ ───> Real-time token-by-token de-anonymizer (SSE Streaming & JSON)
   └───────────────┘
           │
           ▼  (real data seamlessly restored on user's screen)
[User / App / Cursor / LibreChat]
```

---

## ⚡ Quickstart in 30 Seconds

CloakLLM runs natively on **Node.js >= 20** with **zero runtime npm dependencies** (powered by native TypeScript type stripping):

```bash
# Start proxy server (default port: 8080)
npm start

# Watch mode for active development
npm run dev

# Run automated test suite (80+ unit and integration tests)
npm test
```

Access the interactive web dashboard at `http://127.0.0.1:8080/dashboard` or `http://127.0.0.1:8080/`.

---

## 🤖 Multi-Provider Local Models & Hugging Face Support

CloakLLM provides a unified local Small Language Model (SLM) and Named Entity Recognition (NER) interface. You can run 100% on-premise inference with **0 € cloud cost** and **zero external network telemetry**:

### 1. Ollama Daemon
```bash
# Runs on local developer workstation (default: http://127.0.0.1:11434)
node --experimental-strip-types src/cli.ts --local-provider ollama --local-model llama3.2:1b
```

### 2. OpenAI-Compatible Local Engines (LM Studio, vLLM, llama.cpp, LocalAI, Jan.ai)
Connect to any local engine serving quantized GGUF, AWQ, or EXL2 models on workstation or private GPU servers:
```bash
# LM Studio (default: http://127.0.0.1:1234/v1)
node --experimental-strip-types src/cli.ts --local-provider openai-compatible --local-url http://127.0.0.1:1234/v1

# vLLM or LocalAI on LAN (default: http://127.0.0.1:8000/v1)
node --experimental-strip-types src/cli.ts --local-provider openai-compatible --local-url http://127.0.0.1:8000/v1
```

### 3. Local Hugging Face Inference (TEI & Transformers Pipeline)
Plug in local Hugging Face token-classification or text-generation endpoints (e.g., `dslim/bert-base-NER`, `Jean-Baptiste/camembert-ner`):
```bash
node --experimental-strip-types src/cli.ts --local-provider huggingface --local-url http://127.0.0.1:8080 --local-model dslim/bert-base-NER
```

---

## 💻 1-Line Drop-In Integration in Your Code

CloakLLM is fully drop-in compatible with the OpenAI API specification. Simply adjust the `base_url`:

### Python
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8080/v1",  # Directs traffic to local CloakLLM
    api_key="your-openai-api-key"
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {
            "role": "user",
            "content": "Verify file for Mr. John Smith (SSN: 123-45-6789, UK NINO: QQ 12 34 56 A) from Apex Solutions LLC. Bank IBAN: GB29 NWBK 6016 1331 9268 19. Secret token: sk-proj-ab12cd34ef56gh78ij90klmn."
        }
    ],
    stream=True  # Real-time SSE streaming de-anonymization supported natively!
)

for chunk in response:
    content = chunk.choices[0].delta.content or ""
    print(content, end="", flush=True)
```

---

## 🏢 Custom Business Dictionaries & Rules Engine (V2)

Enterprises frequently need to mask internal project codenames, confidential client partnerships, and proprietary asset codes that standard PII scanners cannot know.

CloakLLM V2 provides a **zero-dependency custom dictionary & regex rules loader** (`JSON` or `YAML`):

```json
{
  "dictionaries": [
    {
      "name": "confidential_projects",
      "type": "PROJECT",
      "terms": ["Project Titan", "Operation Starlight", "Apollo-11"]
    },
    {
      "name": "vip_clients",
      "type": "CLIENT",
      "terms": ["Acme Global Corp", "Wayne Enterprises", "Stark Industries"]
    }
  ],
  "customPatterns": [
    {
      "name": "internal_ips",
      "type": "INTERNAL_IP",
      "pattern": "10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}"
    }
  ]
}
```

---

## 📋 DPO Compliance Audit & Reporting Engine (GDPR Article 32 / CNIL)

CloakLLM generates **Zero-Knowledge Compliance Reports** in HTML, Markdown, and JSON:

```bash
# Printable HTML executive compliance report (for management & auditors)
curl http://127.0.0.1:8080/api/compliance/report?format=html > dpo-report.html

# Machine-readable JSON report
curl http://127.0.0.1:8080/api/compliance/report?format=json > compliance-report.json

# CLI shortcut
cloakllm export-audit --format html --output ./dpo-report.html
```

---

## 🧩 Browser Extension & Inline Client Integration (V2)

Manifest V3 Web Extension for Chrome, Edge, Brave, and Firefox (located in `extension/`):
- Intercepts sensitive prompts before submission on `chatgpt.com`, `claude.ai`, and local Web UIs.
- Replaces sensitive entities with reversible tokens in the DOM.
- Includes zero-install fallback scripts (`extension/userscript/` and `extension/bookmarklet/`).

---

## 🖥️ CloakLLM Developer Console v2.0

Developer console inspired by Linear and Supabase at `http://127.0.0.1:8080/dashboard`:
- Dark zinc `#09090b` palette, 1px solid borders, strict 4px radius, monospaced typography.
- Live traffic feed, split diff inspector, and ephemeral in-memory vault table.

---

## 🧪 Comprehensive Automated Testing

```bash
npm test
```
All 84 test suites pass with 100% pass rate in ~1.1s.

---

## 🏢 Enterprise Consulting & Custom Deployments

Developed and maintained by our **specialized agency for custom software engineering and enterprise automation**.

Contact: `contact@agence-web-automation.fr`

---

## 📄 License

Distributed under the **Apache 2.0 License**. Free for commercial, personal, and enterprise use.
