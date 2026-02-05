# Changelog

All notable changes to GuardClaw will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2026.2.4] - 2026-02-04

### Added
- Initial release of GuardClaw plugin
- Three-level sensitivity detection (S1/S2/S3)
- Rule-based detector for keywords, tools, and paths
- Local model detector with Ollama integration
- Plugin hook system integration:
  - `message_received` hook for user message detection
  - `before_tool_call` hook for tool call detection
  - `after_tool_call` hook for result detection
  - `tool_result_persist` hook for dual history management
  - `session_end` hook for cleanup
- Session state management for tracking privacy levels
- Dual session history manager (full vs clean)
- Memory isolation with separate directories
- Guard agent management and routing
- Comprehensive test suite (unit + integration)
- Full documentation and configuration examples

### Features
- Automatic S3 routing to local-only guard agents
- Configurable checkpoints for detection
- Multiple detector support (rules + optional AI)
- Session privacy tracking and highest level retention
- Dual history persistence for cloud/local model separation
- Memory filtering for guard agent content
- TypeScript support with full type definitions

### Configuration
- Privacy configuration under `privacy` namespace
- Checkpoint-based detector selection
- Customizable keyword and tool rules
- Optional local model integration
- Guard agent configuration
- Session isolation settings

[2026.2.4]: https://github.com/openclaw/openclaw/releases/tag/guardclaw-v2026.2.4
