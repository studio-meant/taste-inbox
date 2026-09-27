**1. What this is and what it lets someone do today**

VoiceStudio (debpalash/VoiceStudio) is an open-source, fully-local desktop application positioned as an ElevenLabs alternative. It bundles voice cloning, voice design, video dubbing, real-time dictation, transcription, and long-form audiobook creation across a claimed 646 languages. It runs offline (local-first) with optional community voice gallery content loaded at runtime via CDN. The app provides a React/Electron desktop UI, a FastAPI REST API on port 3900, and a native Model Context Protocol (MCP) server so AI agents can invoke speech generation and transcription as tools. It packages 16 TTS engines and 11 ASR engines under one interface, supports batch generation, and can run headless via Docker on GPU (CUDA/ROCm) or CPU. It reached #1 Python repo of the day on GitHub Trending (Sep 2026) and has ~15k stars. [1][2][1][3]

**Ecosystem context**: Unlike cloud-only ElevenLabs, VoiceStudio runs entirely locally. Compared to single-model wrappers (XTTS, Bark, Fish Speech), it is an integrated production environment with a desktop front-end, dubbing pipeline, transcription/diarization, and agent-facing MCP/REST interfaces. It is actively maintained (v0.5.1, 83 contributors, 1,895 commits) and distributed via signed releases, Docker Hub (58k+ pulls), and a one-line installer. [1][2][1][3]

**2. Connections to the listed interests**

| Interest | Concrete connection |
|---|---|
| **claude-code** (26 saves) | VoiceStudio publishes an installable agent skill: `npx skills add debpalash/VoiceStudio` lets Claude Code drive the CLI/API/MCP server for voice generation, hardware detection, and model management. [1][4] |
| **codex** (19 saves) | Same skill mechanism works with OpenAI Codex (local task mode); the skill teaches Codex to propose and run VoiceStudio commands with user approval. [1][4] |
| **llm** (19 saves) | The MCP server exposes 16 TTS + 11 ASR engines as callable tools for any LLM agent that speaks MCP (Claude, Cursor, Windsurf, etc.). [1][3] |
| **claude** (16 saves) | Directly usable via the MCP server; the skill installer targets Claude Code specifically. [1][3][1] |
| **ai-agents** (13 saves) | Native MCP server + REST API + skill package make it a drop-in local speech layer for agent workflows (dubbing, narration, transcription). [1][3][5] |
| **agent-skills** (12 saves) | The repo maintains a `.claude` folder and publishes a structured skill (`skills/voicestudio/SKILL.md`) compatible with the agent-skills ecosystem (Tessl, Vois, etc.). [1][5] |
| **mcp** (12 saves) | First-class MCP server runs alongside the REST API; documented as a core interface for agent automation. [1][3] |
| **html** (9 saves) | The frontend is a React web app served by the FastAPI backend; the desktop app is Electron-wrapped, but the same UI runs in-browser at ` when using Docker or the API-only mode. [2][1] |

**3. Smallest verifiable first step**

**Option A — Docker (fastest, works on Linux/macOS/Windows with Docker Engine):**

```bash
docker run -d --name omnivoice \
 -p 127.0.0.1:3900:3900 \
 -v omnivoice-data:/app/omnivoice_data \
 -v ~/.cache/huggingface:/root/.cache/huggingface \
 palashdeb/omnivoice-studio:0.5.0@sha256:2bf2d4d86591672caedada4384895c0e0ca4fdb3ec7f8efed257210b5abd4629
```

Then open ` in a browser. **Proof it worked**: the VoiceStudio web UI loads and the `/health` endpoint returns `{"status":"ok"}` (or the UI shows the workspace tabs: Voice Cloning, Video Dubbing, Voice Design, etc.). First run will pull model weights automatically. [2]

**Option B — One-line installer (desktop app, macOS/Windows/Linux):**

```bash
curl -fsSL | sh
```

**Proof it worked**: the VoiceStudio desktop window opens and shows the same workspace tabs; the backend health check at ` responds successfully. [1]

**Option C — Run from source (for development / agent-skill testing):**

```bash
git clone [1]
cd VoiceStudio
bun install
bun run setup:api # prepares Python deps
bun run dev # starts Electron + backend
```

**Proof it worked**: Electron window opens with the UI; the console shows the FastAPI server listening on port 3900. [1]

**Prerequisites note**: Docker path requires Docker 19.03+ and (for GPU) NVIDIA driver ≥550.54.14 + CUDA ≥12.0. The local Python backend needs Python ≥3.10; on macOS 13.3+ only the Docker path is supported. [2]

---

**References:**
- [1] GitHub - debpalash/VoiceStudio: VoiceStudio is the open-source, fully-local ElevenLabs alternative — voice cloning, voice design, video dubbing, dictation, transcription & audiobook creation in 646 languages. https://github.com/debpalash/VoiceStudio
- [2] Download for Windows, macOS, and Linux · VoiceStudio. https://voicestudio.sh/download
- [3] Debpalash VoiceStudio Hit GitHub Trending, but Local Voice AI Still Has to Prove Itself. https://www.remio.ai/post/debpalash-voicestudio-hit-github-trending-but-local-voice-ai-still-has-to-prove
- [4] Tessl • The package manager for agent skills. https://tessl.io/registry/skills/github/debpalash/VoiceStudio/voicestudio
- [5] VoiceStudio Explained: The 33k-Star Local AI Voice & Dubbing Engine - HoangYell. https://hoangyell.com/voicestudio-explained
