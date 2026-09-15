# Contributing to CloakLLM 🛡️

First off, thank you for considering contributing to CloakLLM! Whether you are an individual developer, an open source contributor, or collaborating with a team on corporate AI privacy, your contributions are warmly welcomed.

---

## 🧭 Core Architectural Principles

When contributing code to CloakLLM, please keep our core non-negotiable principles in mind:

1. **0 € Cost & 100% Sovereign:**  
   CloakLLM must remain completely free to run. We do not introduce mandatory paid APIs, closed proprietary SDKs, or cloud telemetry.
2. **Zero Cloud Network Leaks:**  
   No sensitive personal data (PII), credentials, or unencrypted placeholders must ever leave the local machine or private network toward external cloud LLMs.
3. **No Unbounded AI Loops:**  
   All proxy operations must be deterministic, linear, and bounded. We never run recursive self-calling AI loops.
4. **Zero-Dependency Core:**  
   We rely on native modern Node.js features (Node >= 20 with native type stripping `--experimental-strip-types`, native `fetch`, native `BigInt`, native `crypto`). Avoid adding heavy npm dependencies unless strictly necessary.
5. **Bidirectional Consistency:**  
   Any entity anonymized on the inbound path (`user -> proxy -> upstream LLM`) must be faithfully and reversibly restored on the outbound path (`upstream LLM -> proxy -> user`), in both standard JSON and real-time Server-Sent Events (SSE) streaming.

---

## 🛠️ Developer Quickstart & Setup

### Prerequisites
- **Node.js**: `v20.0.0` or higher (Node 22 recommended)
- **Git**

### Installation
Clone the repository and inspect the codebase:
```bash
git clone https://github.com/your-org/cloakllm.git
cd cloakllm
```

Because CloakLLM uses zero runtime npm dependencies, there is no heavy `npm install` required!

### Running Locally
```bash
# Start the proxy server
npm start

# Run in watch mode for development
npm run dev

# Start with a specific local SLM (Ollama)
node --experimental-strip-types src/cli.ts --local-provider ollama --local-model llama3.2:1b

# Start with LM Studio or vLLM (OpenAI-compatible)
node --experimental-strip-types src/cli.ts --local-provider openai-compatible --local-url http://127.0.0.1:1234/v1

# Start with Hugging Face local inference
node --experimental-strip-types src/cli.ts --local-provider huggingface --local-url http://127.0.0.1:8080
```

---

## 🧪 Testing Guidelines

Every change, bugfix, or new detector **must be covered by automated tests**.

Run the test suite:
```bash
npm test
```

### Adding New Detectors
If you are adding a new PII detector (e.g. passport numbers, tax IDs, regional healthcare identifiers):
1. Implement the `DetectorPlugin` interface from [`src/types.ts`](src/types.ts).
2. Validate using exact algorithms whenever possible (e.g., Luhn check, Modulo 97, checksum keys) to prevent false positives.
3. Register the detector in [`src/detectors/index.ts`](src/detectors/index.ts).
4. Add comprehensive unit tests in `tests/` covering:
   - Valid inputs
   - Invalid formats / wrong checksums
   - Boundary values and edge cases
   - Multi-turn conversation consistency

---

## 🔀 Git Workflow & Pull Requests

1. **Fork the repository** or create a feature branch from `main`:
   ```bash
   git checkout -b feature/my-awesome-improvement
   ```
2. **Make your changes** following the style and conventions of the codebase.
3. **Run the test suite** and ensure all tests pass:
   ```bash
   npm test
   ```
4. **Commit with clear commit messages**:
   ```bash
   git commit -m "feat(detectors): add Canadian SIN identity number detection"
   ```
5. **Push and open a Pull Request**:
   - Provide a clear summary of what was changed and why.
   - Attach test execution output showing that all tests pass.

---

## 💬 Questions and Feedback

Have ideas, questions, or need guidance?
- Open an issue on GitHub.
- Submit a draft Pull Request to discuss implementations early.

Thank you for helping make enterprise AI sovereign, private, and accessible to everyone! 🚀
