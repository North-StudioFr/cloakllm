/**
 * CloakLLM HTTP Proxy & Routing Engine (v3.0)
 * Provides OpenAI-compatible /v1/chat/completions endpoint with bidirectional pseudonymization.
 * Integrates Declarative AI Policy Engine, Deterministic Prompt Firewall, Response DLP,
 * Cryptographic Canary Monitoring, FinOps Cost & Abuse Guard, and MCP Security Proxy.
 * Supports both standard JSON responses and real-time Server-Sent Events (SSE) streaming.
 */

import http from 'node:http';
import { URL } from 'node:url';
import type {
  AuditRecord,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionStreamChunk,
  CloakLLMConfig,
  DetectedEntity,
} from './types.ts';
import { Anonymizer } from './anonymizer.ts';
import { Deanonymizer, StreamDeanonymizer } from './deanonymizer.ts';
import { SessionVault, VaultManager } from './vault.ts';
import { AuditLogger } from './logger.ts';
import { renderDashboardHtml } from './dashboard.ts';
import { MasterDetector } from './detectors/index.ts';
import { ComplianceEngine } from './compliance.ts';
import { loadConfigFile } from './dictionary.ts';
import { loadPolicyFile, PolicyEngine } from './policy.ts';
import { PromptFirewall } from './firewall.ts';
import { CanaryEngine } from './canary.ts';
import { CostGuard } from './cost-guard.ts';
import { ResponseDlp } from './response-dlp.ts';
import { McpSecurityProxy } from './mcp-proxy.ts';
import { DocumentScanner } from './document-scanner.ts';
import { SiemExporter } from './siem-exporter.ts';

export class CloakProxyServer {
  private server: http.Server;
  private anonymizer: Anonymizer;
  private vaultManager: VaultManager;
  private logger: AuditLogger;
  private complianceEngine: ComplianceEngine;
  private config: CloakLLMConfig;
  private fetchFn: typeof fetch;

  // V3 Engines
  private policyEngine: PolicyEngine;
  private firewall: PromptFirewall;
  private canaryEngine: CanaryEngine;
  private costGuard: CostGuard;
  private responseDlp: ResponseDlp;
  private mcpProxy: McpSecurityProxy;
  private documentScanner: DocumentScanner;
  private siemExporter?: SiemExporter;

  constructor(config: CloakLLMConfig, anonymizer?: Anonymizer, logger?: AuditLogger) {
    this.config = config;

    // Load custom dictionary configuration file if specified
    if (config.customConfigFile) {
      try {
        const loaded = loadConfigFile(config.customConfigFile);
        this.config.customConfig = {
          dictionaries: [...(this.config.customConfig?.dictionaries || []), ...(loaded.dictionaries || [])],
          customPatterns: [...(this.config.customConfig?.customPatterns || []), ...(loaded.customPatterns || [])],
        };
      } catch (err) {
        console.warn(`[CloakLLM] Could not load config file ${config.customConfigFile}:`, err);
      }
    }

    if (config.customRules && config.customRules.length > 0) {
      this.config.customConfig = this.config.customConfig || { dictionaries: [], customPatterns: [] };
      for (const r of config.customRules) {
        this.config.customConfig.customPatterns = this.config.customConfig.customPatterns || [];
        this.config.customConfig.customPatterns.push({
          name: r.name,
          type: r.type,
          pattern: r.pattern,
        });
      }
    }

    // Initialize Detector and Anonymizer
    if (anonymizer) {
      this.anonymizer = anonymizer;
    } else {
      const detector = new MasterDetector({
        enabledTypes: config.enabledDetectors,
        customConfig: this.config.customConfig,
        enableOllama: config.enableOllama,
        ollamaOptions: {
          baseUrl: config.ollamaUrl,
          model: config.ollamaModel,
        },
        enableLocalSLM: config.enableLocalSLM || Boolean(config.localProvider),
        localProviderOptions: {
          providerType: config.localProvider || 'ollama',
          baseUrl: config.localModelUrl || config.ollamaUrl,
          model: config.localModelName || config.ollamaModel,
          apiKey: config.localModelApiKey,
          profile: config.environmentProfile || 'workstation',
          fetchFn: config.fetchFn,
        },
        enableEntropy: config.enableEntropy,
        entropyOptions: config.entropyThreshold ? { base64Threshold: config.entropyThreshold } : undefined,
      });
      this.anonymizer = new Anonymizer(detector);
    }

    // Initialize V3 Engines
    this.firewall = new PromptFirewall(config.firewallConfig);

    // Initialize Policy Engine
    let initialPolicyConfig = config.policyConfig;
    if (config.policyConfigFile) {
      try {
        initialPolicyConfig = loadPolicyFile(config.policyConfigFile);
      } catch (err) {
        console.warn(`[CloakLLM] Could not load policy file ${config.policyConfigFile}:`, err);
      }
    }
    this.policyEngine = new PolicyEngine(initialPolicyConfig);

    this.canaryEngine = new CanaryEngine({ secretKey: config.canarySecret });
    this.costGuard = new CostGuard(config.costGuardConfig);
    this.responseDlp = new ResponseDlp(this.anonymizer.getDetector(), this.policyEngine);
    this.mcpProxy = new McpSecurityProxy(this.anonymizer, this.firewall);
    this.documentScanner = new DocumentScanner(this.anonymizer);

    this.fetchFn = config.fetchFn || globalThis.fetch.bind(globalThis);
    if (config.siemConfig) {
      this.siemExporter = new SiemExporter(config.siemConfig, this.fetchFn);
    }

    this.vaultManager = new VaultManager();
    this.logger = logger || new AuditLogger(config.logLevel, config.auditLogFile, this.siemExporter);
    this.complianceEngine = new ComplianceEngine(this.logger);

    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  // Getters for V3 engines
  public getPolicyEngine(): PolicyEngine {
    return this.policyEngine;
  }

  public getPromptFirewall(): PromptFirewall {
    return this.firewall;
  }

  public getCanaryEngine(): CanaryEngine {
    return this.canaryEngine;
  }

  public getCostGuard(): CostGuard {
    return this.costGuard;
  }

  public getResponseDlp(): ResponseDlp {
    return this.responseDlp;
  }

  public getMcpProxy(): McpSecurityProxy {
    return this.mcpProxy;
  }

  public getDocumentScanner(): DocumentScanner {
    return this.documentScanner;
  }

  public getSiemExporter(): SiemExporter | undefined {
    return this.siemExporter;
  }

  public getComplianceEngine(): ComplianceEngine {
    return this.complianceEngine;
  }

  public getLogger(): AuditLogger {
    return this.logger;
  }

  public getAnonymizer(): Anonymizer {
    return this.anonymizer;
  }

  public getHttpServer(): http.Server {
    return this.server;
  }

  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.port, this.config.host, () => {
        const addr = this.server.address();
        const port = typeof addr === 'object' && addr ? addr.port : this.config.port;
        resolve(port);
      });
      this.server.on('error', reject);
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  public async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS headers for local web apps and testing
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-ID, X-Department, X-Role');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    try {
      // 1. Healthcheck
      if (req.method === 'GET' && pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version: '3.0.0', uptime: process.uptime() }));
        return;
      }

      // 2. Web UI Dashboard
      if (req.method === 'GET' && (pathname === '/' || pathname === '/dashboard')) {
        if (this.config.enableDashboard) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderDashboardHtml());
          return;
        }
      }

      // 3. Web Dashboard API - Test Sanitizer
      if (req.method === 'POST' && pathname === '/api/sanitize') {
        const body = await this.readRequestBody(req);
        const { text } = JSON.parse(body || '{}');
        const vault = new SessionVault();
        const result = await this.anonymizer.anonymizeTextAsync(text || '', vault);
        const simulatedRestored = Deanonymizer.deanonymizeText(result.sanitized, vault);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          original: text,
          sanitized: result.sanitized,
          entities: result.entities,
          simulatedRestored,
          vaultMappings: vault.getAllMappings(),
        }));
        return;
      }

      // 4. Web Dashboard API - Audit Stats & Hash-Chain
      if (req.method === 'GET' && pathname === '/api/stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.logger.getStats()));
        return;
      }

      // 4b. DPO Compliance Report (GDPR Article 32)
      if (req.method === 'GET' && pathname === '/api/compliance/report') {
        const format = parsedUrl.searchParams.get('format')?.toLowerCase();
        const accept = req.headers.accept || '';

        if (format === 'html' || (!format && accept.includes('text/html'))) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(this.complianceEngine.generateHtmlReport());
          return;
        }

        if (format === 'markdown' || format === 'md' || (!format && accept.includes('text/markdown'))) {
          res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
          res.end(this.complianceEngine.generateMarkdownReport());
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(this.complianceEngine.generateJsonReport(), null, 2));
        return;
      }

      // 4c. DPO Compliance Summary (JSON)
      if (req.method === 'GET' && pathname === '/api/compliance/summary') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(this.complianceEngine.getSummary(), null, 2));
        return;
      }

      // 4d. Config Inspector (v3.0)
      if (req.method === 'GET' && pathname === '/api/config') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            version: '3.0.0',
            uptime: process.uptime(),
            upstreamUrl: this.config.upstreamUrl,
            enabledDetectors: this.config.enabledDetectors,
            hasCustomConfig: Boolean(
              this.config.customConfig &&
              ((this.config.customConfig.dictionaries && this.config.customConfig.dictionaries.length > 0) ||
               (this.config.customConfig.customPatterns && this.config.customConfig.customPatterns.length > 0))
            ),
            dictionaries:
              this.config.customConfig?.dictionaries?.map(d => ({
                name: d.name,
                type: d.type,
                termsCount: d.terms.length,
              })) || [],
            patterns:
              this.config.customConfig?.customPatterns?.map(p => ({
                name: p.name,
                type: p.type,
              })) || [],
            policyRulesCount: this.policyEngine.getConfig().rules.length,
            firewallEnabled: this.config.enableFirewall !== false,
            costGuardEnabled: this.config.enableCostGuard !== false,
            responseDlpEnabled: this.config.enableResponseDlp !== false,
          }, null, 2)
        );
        return;
      }

      // 4e. Dynamic Dictionary Registration
      if (req.method === 'POST' && pathname === '/api/config/dictionary') {
        const body = await this.readRequestBody(req);
        try {
          const entry = JSON.parse(body || '{}');
          if (!entry.name || !entry.type || !Array.isArray(entry.terms)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid dictionary entry: name, type, and terms array required' }));
            return;
          }
          this.anonymizer.getDetector().registerCustomDictionary(entry);
          this.config.customConfig = this.config.customConfig || { dictionaries: [], customPatterns: [] };
          this.config.customConfig.dictionaries = this.config.customConfig.dictionaries || [];
          const existingIdx = this.config.customConfig.dictionaries.findIndex(d => d.name === entry.name);
          if (existingIdx >= 0) {
            this.config.customConfig.dictionaries[existingIdx] = entry;
          } else {
            this.config.customConfig.dictionaries.push(entry);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', registered: entry.name, termsCount: entry.terms.length }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Malformed JSON payload' }));
        }
        return;
      }

      // 4f. Dynamic Custom Pattern Registration
      if (req.method === 'POST' && pathname === '/api/config/pattern') {
        const body = await this.readRequestBody(req);
        try {
          const rule = JSON.parse(body || '{}');
          if (!rule.name || !rule.type || !rule.pattern) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid pattern rule: name, type, and pattern required' }));
            return;
          }
          this.anonymizer.getDetector().registerCustomPattern(rule);
          this.config.customConfig = this.config.customConfig || { dictionaries: [], customPatterns: [] };
          this.config.customConfig.customPatterns = this.config.customConfig.customPatterns || [];
          const existingIdx = this.config.customConfig.customPatterns.findIndex(p => p.name === rule.name);
          if (existingIdx >= 0) {
            this.config.customConfig.customPatterns[existingIdx] = rule;
          } else {
            this.config.customConfig.customPatterns.push(rule);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', registered: rule.name, pattern: String(rule.pattern) }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Malformed JSON payload' }));
        }
        return;
      }

      // 4g. Dynamic Policy Configuration Update (v3.0)
      if (req.method === 'POST' && pathname === '/api/config/policy') {
        const body = await this.readRequestBody(req);
        try {
          const policyData = JSON.parse(body || '{}');
          if (!policyData || !Array.isArray(policyData.rules)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid policy: rules array required' }));
            return;
          }
          this.policyEngine.setConfig(policyData);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', rulesCount: policyData.rules.length }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Malformed JSON policy payload' }));
        }
        return;
      }

      // 4h. Prompt Firewall Inspect API (v3.0)
      if (req.method === 'POST' && pathname === '/api/firewall/inspect') {
        const body = await this.readRequestBody(req);
        const { text } = JSON.parse(body || '{}');
        const inspectResult = this.firewall.inspect(text || '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(inspectResult));
        return;
      }

      // 4i. Textual Document Scanner API (v3.0)
      if (req.method === 'POST' && pathname === '/api/documents/scan') {
        const body = await this.readRequestBody(req);
        const { content, filename } = JSON.parse(body || '{}');
        const vault = new SessionVault();
        const scanResult = this.documentScanner.scanDocument(content || '', filename || 'document.txt', vault);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(scanResult));
        return;
      }

      // 4j. Model Context Protocol (MCP) JSON-RPC 2.0 Endpoint (v3.0)
      if (req.method === 'POST' && pathname === '/mcp') {
        const body = await this.readRequestBody(req);
        try {
          const rpcMsg = JSON.parse(body || '{}');
          const sessionId = (req.headers['x-session-id'] as string) || undefined;
          const vault = sessionId ? this.vaultManager.getOrCreate(sessionId) : new SessionVault();
          const isResponse = (rpcMsg && typeof rpcMsg === 'object' && ('result' in rpcMsg || 'error' in rpcMsg)) ||
            (req.headers['x-mcp-direction'] as string) === 'server_to_client';
          const direction = isResponse ? 'server_to_client' : 'client_to_server';
          const processed = this.mcpProxy.processMessage(rpcMsg, vault, direction);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(processed));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
        }
        return;
      }

      // 5. OpenAI /v1/models mock/passthrough
      if (req.method === 'GET' && pathname === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          object: 'list',
          data: [
            { id: 'cloakllm-auto', object: 'model', owned_by: 'cloakllm' },
            { id: 'gpt-4o', object: 'model', owned_by: 'openai' },
            { id: 'gpt-4o-mini', object: 'model', owned_by: 'openai' },
            { id: 'claude-3-5-sonnet', object: 'model', owned_by: 'anthropic' },
          ],
        }));
        return;
      }

      // 6. Core OpenAI Proxy Endpoint: /v1/chat/completions
      if (req.method === 'POST' && pathname === '/v1/chat/completions') {
        await this.handleChatCompletions(req, res);
        return;
      }

      // 404 for other routes
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Route ${pathname} not found` } }));
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Internal Server Error', detail: errorMessage } }));
    }
  }

  private async handleChatCompletions(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const startTime = Date.now();
    const requestId = `req_${Math.random().toString(36).substring(2, 10)}`;
    const rawBody = await this.readRequestBody(req);

    let chatReq: ChatCompletionRequest;
    try {
      chatReq = JSON.parse(rawBody);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
      return;
    }

    if (!chatReq || typeof chatReq !== 'object' || !Array.isArray(chatReq.messages)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid request: messages must be an array' } }));
      return;
    }

    // Step 1: FinOps Rate Limiting & Agentic Abuse Guard
    const clientKey =
      (req.headers['x-forwarded-for'] as string) ||
      (req.socket?.remoteAddress as string) ||
      (req.headers['x-session-id'] as string) ||
      'default';

    // Extract all prompt content for abuse detection and firewall inspection
    const fullPromptText = chatReq.messages
      .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n');

    if (this.config.enableCostGuard !== false) {
      const costCheck = this.costGuard.checkRequest(clientKey, fullPromptText);
      if (!costCheck.allowed) {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': String(costCheck.retryAfterSeconds || 30),
        });
        res.end(JSON.stringify({
          error: {
            message: costCheck.reason,
            type: 'rate_limit_or_circuit_breaker_tripped',
            code: 429,
          },
        }));

        this.logger.record({
          requestId,
          timestamp: new Date().toISOString(),
          model: chatReq.model || 'unknown',
          entitiesDetected: 0,
          entityBreakdown: {},
          processingLatencyMs: Date.now() - startTime,
          upstreamLatencyMs: 0,
          isStreaming: Boolean(chatReq.stream),
          status: 'ERROR',
          circuitBreakerTripped: costCheck.circuitState === 'OPEN',
        });
        return;
      }
    }

    // Step 2: Deterministic Prompt Firewall Inspection
    let firewallResult = { safe: true, riskScore: 0, flags: [] as string[], normalizedText: fullPromptText, matchedPatterns: [] };
    if (this.config.enableFirewall !== false) {
      firewallResult = this.firewall.inspect(fullPromptText);
      if (!firewallResult.safe) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            message: 'Request blocked by CloakLLM Prompt Firewall: prompt injection or jailbreak detected',
            flags: firewallResult.flags,
            riskScore: firewallResult.riskScore,
            type: 'prompt_firewall_blocked',
            code: 403,
          },
          flags: firewallResult.flags,
          riskScore: firewallResult.riskScore,
        }));

        this.logger.record({
          requestId,
          timestamp: new Date().toISOString(),
          model: chatReq.model || 'unknown',
          entitiesDetected: 0,
          entityBreakdown: {},
          processingLatencyMs: Date.now() - startTime,
          upstreamLatencyMs: 0,
          isStreaming: Boolean(chatReq.stream),
          status: 'ERROR',
          riskScore: firewallResult.riskScore,
          firewallFlags: firewallResult.flags,
        });
        return;
      }
    }

    // Step 3: Fast pre-scan of detected entities for Policy Engine
    const preDetected = this.anonymizer.getDetector().detect(fullPromptText);
    const department = (req.headers['x-department'] as string) || (chatReq as any).department;
    const role = (req.headers['x-role'] as string) || (chatReq as any).role;

    // Evaluate Declarative Policy Engine
    const policyDecision = this.policyEngine.evaluate({
      department,
      role,
      provider: 'openai',
      model: chatReq.model,
      detectedEntities: preDetected,
      firewallResult,
    });

    if (policyDecision.blocked) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: {
          message: policyDecision.reason || 'Request blocked by AI Security Policy',
          type: 'policy_violation',
          code: 403,
        },
      }));

      this.logger.record({
        requestId,
        timestamp: new Date().toISOString(),
        model: chatReq.model || 'unknown',
        entitiesDetected: preDetected.length,
        entityBreakdown: {},
        processingLatencyMs: Date.now() - startTime,
        upstreamLatencyMs: 0,
        isStreaming: Boolean(chatReq.stream),
        status: 'ERROR',
        policyAction: 'BLOCK',
      });
      return;
    }

    // Step 4: Optional Honeytoken / Canary Injection
    if (this.config.enableCanary) {
      const canaryToken = this.canaryEngine.generateCanary('SENTINEL');
      const sysMsgIdx = chatReq.messages.findIndex(m => m.role === 'system');
      if (sysMsgIdx >= 0) {
        const sysMsg = chatReq.messages[sysMsgIdx];
        if (typeof sysMsg.content === 'string') {
          sysMsg.content += `\n<!-- SECURITY_SENTINEL: ${canaryToken} -->`;
        }
      } else {
        chatReq.messages.unshift({
          role: 'system',
          content: `<!-- SECURITY_SENTINEL: ${canaryToken} -->`,
        });
      }
    }

    // Step 5: Pseudonymize incoming messages with session vault respecting Policy (ALLOW, CLOAK, REDACT)
    const sessionId =
      (req.headers['x-session-id'] as string) ||
      (typeof chatReq.user === 'string' && chatReq.user ? chatReq.user : undefined);
    const vault = sessionId ? this.vaultManager.getOrCreate(sessionId) : new SessionVault();

    const anonymized = await this.anonymizer.anonymizeMessagesAsync(chatReq.messages, vault, {
      redactTypes: policyDecision.redactTypes,
      allowTypes: policyDecision.allowTypes,
    });
    const processLatency = Date.now() - startTime;

    // Prepare outbound sanitized request
    const outboundPayload: ChatCompletionRequest = {
      ...chatReq,
      messages: anonymized.sanitized,
    };

    // Calculate entity breakdown for zero-knowledge audit
    const entityBreakdown: Record<string, number> = {};
    for (const ent of anonymized.entities) {
      entityBreakdown[ent.type] = (entityBreakdown[ent.type] || 0) + 1;
    }

    const isStreaming = Boolean(chatReq.stream);
    const upstreamUrl = new URL(
      this.config.upstreamUrl.endsWith('/chat/completions')
        ? this.config.upstreamUrl
        : `${this.config.upstreamUrl.replace(/\/$/, '')}/chat/completions`
    );

    const upstreamHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: isStreaming ? 'text/event-stream' : 'application/json',
    };

    // Forward auth token or use configured key
    const clientAuth = req.headers.authorization;
    if (clientAuth) {
      upstreamHeaders['Authorization'] = clientAuth;
    } else if (this.config.upstreamApiKey) {
      upstreamHeaders['Authorization'] = `Bearer ${this.config.upstreamApiKey}`;
    }

    const upstreamStartTime = Date.now();

    try {
      const upstreamResponse = await this.fetchFn(upstreamUrl.toString(), {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify(outboundPayload),
      });

      const upstreamLatency = Date.now() - upstreamStartTime;

      if (!upstreamResponse.ok) {
        const errorText = await upstreamResponse.text();
        res.writeHead(upstreamResponse.status, { 'Content-Type': 'application/json' });
        res.end(errorText);

        this.logger.record({
          requestId,
          timestamp: new Date().toISOString(),
          model: chatReq.model,
          entitiesDetected: anonymized.entities.length,
          entityBreakdown,
          processingLatencyMs: processLatency,
          upstreamLatencyMs: upstreamLatency,
          isStreaming,
          status: 'ERROR',
          policyAction: policyDecision.action,
        });
        return;
      }

      // Step 6A: Non-streaming JSON response with Response DLP & Canary checking
      if (!isStreaming) {
        const upstreamData = (await upstreamResponse.json()) as ChatCompletionResponse;
        let canaryAlert = false;
        let responseLeaksCount = 0;

        if (upstreamData.choices && Array.isArray(upstreamData.choices)) {
          for (const choice of upstreamData.choices) {
            if (choice.message && typeof choice.message.content === 'string') {
              // 1. Canary Leak Check with immediate cutoff
              const canaryCheck = this.canaryEngine.scanForCanaries(choice.message.content);
              if (canaryCheck.leakDetected) {
                canaryAlert = true;
                console.warn(`[CloakLLM ALERT] Canary token leak detected in LLM response: ${canaryCheck.matchedTokens.join(', ')}`);
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  error: {
                    message: `Canary token leakage detected (${canaryCheck.matchedTokens.join(', ')})`,
                    type: 'canary_leak_blocked',
                    code: 403,
                  },
                }));
                this.logger.record({
                  requestId,
                  timestamp: new Date().toISOString(),
                  model: chatReq.model,
                  entitiesDetected: anonymized.entities.length,
                  entityBreakdown,
                  processingLatencyMs: processLatency,
                  upstreamLatencyMs: upstreamLatency,
                  isStreaming: false,
                  status: 'ERROR',
                  policyAction: 'BLOCK',
                  riskScore: firewallResult.riskScore,
                  firewallFlags: firewallResult.flags,
                  canaryAlert: true,
                  responseDlpTriggered: false,
                  responseEntitiesRedacted: 0,
                });
                return;
              }

              // 2. Bidirectional Response DLP (Reversible de-anonymization + newly leaked PII redaction)
              if (this.config.enableResponseDlp !== false) {
                const dlpResult = this.responseDlp.sanitizeResponse(choice.message.content, vault, {
                  model: chatReq.model,
                  department,
                  role,
                });

                if (dlpResult.blocked) {
                  res.writeHead(403, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    error: {
                      message: dlpResult.blockReason || 'Response blocked by AI Security DLP Policy',
                      type: 'response_dlp_blocked',
                      code: 403,
                    },
                  }));
                  this.logger.record({
                    requestId,
                    timestamp: new Date().toISOString(),
                    model: chatReq.model,
                    entitiesDetected: anonymized.entities.length,
                    entityBreakdown,
                    processingLatencyMs: processLatency,
                    upstreamLatencyMs: upstreamLatency,
                    isStreaming: false,
                    status: 'ERROR',
                    policyAction: 'BLOCK',
                    riskScore: firewallResult.riskScore,
                    firewallFlags: firewallResult.flags,
                    canaryAlert,
                    responseDlpTriggered: true,
                    responseEntitiesRedacted: dlpResult.newLeaksDetected.length,
                  });
                  return;
                }

                choice.message.content = dlpResult.text;
                responseLeaksCount += dlpResult.newLeaksDetected.length;
              } else {
                choice.message.content = Deanonymizer.deanonymizeText(choice.message.content, vault);
              }
            }

            // De-anonymize tool calls
            const toolCalls = (choice.message as any)?.tool_calls;
            if (Array.isArray(toolCalls)) {
              for (const tc of toolCalls) {
                if (tc?.function?.arguments && typeof tc.function.arguments === 'string') {
                  tc.function.arguments = Deanonymizer.deanonymizeText(tc.function.arguments, vault);
                }
              }
            }
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(upstreamData));

        this.logger.record({
          requestId,
          timestamp: new Date().toISOString(),
          model: chatReq.model,
          entitiesDetected: anonymized.entities.length,
          entityBreakdown,
          processingLatencyMs: processLatency,
          upstreamLatencyMs: upstreamLatency,
          isStreaming: false,
          status: 'SUCCESS',
          policyAction: policyDecision.action,
          riskScore: firewallResult.riskScore,
          firewallFlags: firewallResult.flags,
          canaryAlert,
          responseDlpTriggered: responseLeaksCount > 0,
          responseEntitiesRedacted: responseLeaksCount,
        });
        return;
      }

      // Step 6B: Streaming Server-Sent Events (SSE) response
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });

      const streamDeanonymizer = new StreamDeanonymizer(vault);
      const reader = upstreamResponse.body?.getReader();

      if (!reader) {
        throw new Error('Upstream response body is not readable');
      }

      const decoder = new TextDecoder();
      let lineBuffer = '';
      let streamCanaryAlert = false;
      let streamResponseLeaksCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || ''; // Keep partial line for next iteration

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            res.write('\n');
            continue;
          }

          if (trimmed === 'data: [DONE]') {
            let remaining = streamDeanonymizer.flush();
            if (remaining) {
              if (this.config.enableResponseDlp !== false) {
                const dlpRes = this.responseDlp.sanitizeResponse(remaining, vault, {
                  model: chatReq.model,
                  department,
                  role,
                });
                remaining = dlpRes.text;
                streamResponseLeaksCount += dlpRes.newLeaksDetected.length;
              }

              const flushChunk = {
                id: requestId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: chatReq.model,
                choices: [{ index: 0, delta: { content: remaining }, finish_reason: null }],
              };
              res.write(`data: ${JSON.stringify(flushChunk)}\n\n`);
            }
            res.write('data: [DONE]\n\n');
            continue;
          }

          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.substring(6);
            try {
              const chunk = JSON.parse(jsonStr) as ChatCompletionStreamChunk;
              if (chunk.choices && chunk.choices[0]?.delta?.content) {
                const rawDelta = chunk.choices[0].delta.content;

                // 1. Canary leak check with immediate cutoff
                const canaryCheck = this.canaryEngine.scanForCanaries(rawDelta);
                if (canaryCheck.leakDetected) {
                  streamCanaryAlert = true;
                  console.warn(`[CloakLLM ALERT] Canary token leak detected in LLM stream: ${canaryCheck.matchedTokens.join(', ')}`);
                  const errorChunk = {
                    id: requestId,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: chatReq.model,
                    choices: [{ index: 0, delta: { content: '\n[SECURITY NOTICE: Stream aborted due to honeytoken/canary leakage]' }, finish_reason: 'stop' }],
                  };
                  res.write(`data: ${JSON.stringify(errorChunk)}\n\ndata: [DONE]\n\n`);
                  res.end();
                  this.logger.record({
                    requestId,
                    timestamp: new Date().toISOString(),
                    model: chatReq.model,
                    entitiesDetected: anonymized.entities.length,
                    entityBreakdown,
                    processingLatencyMs: processLatency,
                    upstreamLatencyMs: upstreamLatency,
                    isStreaming: true,
                    status: 'ERROR',
                    policyAction: 'BLOCK',
                    riskScore: firewallResult.riskScore,
                    firewallFlags: firewallResult.flags,
                    canaryAlert: true,
                    responseDlpTriggered: false,
                    responseEntitiesRedacted: 0,
                  });
                  return;
                }

                let safeDelta = streamDeanonymizer.feed(rawDelta);

                // 2. Bidirectional Response DLP on streaming delta
                if (this.config.enableResponseDlp !== false && safeDelta.length > 0) {
                  const dlpResult = this.responseDlp.sanitizeResponse(safeDelta, vault, {
                    model: chatReq.model,
                    department,
                    role,
                  });

                  if (dlpResult.blocked) {
                    const errorChunk = {
                      id: requestId,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: chatReq.model,
                      choices: [{ index: 0, delta: { content: `\n[SECURITY NOTICE: ${dlpResult.blockReason || 'Stream aborted by Response DLP policy'}]` }, finish_reason: 'stop' }],
                    };
                    res.write(`data: ${JSON.stringify(errorChunk)}\n\ndata: [DONE]\n\n`);
                    res.end();
                    this.logger.record({
                      requestId,
                      timestamp: new Date().toISOString(),
                      model: chatReq.model,
                      entitiesDetected: anonymized.entities.length,
                      entityBreakdown,
                      processingLatencyMs: processLatency,
                      upstreamLatencyMs: upstreamLatency,
                      isStreaming: true,
                      status: 'ERROR',
                      policyAction: 'BLOCK',
                      riskScore: firewallResult.riskScore,
                      firewallFlags: firewallResult.flags,
                      canaryAlert: streamCanaryAlert,
                      responseDlpTriggered: true,
                      responseEntitiesRedacted: dlpResult.newLeaksDetected.length,
                    });
                    return;
                  }

                  safeDelta = dlpResult.text;
                  streamResponseLeaksCount += dlpResult.newLeaksDetected.length;
                }

                if (safeDelta.length > 0) {
                  chunk.choices[0].delta.content = safeDelta;
                  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                }
              } else {
                res.write(`${line}\n\n`);
              }
            } catch {
              res.write(`${line}\n\n`);
            }
          } else {
            res.write(`${line}\n`);
          }
        }
      }

      // Final stream end
      let finalRemaining = streamDeanonymizer.flush();
      if (finalRemaining) {
        if (this.config.enableResponseDlp !== false) {
          const dlpRes = this.responseDlp.sanitizeResponse(finalRemaining, vault, {
            model: chatReq.model,
            department,
            role,
          });
          finalRemaining = dlpRes.text;
          streamResponseLeaksCount += dlpRes.newLeaksDetected.length;
        }

        const finalChunk = {
          id: requestId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: chatReq.model,
          choices: [{ index: 0, delta: { content: finalRemaining }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      }

      res.end();

      this.logger.record({
        requestId,
        timestamp: new Date().toISOString(),
        model: chatReq.model,
        entitiesDetected: anonymized.entities.length,
        entityBreakdown,
        processingLatencyMs: processLatency,
        upstreamLatencyMs: upstreamLatency,
        isStreaming: true,
        status: 'SUCCESS',
        policyAction: policyDecision.action,
        riskScore: firewallResult.riskScore,
        firewallFlags: firewallResult.flags,
        canaryAlert: streamCanaryAlert,
        responseDlpTriggered: streamResponseLeaksCount > 0,
        responseEntitiesRedacted: streamResponseLeaksCount,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            message: `Failed to connect to upstream LLM at ${upstreamUrl.toString()}`,
            detail: errorMessage,
          },
        }));
      } else {
        res.end();
      }

      this.logger.record({
        requestId,
        timestamp: new Date().toISOString(),
        model: chatReq.model,
        entitiesDetected: anonymized.entities.length,
        entityBreakdown,
        processingLatencyMs: processLatency,
        upstreamLatencyMs: Date.now() - upstreamStartTime,
        isStreaming,
        status: 'ERROR',
        policyAction: policyDecision.action,
      });
    }
  }

  private readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }
}
