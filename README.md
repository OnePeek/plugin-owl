# plugin-owl

The Claude Code plug-in that captures work for OnePeek (tier 4). Hooks only enqueue; a background helper sends closed-vocabulary IDs and bands only, scrubbed on the device, signed and chained, through the MCP `log_work` tool. It is open source so anyone can audit what it sends.

- **Built from:** The plug-in section of `onepeek-docs/trd/services/clients.md`, the work-log plug-in spec, and `contracts/mcp/` (`log_work`).
- **Visibility:** Public, Apache-2.0 (open source for audit; the OnePeek name and logo are trademarks, see NOTICE)
- **Rules:** see `AGENTS.md` and the OnePeek engineering standards (https://github.com/OnePeek/onepeek-docs/blob/main/standards/engineering-standards.md).
