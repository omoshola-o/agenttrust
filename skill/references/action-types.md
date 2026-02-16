# Action Type Taxonomy

AgentTrust uses dot-notation action types. Use exactly these values in the `action.type` field.

## Reference Table

| Type | Category | Description |
|---|---|---|
| `message.send` | Messaging | Sent a message via any channel (email, SMS, Slack, etc.) |
| `message.read` | Messaging | Read or accessed a message |
| `file.read` | File System | Read a file from disk |
| `file.write` | File System | Wrote or created a file |
| `file.delete` | File System | Deleted a file |
| `api.call` | API | Made an external API request |
| `api.auth` | API | Performed authentication or authorization |
| `exec.command` | Execution | Executed a shell command |
| `exec.script` | Execution | Executed a script file |
| `web.search` | Web | Performed a web search |
| `web.fetch` | Web | Fetched a web page |
| `web.browse` | Web | Interacted with a web page via browser tool |
| `payment.initiate` | Financial | Initiated a payment or purchase |
| `payment.confirm` | Financial | Confirmed a payment or purchase |
| `calendar.create` | Calendar | Created a calendar event |
| `calendar.modify` | Calendar | Modified a calendar event |
| `skill.invoke` | Skills | Invoked another skill |
| `memory.write` | Memory | Wrote to agent memory |
| `memory.read` | Memory | Read from agent memory |
| `session.spawn` | Session | Spawned a sub-session |
| `session.send` | Session | Sent a message to another session |
| `elevated.enable` | Elevated | Enabled elevated/host execution mode |
| `elevated.command` | Elevated | Executed a command in elevated mode |

## Choosing the Right Type

- Use the most specific type available (e.g., `file.write` not `exec.command` when writing a file)
- If an action involves multiple types, log the primary action (e.g., an API call that writes a file logs as `api.call`)
- `elevated.*` types should always be used when the agent is operating outside its sandbox
- `payment.*` types apply to any monetary transaction, including crypto and subscriptions
