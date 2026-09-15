# BACKLOG TECHNIQUE : Projet 2 — Copilote Vocal Contextuel Multi-Apps (Alternative Open Source à Wispr Flow)

> **Statut :** Projet consigné en backlog (archivé temporairement au profit du Projet 1 : *CloakLLM*).  
> **Dernière révision :** Septembre 2026  
> **Auteur :** Lead Architect & Développeur Principal  

---

## 1. Vision & Proposition de Valeur

### 1.1. Problématique Métier
La saisie au clavier demeure le principal goulot d'étranglement de la productivité intellectuelle (vitesse moyenne de frappe : 40 à 60 mots/minute contre 130 à 160 mots/minute en parole naturelle).  
Les outils existants souffrent de deux écueils majeurs :
1. **Outils de dictée natifs (Apple Dictation, Windows Speech) :** « Bêtes » et rigides, ils retranscrivent mot à mot sans ponctuation contextuelle, sans suppression des hésitations (« euh », « attends ») et sans adaptation au ton de l'application cible.
2. **Solutions propriétaires modernes (Wispr Flow, Superwhisper) :** Payantes (12 à 30 $/mois), fermées, dépendantes du cloud et transmettant les flux audio ou contextes applicatifs sur des serveurs distants (problème critique de confidentialité).

### 1.2. Produit Cible
Un utilitaire desktop universel, ultra-léger, fonctionnant en **100 % local (0 € de coût récurrent, 0 fuite de données)**, activable par raccourci global (Push-to-Talk) :
- Écoute audio haute fidélité lors du maintien du raccourci.
- Transcription locale ultra-rapide via `whisper.cpp` (modèle `base` ou `small` quantifié en q5/q8).
- Détection instantanée de l'application active au premier plan (Slack, Gmail, VS Code, Notion, Terminal).
- Réécriture contextuelle intelligente par un SLM local (ex. Llama 3.2 1B/3B ou Qwen 2.5 1.5B/3B via Ollama).
- Injection automatique du texte final dans le champ actif via simulation d'événements OS ou presse-papier.

---

## 2. Architecture Technique Cible

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DESKTOP RUNTIME (Tauri v2 / Rust)               │
│                                                                        │
│  ┌──────────────────────┐              ┌────────────────────────────┐  │
│  │ Global Hotkey Hook   │─────────────▶│ Audio Capture Engine       │  │
│  │ (rdev / tauri-hotkey)│              │ (cpal / ringbuffer)        │  │
│  └──────────────────────┘              └─────────────┬──────────────┘  │
│             │                                        │ 16kHz PCM mono  │
│             ▼                                        ▼                 │
│  ┌──────────────────────┐              ┌────────────────────────────┐  │
│  │ Context Collector    │              │ whisper.cpp Engine         │  │
│  │ - Active Window Title│              │ (ggml-base.bin / Metal/CUDA│  │
│  │ - Bundle ID / Process│              └─────────────┬──────────────┘  │
│  │ - Selected Text/Role │                            │                 │
│  └──────────┬───────────┘                            │ Raw transcript  │
│             │                                        │                 │
│             └───────────────────┬────────────────────┘                 │
│                                 ▼                                      │
│                  ┌──────────────────────────────┐                      │
│                  │ Contextual Prompt Engine     │                      │
│                  │ + Local SLM (Ollama / mxf)   │                      │
│                  └──────────────┬───────────────┘                      │
│                                 │ Polished contextual text             │
│                                 ▼                                      │
│                  ┌──────────────────────────────┐                      │
│                  │ Text Injector / Paste Engine │                      │
│                  │ (enigo / arboard clipboard)  │                      │
│                  └──────────────────────────────┘                      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Spécifications Détaillées des Composants

### 3.1. Couche Système & Capture Audio (Rust / cpal)
- **Bibliothèque audio :** `cpal` (Cross-Platform Audio Library) configurée en flux continu avec un `RingBuffer` lock-free (`rtrb`).
- **Format cible pour Whisper :** PCM mono 16-bit signé, 16 000 Hz.
- **Cycle de vie du Push-to-Talk :**
  1. `KeyDown` sur la touche configurée (ex. `Fn`, `Right Alt` ou `Ctrl + Espace`) : initialisation du flux audio, feedback visuel discret (overlay pill en bas d'écran).
  2. `KeyUp` : arrêt de la capture, passage du buffer mémoire au thread d'inférence whisper.cpp.
  3. Détection de silence automatique (VAD léger basé sur l'énergie RMS ou Silero-VAD) pour couper automatiquement en cas d'oubli.

### 3.2. Moteur de Transcription (`whisper.cpp`)
- **Intégration :** Bindings Rust directs (`whisper-rs`) vers `whisper.cpp` compilé avec accélération matérielle native :
  - **macOS :** Metal (Apple Silicon Neural Engine / GPU).
  - **Linux / Windows :** Vulkan ou OpenBLAS/CUDA.
- **Modèles recommandés :**
  - Mode Ultra-Fast : `ggml-tiny.bin` (~75 Mo, latence < 150 ms sur M1/M2/M3).
  - Mode Équilibré (Recommandé) : `ggml-base.bin` (~140 Mo, WER < 8% en français/anglais, latence < 350 ms).
  - Mode Précis : `ggml-small.bin` (~460 Mo, latence ~800 ms).

### 3.3. Détecteur de Contexte Applicatif
Extraction de métadonnées sans capture d'écran intrusive :
- **macOS :**
  - Appel via `NSWorkspace.sharedWorkspace.frontmostApplication` :
    - Récupération du `bundleIdentifier` (ex. `com.tinyspeck.slackmacgap`, `com.google.Chrome`, `com.microsoft.VSCode`).
    - Titre de la fenêtre active via l'API Accessibility (`AXUIElementCopyAttributeValue`).
- **Windows :**
  - `GetForegroundWindow()` + `GetWindowTextW()` + `GetWindowThreadProcessId()`.
- **Linux (X11 / Wayland) :**
  - X11 : `_NET_ACTIVE_WINDOW` via `xdotool` ou XCB.
  - Wayland : extension protocole compositeur ou fallback générique.

### 3.4. Matrice de Réécriture Contextuelle (SLM)
Le texte brut transcrit par Whisper est souvent haché :
> *« Salut Thomas virgule euh est-ce qu'on a validé le devis pour le client Acquisys point d'interrogation »*

Le moteur injecte ce texte et le contexte applicatif dans un prompt optimisé pour un petit LLM local (Ollama API `http://localhost:11434` ou modèle embarqué ONNX) :

| Application Cible | Règle de Transformation | Résultat Typique |
| :--- | :--- | :--- |
| **Slack / Teams** | Style conversationnel direct, concis, suppression des hésitations, conservation de l'émoticône éventuelle. | *« Salut Thomas, est-ce qu'on a validé le devis pour le client Acquisys ? »* |
| **Gmail / Outlook** | Style formel, politesse professionnelle, mise en page aérée. | *« Bonjour Thomas,\n\nPourrions-nous faire le point sur la validation du devis du client Acquisys ?\n\nBien cordialement, »* |
| **VS Code / Cursor / Terminal** | Détection d'intention de code : commentaire ou instruction de commande bash/git. | *`// TODO: valider le devis pour le client Acquisys`* ou commande adaptée. |
| **Notion / Obsidian** | Style notes structurées, tirets de liste si énumération détectée. | *`- Validation devis client Acquisys`* |

Prompt système type :
```text
Tu es un transcripteur et reformulateur contextuel ultra-rapide.
Application cible : {{TARGET_APP}} ({{TARGET_CONTEXT}})
Règles strictes :
1. Corrige la grammaire, la ponctuation et élimine les hésitations orales.
2. Adapte le registre de langue à l'application cible sans dénaturer le sens.
3. Rends UNIQUEMENT le texte final réécrit, sans aucune salutation, explication ni balise markdown de bloc.
```

### 3.5. Injection de Texte (Zero-Friction Paste)
1. Sauvegarde du presse-papier système actuel via `arboard`.
2. Écriture du texte poli dans le presse-papier.
3. Synthèse de l'événement clavier OS `Cmd+V` (macOS) ou `Ctrl+V` (Windows/Linux) vers la fenêtre active.
4. Restauration de l'ancien contenu du presse-papier après 150 ms (pour ne pas polluer l'historique utilisateur).

---

## 4. Analyse des Risques et Raisons de l'Ajournement

### 4.1. Friction des Permissions OS
- **macOS :** Exige l'autorisation explicite de Microphone (`kTCCServiceMicrophone`) ET de Contrôle d'Accessibilité (`kTCCServiceAccessibility`) pour détecter la fenêtre active et injecter des frappes. L'expérience onboarding est notoirement difficile pour les néophytes.
- **Wayland (Linux) :** L'isolation de sécurité bloque nativement les raccourcis globaux et la détection d'autres fenêtres sans portails `xdg-desktop-portal` complexes.

### 4.2. Latence Cumulée
- Capture audio : 2000 ms (durée de la parole).
- whisper.cpp base : ~350 ms.
- LLM rewrite (Ollama 3B) : ~500 ms.
- Injection : ~50 ms.
- **Total : ~900 ms après relâchement de la touche.** Bien que correct, le ressenti utilisateur peut sembler lent si le matériel hôte est modeste (CPU seul sans Apple Silicon ou GPU).

### 4.3. Décalage avec le Positionnement Agence
- Le copilote vocal est un outil individuel B2C / prosumer.
- Il attire un public de passionnés ou de développeurs individuels, mais génère peu d'opportunités de vente d'intégrations ou de contrats B2B sur-mesure pour notre agence (contrairement à la sécurité/RGPD qui touche directement les directions et DPO).

---

## 5. Feuille de Route de Reprise (Roadmap V1)

Lorsque ce projet sera activé :
1. **Étape 1 :** Création du socle Rust/Tauri v2 avec `cpal` + `whisper-rs`. Validation du Push-to-Talk et de la transcription locale en ligne de commande.
2. **Étape 2 :** Implémentation du module de détection de contexte (`active-win-posix-rs` / AppleScript bindings).
3. **Étape 3 :** Connecteur local Ollama avec fallback déterministe (sans LLM si Ollama non démarré : transcription Whisper nettoyée par regex).
4. **Étape 4 :** Interface de paramétrage Tauri (choix des modèles, seuils VAD, templates de prompts par application).
