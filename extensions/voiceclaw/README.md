# 🎙️ VoiceClaw — Edge Voice Processing for EdgeClaw

**Keep voice data off the cloud.** VoiceClaw adds local VAD, KWS (keyword spotting), ASR, and TTS to EdgeClaw, integrated with GuardClaw's three-tier privacy system.

## Why VoiceClaw?

EdgeClaw's privacy pipeline protects **text** — but voice data is even more sensitive:

| Threat | Text | Voice |
|--------|------|-------|
| Biometric data (voiceprint) | ❌ | ✅ |
| Ambient information (location, other people) | ❌ | ✅ |
| Real-time stream to cloud | ❌ | ✅ (cloud ASR) |
| Emotional state leakage | ❌ | ✅ (prosody) |

**VoiceClaw closes the voice privacy gap.** When GuardClaw detects S2/S3 sensitivity, VoiceClaw ensures audio never leaves the device.

## Architecture

```
Browser ──WebSocket──→ VoiceClaw Audio Server (:8501)
  │                      ├── Silero VAD (speech detection, ~0ms)
  │                      ├── KWS (wake word detection, optional)
  │                      ├── ASR (SenseVoice/Whisper/Paraformer, local ONNX)
  │                      └── TTS (VITS/edge-tts, configurable)
  │                             │
  │                      ┌──────┴──────┐
  │                      │ Privacy     │
  │                      │ Decision    │
  │                      └──────┬──────┘
  │                             │
  └──────────────────→ GuardClaw Privacy Pipeline
                        ├── S1: cloud ASR/TTS allowed
                        ├── S2: local ASR, text desensitized before cloud
                        └── S3: full local pipeline (audio never leaves device)
```

## Voice Privacy Routing

| Session Level | ASR | Text Processing | TTS |
|---------------|-----|----------------|-----|
| **S1** (Safe) | Cloud (Whisper API) or local | Cloud LLM | Cloud TTS |
| **S2** (Sensitive) | **Local** (SenseVoice) | Desensitized → Cloud LLM | edge-tts |
| **S3** (Private) | **Local** (SenseVoice) | Local LLM (Guard Agent) | **Local** TTS |

**Key guarantee**: For S2/S3 sessions, raw audio NEVER leaves the device.

## Quick Start

### 1. Enable VoiceClaw

Add to `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "VoiceClaw": {
        "enabled": true,
        "config": {
          "voice": {
            "enabled": true,
            "port": 8501,
            "asr": {
              "provider": "sherpa-sensevoice",
              "modelPath": "~/.openclaw/models/sensevoice"
            }
          }
        }
      }
    }
  }
}
```

### 2. Download Models

```bash
# SenseVoice ASR (recommended, 234MB, supports 50+ languages)
cd ~/.openclaw/models
wget https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2
tar xf sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2
mv sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17 sensevoice

# (Optional) Silero VAD — bundled with sherpa-onnx-node, no separate download needed
# (Optional) KWS model — see https://github.com/k2-fsa/sherpa-onnx/releases/tag/kws-models
# (Optional) VITS TTS — see https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models
```

### 3. Build & Run

```bash
cd edgeclaw
pnpm install
pnpm build
pnpm openclaw gateway run
```

### 4. Open the Voice Console

Navigate to the VoiceClaw test page or connect via WebSocket at `ws://127.0.0.1:8501/voice`.

## WebSocket Protocol

### Client → Server

| Message | Format | Description |
|---------|--------|-------------|
| Audio | Binary (PCM 16kHz 16bit mono) | Microphone audio frames |
| Control | `{"type":"ping"}` | Keepalive |
| Control | `{"type":"stop"}` | End voice session |
| Control | `{"type":"tts","text":"..."}` | Request TTS synthesis |

### Server → Client

| Message | Format | Description |
|---------|--------|-------------|
| VAD | `{"type":"vad","data":{"type":"speech_start"}}` | Speech detected |
| KWS | `{"type":"kws","data":{"keyword":"hey claw"}}` | Wake word detected |
| ASR | `{"type":"asr","data":{"text":"...","latencyMs":120}}` | Transcription result |
| TTS | `{"type":"tts_start","turnId":1}` | TTS audio begins |
| TTS Audio | Binary (PCM) | TTS audio chunk |
| State | `{"type":"state","state":"listening","privacyLevel":"S1"}` | Session state change |

## Configuration

Full config in `~/.openclaw/voiceclaw.json`:

```json
{
  "voice": {
    "enabled": true,
    "port": 8501,
    "vad": {
      "enabled": true,
      "threshold": 0.5,
      "silenceDurationMs": 500
    },
    "kws": {
      "enabled": false,
      "keywords": ["hey claw"],
      "threshold": 0.5,
      "modelPath": "~/.openclaw/models/kws"
    },
    "asr": {
      "enabled": true,
      "provider": "sherpa-sensevoice",
      "modelPath": "~/.openclaw/models/sensevoice",
      "language": "auto",
      "cloudFallback": true
    },
    "tts": {
      "enabled": true,
      "provider": "edge-tts",
      "sampleRate": 16000
    },
    "privacy": {
      "transcriptDetection": true,
      "localAsrForS2": true,
      "localAsrForS3": true,
      "localTtsForS3": true
    }
  }
}
```

## Supported ASR Models

| Provider | Model | Size | Languages | Latency (CPU) |
|----------|-------|------|-----------|----------------|
| `sherpa-sensevoice` | SenseVoice | 234MB | zh/en/ja/ko/yue + 50 | ~120ms |
| `sherpa-whisper` | Whisper tiny/base/small | 39-244MB | 99 languages | ~200-800ms |
| `sherpa-paraformer` | Paraformer | 220MB | zh/en | ~100ms |
| `cloud-whisper` | OpenAI Whisper API | — | 99 languages | ~500ms + network |

## Relationship to GuardClaw

VoiceClaw is a **companion plugin** to GuardClaw. While GuardClaw handles text-level privacy (S1/S2/S3 detection, desensitization, guard agent routing), VoiceClaw handles the **voice channel**:

1. VoiceClaw intercepts audio BEFORE it reaches any cloud service
2. Privacy level from GuardClaw session state determines ASR/TTS routing
3. ASR transcripts are fed through GuardClaw's detection pipeline
4. S3 responses use local TTS (audio output also stays on-device)

Both plugins work independently but are stronger together.

## License

MIT — Same as EdgeClaw.
