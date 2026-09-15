/**
 * Core type definitions for CloakLLM
 * GDPR Privacy Firewall & Reversible De-anonymizing Proxy (v3.0)
 */

export type EntityType =
  | 'EMAIL'
  | 'PHONE'
  | 'IBAN'
  | 'NIR'          // French Social Security Number (Numéro d'Inscription au Répertoire)
  | 'SSN'          // US Social Security Number
  | 'NINO'         // UK National Insurance Number
  | 'CREDIT_CARD'
  | 'AMOUNT'        // Financial values & currencies
  | 'SECRET'        // API Keys, Tokens, Private Keys, High-entropy secrets
  | 'IP_ADDRESS'    // Public IP addresses
  | 'PERSON'
  | 'ORGANIZATION'
  | 'SIRET'         // French Company Registration Numbers (SIREN / SIRET)
  | 'PROJECT'       // Custom enterprise project codename
  | 'CLIENT'        // Custom enterprise VIP client name
  | 'INTERNAL_IP'   // RFC 1918 / Local infrastructure IP
  | 'CUSTOM'
  | (string & {});

export interface DetectedEntity {
  type: EntityType;
  value: string;
  start: number;
  end: number;
  confidence: number;
  metadata?: Record<string, unknown>;
}

export interface PseudonymMapping {
  placeholder: string; // e.g. [PERSON_1], [AMOUNT_1]
  originalValue: string;
  type: EntityType;
  createdAt: number;
}

export interface VaultStore {
  getPlaceholder(value: string, type: EntityType): string;
  getOriginal(placeholder: string): string | undefined;
  getAllMappings(): PseudonymMapping[];
  size(): number;
  clear(): void;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | string;
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  name?: string;
  [key: string]: unknown;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  [key: string]: unknown;
}

export interface ChatCompletionResponseChoice {
  index: number;
  message: {
    role: string;
    content: string;
  };
  finish_reason: string;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionResponseChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  [key: string]: unknown;
}

export interface ChatCompletionStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

export interface DetectorPlugin {
  name: string;
  supportedTypes: EntityType[];
  detect(text: string): DetectedEntity[];
}

export type PolicyAction = 'ALLOW' | 'CLOAK' | 'REDACT' | 'BLOCK' | 'WARN';

export interface AuditRecord {
  requestId: string;
  timestamp: string;
  model: string;
  entitiesDetected: number;
  entityBreakdown: Record<string, number>;
  processingLatencyMs: number;
  upstreamLatencyMs: number;
  isStreaming: boolean;
  status: 'SUCCESS' | 'ERROR';
  previousHash?: string;
  hash?: string;
  policyAction?: PolicyAction;
  riskScore?: number;
  firewallFlags?: string[];
  canaryAlert?: boolean;
  circuitBreakerTripped?: boolean;
  responseDlpTriggered?: boolean;
  responseEntitiesRedacted?: number;
}

export type LocalProviderType = 'ollama' | 'openai-compatible' | 'huggingface';
export type EnvironmentProfile = 'workstation' | 'lan' | 'custom';

export interface LocalNerProviderOptions {
  providerType?: LocalProviderType;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  apiKey?: string;
  profile?: EnvironmentProfile;
}

export interface BusinessDictionaryEntry {
  name: string;
  type: EntityType;
  terms: string[];
  caseSensitive?: boolean;
}

export interface CustomPatternRule {
  name: string;
  type: EntityType;
  pattern: string | RegExp;
  caseSensitive?: boolean;
}

export interface CustomRulesConfig {
  dictionaries?: BusinessDictionaryEntry[];
  customPatterns?: CustomPatternRule[];
}

export interface ComplianceReportSummary {
  periodStart: string;
  periodEnd: string;
  totalRequests: number;
  totalEntitiesProtected: number;
  riskReductionPercentage: number;
  categoryBreakdown: Record<string, number>;
  upstreamDestinations: Record<string, number>;
  averageLatencyMs: {
    sanitization: number;
    upstream: number;
  };
  gdprComplianceStatus: 'CERTIFIED_ARTICLE_32' | 'COMPLIANT' | 'WARNING';
}

export interface ComplianceReport {
  generatedAt: string;
  summary: ComplianceReportSummary;
  recentAuditRecords: AuditRecord[];
  legalNotice: string;
}

// ---------------- Policy Engine Types ----------------
export interface PolicyRule {
  id: string;
  name?: string;
  description?: string;
  match?: {
    department?: string | string[];
    role?: string | string[];
    provider?: string | string[];
    model?: string | string[];
    entities?: EntityType[];
    minRiskScore?: number;
  };
  action: PolicyAction;
  reason?: string;
}

export interface PolicyConfig {
  defaultAction?: PolicyAction;
  rules: PolicyRule[];
}

export interface PolicyContext {
  department?: string;
  role?: string;
  provider?: string;
  model?: string;
  detectedEntities: DetectedEntity[];
  firewallResult?: FirewallResult;
}

export interface PolicyDecision {
  action: PolicyAction;
  blocked: boolean;
  reason?: string;
  matchedRules: PolicyRule[];
  warnings: string[];
  redactTypes: Set<EntityType>;
  cloakTypes: Set<EntityType>;
  allowTypes: Set<EntityType>;
}

// ---------------- Prompt Firewall Types ----------------
export interface FirewallPatternMatch {
  category: string;
  match: string;
  weight: number;
}

export interface FirewallResult {
  safe: boolean;
  riskScore: number;
  flags: string[];
  normalizedText: string;
  matchedPatterns: FirewallPatternMatch[];
}

export interface FirewallConfig {
  riskThreshold?: number;
  customPatterns?: Array<{
    category: string;
    pattern: string | RegExp;
    weight?: number;
  }>;
}

// ---------------- Canary Engine Types ----------------
export interface CanaryConfig {
  secretKey?: string;
  autoInject?: boolean;
}

export interface CanaryDetectionResult {
  leakDetected: boolean;
  matchedTokens: string[];
}

// ---------------- FinOps & Cost Guard Types ----------------
export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface RateLimitStatus {
  allowed: boolean;
  circuitState: CircuitBreakerState;
  reason?: string;
  retryAfterSeconds?: number;
  remainingRequests?: number;
}

export interface CostGuardConfig {
  maxRequestsPerMinute?: number;
  maxTokensPerMinute?: number;
  maxIdenticalPrompts?: number;
  circuitCooldownMs?: number;
}

// ---------------- MCP Security Proxy Types ----------------
export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpJsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type McpMessage = McpJsonRpcRequest | McpJsonRpcResponse;

// ---------------- SIEM Exporter Types ----------------
export interface SyslogConfig {
  appName?: string;
  facility?: number;
}

export interface SiemExporterConfig {
  webhookUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  syslog?: SyslogConfig;
}

// ---------------- Document Scanner Types ----------------
export interface DocumentScanResult {
  originalLength: number;
  sanitizedLength: number;
  sanitizedContent: string;
  entities: DetectedEntity[];
  format: 'text' | 'markdown' | 'csv' | 'tsv' | 'json' | 'xml' | 'html' | 'eml';
  metadata: Record<string, unknown>;
}

// ---------------- Master CloakLLM Configuration ----------------
export interface CloakLLMConfig {
  port: number;
  host: string;
  upstreamUrl: string;
  upstreamApiKey?: string;
  enabledDetectors: EntityType[];
  customRules?: Array<{ name: string; pattern: RegExp; type: EntityType }>;
  customConfig?: CustomRulesConfig;
  customConfigFile?: string;
  auditLogFile?: string;
  enableDashboard: boolean;
  enableOllama?: boolean;
  ollamaUrl?: string;
  ollamaModel?: string;
  enableLocalSLM?: boolean;
  localProvider?: LocalProviderType;
  localModelUrl?: string;
  localModelName?: string;
  localModelApiKey?: string;
  environmentProfile?: EnvironmentProfile;
  logLevel: 'silent' | 'info' | 'debug';
  fetchFn?: typeof fetch;

  // V3 Features
  enablePolicyEngine?: boolean;
  policyConfig?: PolicyConfig;
  policyConfigFile?: string;
  enableFirewall?: boolean;
  firewallConfig?: FirewallConfig;
  enableEntropy?: boolean;
  entropyThreshold?: number;
  enableNetworkFiltering?: boolean;
  enableCanary?: boolean;
  canarySecret?: string;
  enableCostGuard?: boolean;
  costGuardConfig?: CostGuardConfig;
  enableResponseDlp?: boolean;
  siemConfig?: SiemExporterConfig;
}
