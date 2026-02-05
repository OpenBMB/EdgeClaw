# GuardClaw 🔒

Privacy-aware plugin for OpenClaw with sensitivity detection and guard agent support.

## Overview

GuardClaw adds privacy-aware features to OpenClaw by detecting sensitive content at multiple checkpoints and routing sensitive operations to isolated guard agents with local models. It maintains dual session histories and memory directories to ensure sensitive information never leaves your machine.

## Features

- **Three-level sensitivity detection** (S1/S2/S3)
  - S1 (Safe): General content, no restrictions
  - S2 (Sensitive): Redactable information, user prompt
  - S3 (Private): Deep privacy, automatic local routing
  
- **Multiple detection methods**:
  - Rule-based detection for keywords, tool types, and parameters
  - Optional local model detection (Ollama) for complex scenarios
  
- **Guard agent isolation** for S3 operations
  - Automatic routing to local-only models
  - Isolated workspace and session
  
- **Dual session history** management
  - Full history (with guard interactions) for local models
  - Clean history (without guard interactions) for cloud models
  
- **Memory isolation**
  - Separate `MEMORY.md` and `memory/` directories
  - Automatic filtering of guard agent content

## Installation

This plugin is included in the OpenClaw extensions directory. Enable it in your config:

```json
{
  "plugins": {
    "enabled": ["guardclaw"]
  }
}
```

Or install it separately if needed:

```bash
cd extensions/guardclaw
pnpm install
```

## Configuration

Add a `privacy` section to your `openclaw.json`:

```json
{
  "privacy": {
    "enabled": true,
    "checkpoints": {
      "onUserMessage": ["ruleDetector", "localModelDetector"],
      "onToolCallProposed": ["ruleDetector"],
      "onToolCallExecuted": ["ruleDetector"]
    },
    "rules": {
      "keywords": {
        "S2": ["password", "api_key", "secret", "token"],
        "S3": ["ssh", "id_rsa", "private_key", ".pem"]
      },
      "tools": {
        "S2": {
          "tools": ["exec"],
          "paths": ["~/Secrets", "~/Documents/private"]
        },
        "S3": {
          "tools": ["system.run", "fs.write"],
          "paths": ["~/.ssh", "/etc", "~/.aws"]
        }
      }
    },
    "localModel": {
      "enabled": true,
      "provider": "ollama",
      "model": "llama3.2:3b",
      "endpoint": "http://localhost:11434"
    },
    "guardAgent": {
      "id": "guard",
      "workspace": "~/.openclaw/workspace-guard",
      "model": "ollama/llama3.2:3b"
    },
    "session": {
      "isolateGuardHistory": true
    }
  },
  "agents": {
    "list": [
      {
        "id": "main",
        "workspace": "~/.openclaw/workspace-main",
        "subagents": {
          "allowAgents": ["guard"]
        }
      },
      {
        "id": "guard",
        "workspace": "~/.openclaw/workspace-guard",
        "model": "ollama/llama3.2:3b"
      }
    ]
  }
}
```

## Sensitivity Levels

### S1 (Safe)
- Content is safe and contains no sensitive information
- Normal execution with cloud models allowed
- Examples: general questions, public information searches

### S2 (Sensitive)
- Contains sensitive information that can be redacted
- User will be prompted to choose cloud vs. local model
- Examples: logs with API keys, IP addresses, usernames

### S3 (Private)
- Deep privacy or dangerous operations
- Automatically routed to guard agent with local model only
- Examples: SSH keys, passwords, private repository access

## How It Works

1. **User Message Reception**: When a message arrives, GuardClaw checks it against configured rules and optionally queries a local model for sensitivity
2. **Tool Call Interception**: Before tools execute, GuardClaw verifies the tool type and parameters
3. **Result Inspection**: After tool execution, results are checked for sensitive content
4. **Guard Agent Routing**: S3-level operations are automatically routed to an isolated guard agent
5. **Session History Management**: Maintains two parallel histories - full (for local/audit) and clean (for cloud models)

## Advanced Configuration

### Custom Detection Rules

Add your own sensitive patterns:

```json
{
  "privacy": {
    "rules": {
      "keywords": {
        "S2": ["internal_api", "staging_key", "dev_token"],
        "S3": ["production_db", "master_key", "root_cert"]
      },
      "tools": {
        "S2": {
          "tools": ["database.query"],
          "paths": ["~/company", "/opt/internal"]
        },
        "S3": {
          "tools": ["production.deploy"],
          "paths": ["/etc/ssl", "~/credentials"]
        }
      }
    }
  }
}
```

### Enable Local Model Detection

For more nuanced detection, enable the local model:

```json
{
  "privacy": {
    "localModel": {
      "enabled": true,
      "provider": "ollama",
      "model": "llama3.2:3b",
      "endpoint": "http://localhost:11434"
    },
    "checkpoints": {
      "onUserMessage": ["ruleDetector", "localModelDetector"],
      "onToolCallProposed": ["ruleDetector"],
      "onToolCallExecuted": ["ruleDetector"]
    }
  }
}
```

### Multiple Checkpoints

GuardClaw checks content at three points:

1. **onUserMessage**: When user sends a message
2. **onToolCallProposed**: Before a tool executes
3. **onToolCallExecuted**: After a tool completes

Configure which detectors run at each checkpoint.

## API Reference

### Session State Management

```typescript
import {
  markSessionAsPrivate,
  isSessionMarkedPrivate,
  getSessionHighestLevel,
} from "@openclaw/guardclaw/session-state";

// Check if session is private
if (isSessionMarkedPrivate(sessionKey)) {
  // Route to guard agent
}

// Get highest detected level
const level = getSessionHighestLevel(sessionKey); // "S1" | "S2" | "S3"
```

### Dual Session Manager

```typescript
import { DualSessionManager } from "@openclaw/guardclaw/session-manager";

const manager = new DualSessionManager();

// Save message (automatically routes to full/clean histories)
await manager.persistMessage(sessionKey, message, agentId);

// Load history based on model type
const history = await manager.loadHistory(
  sessionKey,
  isCloudModel, // true = clean history, false = full history
  agentId
);
```

### Memory Isolation

```typescript
import { MemoryIsolationManager } from "@openclaw/guardclaw/memory-isolation";

const memoryManager = new MemoryIsolationManager();

// Write to appropriate memory directory
await memoryManager.writeMemory(content, isCloudModel);

// Read from appropriate memory directory
const memory = await memoryManager.readMemory(isCloudModel);

// Sync full memory to clean (removing guard content)
await memoryManager.syncMemoryToClean();
```

## Testing

```bash
# Run all tests
pnpm test

# Run specific test suites
pnpm test rules.test.ts
pnpm test detector.test.ts
pnpm test session-manager.test.ts
pnpm test integration.test.ts

# Watch mode
pnpm test --watch

# Coverage
pnpm test --coverage
```

## Debugging

Enable debug logging:

```json
{
  "logging": {
    "level": "debug"
  }
}
```

Check GuardClaw logs for detection events:

```
[GuardClaw] Message sensitivity: S2 for session main:user:123 - S2 keyword detected: password
[GuardClaw] Tool call sensitivity: S3 for read - S3 path detected: ~/.ssh/id_rsa
[GuardClaw] Session main:user:123 marked as PRIVATE (S3 detected)
```

## Troubleshooting

### Issue: Local model not detecting

**Solution**: Ensure Ollama is running and accessible:

```bash
# Check Ollama status
curl http://localhost:11434/api/tags

# Pull the model if needed
ollama pull llama3.2:3b
```

### Issue: Guard agent not configured

**Solution**: Add guard agent to your agents list:

```json
{
  "agents": {
    "list": [
      {
        "id": "guard",
        "workspace": "~/.openclaw/workspace-guard",
        "model": "ollama/llama3.2:3b"
      }
    ]
  }
}
```

### Issue: Dual histories not working

**Solution**: Check directory permissions:

```bash
ls -la ~/.openclaw/agents/main/sessions/
# Should see both 'full' and 'clean' directories
```

## Performance Considerations

- **Rule detection**: Very fast (~1ms), always enabled
- **Local model detection**: Slower (~500-2000ms), use selectively
- **Checkpoint configuration**: Enable only needed checkpoints
- **History management**: Minimal overhead (~10-50ms per message)

## Security Notes

1. **Local model required**: S3 content never sent to cloud models
2. **Dual histories**: Sensitive context isolated from cloud models
3. **Memory isolation**: Guard agent content filtered from clean memory
4. **Session state**: In-memory only, not persisted to disk (except history files)

## Contributing

Contributions welcome! Please ensure:

1. All tests pass (`pnpm test`)
2. Code follows TypeScript best practices
3. New features include tests
4. Documentation updated

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Build
pnpm build

# Lint
pnpm lint

# Type check
pnpm type-check
```

## Roadmap

- [ ] Web UI integration (show sensitivity badges)
- [ ] Audit log export
- [ ] Regex pattern support for rules
- [ ] Multi-level memory (S1/S2/S3 separation)
- [ ] Custom detector plugins
- [ ] Real-time sensitivity dashboard

## License

MIT

## Credits

Built for OpenClaw by the community. Inspired by privacy-first AI principles.
