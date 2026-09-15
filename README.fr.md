# 🛡️ CloakLLM (v3.0 Entreprise)

> **Pare-feu RGPD Local, Moteur de Règles IA ("Policy as Code") & Proxy MCP pour LLMs**  
> *Débloquez l'usage des modèles d'IA et agents autonomes en entreprise à coût 0 € sans jamais transmettre la moindre donnée sensible dans le cloud.*

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Version: 3.0.0](https://img.shields.io/badge/Version-3.0.0_Entreprise-indigo.svg)](#)
[![Cost: 0 €](https://img.shields.io/badge/Cost-0_%E2%82%AC_(Co%C3%BBt_Z%C3%A9ro)-emerald.svg)](#)
[![Stack: 100% Native TypeScript](https://img.shields.io/badge/Stack-Native_TypeScript_(Z%C3%A9ro_D%C3%A9pendance)-blue.svg)](#)
[![Zéro Fuite Cloud](https://img.shields.io/badge/S%C3%A9curit%C3%A9-Z%C3%A9ro_Fuite_Cloud-green.svg)](#)
[![Compatible OpenAI](https://img.shields.io/badge/Compatibilit%C3%A9-OpenAI_API_v1-orange.svg)](#)
[![Proxy Sécurité MCP](https://img.shields.io/badge/MCP-JSON--RPC_2.0_Proxy-purple.svg)](#)
[![OWASP GenAI 2025](https://img.shields.io/badge/OWASP-GenAI_Top_10_2025-red.svg)](#)

*Read this documentation in [English](README.md).*

---

## 🎯 Pourquoi CloakLLM v3 ?

En entreprise, les **DPO**, directions juridiques et RSSI bloquent fréquemment l'adoption des LLMs et agents (ChatGPT, Claude, Cursor, Copilot, LibreChat) par crainte légitime :
- Des fuites de données à caractère personnel (**PII** : noms, emails, téléphones, sécurité sociale française NIR, SSN américain, NINO britannique).
- Des fuites financières (**IBAN**, devis, coordonnées bancaires ou marges confidentielles).
- Des fuites de **secrets techniques** (clés d'API OpenAI/AWS/GitHub, tokens Slack, mots de passe de bases de données, clés privées).
- Des attaques par **injection de prompt & jailbreak** (détournement d'instructions, extraction du prompt système).
- Des **boucles agentiques infinies** provoquant des surcoûts financiers et du déni de service.
- Des sanctions au titre du **RGPD** et de l'**EU AI Act**.

**CloakLLM v3 résout définitivement ce problème.**  
Il agit comme un **proxy HTTP local ultra-rapide (<5ms de latence)** et un **proxy stdio MCP** exécuté à **coût 0 EUR** avec **zéro dépendance npm externe**.

---

## 🚀 Les Grandes Nouveautés de la V3

### 1. 📜 AI Policy Engine déclaratif ("Policy as Code")
Règles configurables en YAML ou JSON (`ALLOW`, `CLOAK`, `REDACT`, `BLOCK`, `WARN`) avec ciblage par département (`X-Department`), rôle (`X-Role`), modèle (avec wildcards `gpt-*`) et types d'entités détectées.

### 2. 🛡️ Pare-feu Déterministe de Prompts & Normalisation Unicode
- Canonicalisation NFKC, suppression des caractères invisibles de largeur nulle (`\u200B-\u200D`, `\uFEFF`) et normalisation des homoglyphes (cyrilliques et grecs confondus).
- Détection heuristique pondérée de jailbreaks (mode DAN), d'écrasement d'instructions (`ignore previous instructions`), et d'extraction du prompt système avec score de risque en temps réel.

### 3. 🔬 Détecteur d'Entropie de Shannon & Filtrage Réseau RFC 1918
- Calcul mathématique natif de l'entropie de Shannon ($H = -\sum p_i \log_2 p_i$) pour intercepter les clés secrètes et tokens aléatoires inconnus sans regex prédéfinie.
- Classification binaire des sous-réseaux privés (10.x, 172.16-31.x, 192.168.x, 127.x) en `INTERNAL_IP`.

### 4. 🔍 DLP Bidirectionnelle (Response DLP)
Inspection des réponses générées par le modèle avant restitution à l'utilisateur : désanonymisation légitime des balises du vault, tout en masquant automatiquement les nouveaux secrets ou cartes bancaires hallucines par le LLM.

### 5. 🪤 Canaris Cryptographiques (Honeytokens)
Génération de faux tokens leurres signés HMAC-SHA256 (`CL-CANARY-...`) et surveillance des sorties : si un LLM ou outil régurgite un canari, une coupure immédiate et une alerte d'exfiltration sont déclenchées.

### 6. ⏱️ FinOps Cost Guard & Disjoncteur Anti-Boucle
Limitation de débit en mémoire (fenêtre glissante), suivi du quota de tokens approximatif et disjoncteur agentique coupant immédiatement les boucles infinies.

### 7. 🔌 Proxy de Sécurité MCP (Model Context Protocol)
Interception des messages JSON-RPC 2.0 (stdio / HTTP) pour assainir les paramètres d'outils (`tools/call`) et retours d'outils afin de bloquer les injections indirectes. Compatible Cursor et Claude Code.

### 8. 📄 Scanner Déterministe de Documents
Extraction et assainissement multi-formats sans dépendance : CSV/TSV cellule par cellule, JSON récursif, XML/HTML préservant les balises, et courriels `.eml` (RFC 822).

### 9. ⛓️ Journal d'Audit Immuable en Chaîne de Hachage SHA-256 & Export SIEM
Chaque enregistrement scelle le hash du précédent pour garantir l'inviolabilité de l'audit. Export natif Syslog RFC 5424 et webhooks pour Splunk, Elastic et Sentinel.

---

## ⚡ Démarrage Rapide

```bash
# Démarrer le proxy en local (port 8080)
npm start

# Lancer la suite complète de 135+ tests automatisés
npm test

# Vérifier la chaîne de hachage d'un journal d'audit
cloakllm verify-audit /var/log/cloakllm/audit.jsonl

# Assainir un document CSV d'entreprise
cloakllm scan-doc clients.csv -o clients_anonymises.csv

# Filtrer et proxifier un serveur MCP pour Cursor / Claude Code
cloakllm mcp-proxy -- npx -y @modelcontextprotocol/server-postgres postgresql://localhost/mydb
```

---

## 📜 Licence & Accompagnement Entreprise

Développé et maintenu sous licence **Apache-2.0** par l'agence **Agence Web & Automation (North Studio)**.  
Conçu pour les environnements de production d'entreprise et la conformité RGPD / AI Act.
