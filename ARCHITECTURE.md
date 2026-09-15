# Architecture Technique — CloakLLM (v3.0 Entreprise)

> **Proxy Pare-feu RGPD Local, Moteur de Règles IA ("Policy as Code") & Proxy MCP pour LLMs**  
> *Souveraineté des données, Zero-Knowledge en mémoire, 100 % Déterministe (Zéro boucle IA critique), 100 % Open Source.*

---

## 1. Schéma Général des Flux de Données (v3.0)

```
                  ┌────────────────────────────────────────────────────────┐
                  │                    CLIENT RUNTIME                      │
                  │ (Cursor, Claude Code, LibreChat, Open WebUI, Code App) │
                  └───────────────────────────┬────────────────────────────┘
                                              │
                       POST /v1/chat/completions ou POST /mcp (JSON-RPC)
                                              │
                                              ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                CLOAKLLM v3 CORE GATEWAY                                  │
│                                                                                          │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐   │
│   │ 1. AI COST & ABUSE GUARD (FinOps)                                                │   │
│   │    - Rate-limiting fenêtre glissante en mémoire (req/min & tokens/min)           │   │
│   │    - Disjoncteur anti-boucle infinie agentique (CLOSED -> OPEN -> HALF_OPEN)     │   │
│   └────────────────────────────────────────┬─────────────────────────────────────────┘   │
│                                            │                                             │
│                                            ▼                                             │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐   │
│   │ 2. PROMPT FIREWALL & NORMALISATION UNICODE (Latence < 1ms)                       │   │
│   │    - Canonicalisation NFKC, suppression caractères invisibles / zero-width       │   │
│   │    - Normalisation des homoglyphes (cyrilliques et grecs confondus)              │   │
│   │    - Détection heuristique pondérée de jailbreak, instruction override, DAN      │   │
│   │    *Rejet HTTP 403 immédiat si riskScore >= threshold                            │   │
│   └────────────────────────────────────────┬─────────────────────────────────────────┘   │
│                                            │                                             │
│                                            ▼                                             │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐   │
│   │ 3. PIPELINE DE DÉTECTION MULTI-COUCHES (MasterDetector)                          │   │
│   │    - Secrets déterministes (OpenAI, AWS, GitHub, Stripe, JWT, Clés privées RSA)  │   │
│   │    - Entropie de Shannon native : calcul mathématique des secrets aléatoires     │   │
│   │    - Filtrage réseau RFC 1918 : masquage binaire des plages privées (INTERNAL_IP)│   │
│   │    - Dictionnaires d'entreprise & regex personnalisées (customPatterns)          │   │
│   │    - Moyens de paiement (Luhn Mod 10) & Finances (IBAN Modulo 97, montants)      │   │
│   │    - Identité civile (NIR Sécurité Sociale, US SSN, UK NINO, SIRET avec Luhn)    │   │
│   │    - Entités Nommées (Personnes, Sociétés, connecteurs SLM locaux)               │   │
│   └────────────────────────────────────────┬─────────────────────────────────────────┘   │
│                                            │                                             │
│                                            ▼                                             │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐   │
│   │ 4. DÉCLARATIF AI POLICY ENGINE ("Policy as Code" YAML/JSON)                      │   │
│   │    - Évaluation des règles par département, rôle, modèle et type d'entité        │   │
│   │    - Partitionnement : ALLOW (laisser passer), CLOAK (pseudonymiser réversible), │   │
│   │      REDACT (masquage irréversible [REDACTED_TYPE]), BLOCK (rejet HTTP 403)      │   │
│   └────────────────────────────────────────┬─────────────────────────────────────────┘   │
│                                            │                                             │
│                                            ▼                                             │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐   │
│   │ 5. CANARIS CRYPTOGRAPHIQUES & SESSION VAULT (SessionVault)                       │   │
│   │    - Injection optionnelle de faux honeytokens HMAC-SHA256 (CL-CANARY-...)       │   │
│   │    - Table de correspondance isolée strictement en RAM (Zéro disque)             │   │
│   └────────────────────────────────────────┬─────────────────────────────────────────┘   │
│                                            │                                             │
│                                            ▼                                             │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐   │
│   │ 6. JOURNAL D'AUDIT IMMUABLE EN CHAÎNE DE HACHAGE SHA-256 (AuditLogger)           │   │
│   │    - Chaque log scelle le SHA-256 du précédent (preuve inviolable anti-altération│   │
│   │    - Export Syslog RFC 5424 et Webhook SIEM (Splunk, Elastic, Sentinel)          │   │
│   └──────────────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────┬─────────────────────────────────────────────┘
                                             │
                      POST /chat/completions (Prompt 100% aseptisé)
                                             │
                                             ▼
                   ┌───────────────────────────────────────────────────┐
                   │                LLM CLOUD / DISTANT                │
                   │    (OpenAI, Anthropic, Azure AI, Mistral Cloud)   │
                   │   *Ne voit JAMAIS aucune PII ni donnée secrète*   │
                   └─────────────────────────┬─────────────────────────┘
                                             │
                      Réponse brute contenant [PERSON_1], [AMOUNT_1]...
                      (JSON complet ou Flux Server-Sent Events - SSE)
                                             │
                                             ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                               CLOAKLLM RESPONSE PIPELINE                                 │
│                                                                                          │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐   │
│   │ 7. RESPONSE DLP & VÉRIFICATION DES CANARIS                                       │   │
│   │    - Détection immédiate d'exfiltration si un token canary est régurgité         │   │
│   │    - Désanonymisation inverse des balises autorisées du Vault                    │   │
│   │    - Scan anti-fuite : neutralisation automatique des nouveaux secrets ou cartes │   │
│   │      bancaires générés ou hallucinés par le modèle ([REDACTED_TYPE])             │   │
│   │    - Tampon de flux SSE streaming (StreamDeanonymizer) résolvant les chunks      │   │
│   └────────────────────────────────────────┬─────────────────────────────────────────┘   │
└────────────────────────────────────────────┬─────────────────────────────────────────────┘
                                             │
                      Réponse finale reconstituée sans fuite résiduelle
                                             │
                                             ▼
                   ┌───────────────────────────────────────────────────┐
                   │               APPLICATION CLIENTE                 │
                   │        (Expérience utilisateur transparente)      │
                   └───────────────────────────────────────────────────┘
```

---

## 2. Description Détaillée des Nouveaux Moteurs V3

### 2.1. AI Policy Engine Déclaratif (`src/policy.ts`)
Permet aux DPO et RSSI d'écrire des politiques de sécurité déterministes sous forme de code (YAML ou JSON) :
- **Actions prises en charge :**
  - `ALLOW` : transmission en clair autorisée sans modification.
  - `CLOAK` : pseudonymisation bidirectionnelle standard réversible via le Vault.
  - `REDACT` : masquage définitif irréversible (`[REDACTED_NIR]`), aucune entrée n'est inscrite au Vault.
  - `BLOCK` : rejet immédiat de la requête avec code HTTP 403 et justification d'audit.
  - `WARN` : traçabilité et signalement dans les journaux d'audit et les en-têtes.
- **Critères d'évaluation contextuelle :** `department` (en-tête `X-Department`), `role` (`X-Role`), `provider`, `model` (supportant les wildcards ex. `gpt-*`), `entities` détectées, et `minRiskScore` du pare-feu de prompts.

### 2.2. Pare-feu de Prompts Déterministe & Normalisation Unicode (`src/firewall.ts`)
- **Canonicalisation :**
  1. Normalisation Unicode NFKC (Compatibility Decomposition + Canonical Composition).
  2. Suppression des caractères invisibles et séparateurs de largeur nulle (`\u200B-\u200D`, `\uFEFF`, etc.).
  3. Décodage des homoglyphes : substitution des caractères cyrilliques et grecs visuellement identiques aux lettres latines.
- **Analyse Heuristique Pondérée (<1ms) :**
  Calcul d'un score de risque de 0 à 100 basé sur la détection des vecteurs d'attaque :
  - Écrasement d'instructions (`ignore previous instructions`, `system override`) : poids 50.
  - Extraction du prompt système (`repeat everything above`, `show developer prompt`) : poids 45.
  - Jailbreaks de rôle (`DAN mode`, `developer mode enabled`, `uncensored mode`) : poids 50.
  - Injection de délimiteurs de prompt (`---BEGIN SYSTEM---`, `<<SYS>>`) : poids 35.
  - Obfuscation (`base64 decode and execute`) : poids 30.

### 2.3. Détecteur d'Entropie de Shannon & Filtrage Réseau RFC 1918 (`src/detectors/entropy.ts`, `src/detectors/network.ts`)
- **Entropie de Shannon :** Calcul mathématique exact $H = -\sum_{i} p_i \log_2(p_i)$ sur fenêtre glissante pour intercepter les clés secrètes inconnues, tokens hexadécimaux ($\ge 32$ caractères, entropie $> 3.4$) et blobs Base64 ($\ge 20$ caractères, entropie $> 4.2$).
- **Filtrage RFC 1918 :** Détection et classification automatique des adresses IP en sous-réseaux d'infrastructure interne (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, loopback `127.0.0.0/8`, link-local `169.254.0.0/16`, IPv6 ULA/Local). Typées `INTERNAL_IP` avec priorité élevée.

### 2.4. DLP Bidirectionnelle en Réponse (`src/response-dlp.ts`)
- Restaure les balises légitimes inscrites dans le Vault de la session courante (`[PERSON_1]` -> `Jean Dupont`).
- Ré-analyse le texte reconstitué avec le `MasterDetector` : si une nouvelle donnée confidentielle non présente dans le Vault est identifiée (carte bancaire, clé API ou IP interne générée ou hallucinée par le modèle), elle est neutralisée et remplacée par `[REDACTED_TYPE]`.

### 2.5. Canaris Cryptographiques / Honeytokens (`src/canary.ts`)
- Générateur de jetons leurres signés par HMAC-SHA256 au format `CL-CANARY-<PREFIX>-<SIGNATURE>`.
- Surveillance bidirectionnelle : si un canari injecté dans le contexte est renvoyé par le LLM ou une réponse d'outil, une alerte critique d'exfiltration est consignée.

### 2.6. AI Cost & Abuse Guard (`src/cost-guard.ts`)
- Rate-limiting en mémoire sur fenêtre glissante (requêtes par minute et estimation du budget de tokens).
- **Disjoncteur Anti-Boucle Agentique (Circuit Breaker) :**
  - Surveille les requêtes identiques consécutives ou les rafales de requêtes anormales.
  - Transitionne de `CLOSED` à `OPEN` et bloque les requêtes avec HTTP 429 (`Retry-After`).
  - Après une période de refroidissement, passe en `HALF_OPEN` pour tester la reprise du service avant fermeture définitive (`CLOSED`).

### 2.7. Proxy de Sécurité MCP (Model Context Protocol) (`src/mcp-proxy.ts`)
- Intercepteur de protocole JSON-RPC 2.0 pour les serveurs d'outils et d'agents (Claude Code, Cursor, LibreChat).
- Assainit les arguments d'appels d'outils (`tools/call`) et le contenu des réponses d'outils (`result.content`).
- Utilisable en mode flux transform stdio (`cloakllm mcp-proxy`) ou via le point de terminaison `/mcp`.

### 2.8. Scanner Déterministe de Documents (`src/document-scanner.ts`)
- Ingestion et assainissement multi-formats sans dépendance :
  - **CSV / TSV :** Analyse cellule par cellule avec respect des guillemets et délimiteurs.
  - **JSON / NDJSON :** Parcours récursif et assainissement des chaînes avec préservation de la structure JSON.
  - **XML / HTML :** Assainissement des nœuds textuels en préservant intactes les balises de balisage.
  - **Courriels EML (RFC 822) :** Nettoyage des en-têtes (From, To, Subject) et du corps du message.

### 2.9. Journal d'Audit Immuable en Chaîne SHA-256 & Export SIEM (`src/logger.ts`, `src/siem-exporter.ts`)
- **Tamper-Evident Hash Chain :** Chaque `AuditRecord` inclut `previousHash` et scelle son contenu dans `hash = SHA256(previousHash + payload)`. Toute modification rétroactive d'un journal brise la chaîne et est immédiatement détectée par `verifyIntegrity()`.
- **Exporteur SIEM :** Formatage conforme à **Syslog RFC 5424** et expédition par webhook HTTP vers Splunk HEC, Elastic Ingest, Datadog ou Microsoft Sentinel.

---

## 3. Analyse de Sécurité et Conformité RGPD

### 3.1. Principes RGPD Adressés
- **Article 25 (Privacy by Design and by Default) :** Interception native au niveau du transport réseau.
- **Article 32 (Sécurité du traitement & Pseudonymisation) :** Pseudonymisation réversible uniquement en RAM chez le contrôleur local, scellée cryptographiquement.
- **Article 44 et suivants (Transferts hors UE) :** Les flux sortants vers les clouds tiers ne contiennent aucune donnée personnelle identifiable (PII).

### 3.2. Matrice OWASP Top 10 for GenAI (2025)

| Vulnérabilité OWASP GenAI | Description du Risque | Protection CloakLLM v3 |
| :--- | :--- | :--- |
| **LLM01: Prompt Injection** | Détournement des instructions et jailbreaks | Pare-feu de prompts déterministe, normalisation NFKC, assainissement MCP |
| **LLM02: Sensitive Information Disclosure** | Fuite de données personnelles et de secrets | Détection multi-algorithmique, entropie de Shannon, Response DLP |
| **LLM07: System Prompt Leakage** | Extraction des règles métier confidentielles | Détection d'extraction par le pare-feu, canaris cryptographiques |
| **LLM08: Vector and Embedding Weaknesses** | Documents empoisonnés dans les RAG | Scanner de documents multi-format (CSV, JSON, XML, EML, Markdown) |
| **LLM10: Excessive Agency & DoS** | Boucles infinies et explosion des coûts d'API | FinOps Cost Guard, disjoncteur anti-boucle agentique |
