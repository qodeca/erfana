# Skill Creation Resources

Curated external references for learning more about Claude Code skills.

---

## Quick Reference (Essential)

Start here for the authoritative sources.

| Resource | Description |
|----------|-------------|
| [Agent Skills Documentation](https://code.claude.com/docs/en/skills) | Official specification for SKILL.md format, YAML fields, and directory structure |
| [Skill Authoring Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | Comprehensive guide covering progressive disclosure, descriptions, cross-model testing, and anti-patterns |
| [Official Skills Repository](https://github.com/anthropics/skills) | 18+ production skills from Anthropic demonstrating real-world patterns |

---

## Decision Making

Use these when deciding whether to create a skill.

| Resource | Description |
|----------|-------------|
| [Skills Explained Blog](https://www.claude.com/blog/skills-explained) | Clarifies how skills compare to prompts, Projects, MCP, and subagents |
| [When to Use Skills vs Commands vs Agents](https://danielmiessler.com/blog/when-to-use-skills-vs-commands-vs-agents) | Decision framework for choosing the right tool |

### Quick Decision Guide

| Use Case | Solution |
|----------|----------|
| One-time instruction | Just type it (prompt) |
| Repeated prompt across conversations | **Skill** |
| Quick shortcut you trigger manually | Slash Command |
| External data integration | MCP Server |
| Independent task execution | Subagent |

---

## Learning from Examples

Study existing skills to learn patterns.

| Resource | Description |
|----------|-------------|
| [Official Skills Repository](https://github.com/anthropics/skills) | Anthropic's official examples: algorithmic-art, brand-guidelines, webapp-testing, etc. |
| [Awesome Claude Skills](https://github.com/travisvn/awesome-claude-skills) | Community-curated list of skills, tools, and resources |
| [obra/superpowers](https://github.com/obra/superpowers) | Battle-tested library with 20+ skills and command shortcuts |

### Notable Official Skills to Study

| Skill | Why It's Instructive |
|-------|---------------------|
| `algorithmic-art` | Creative skill with clear outputs |
| `webapp-testing` | Technical skill using Playwright |
| `brand-guidelines` | Enterprise pattern with templates |
| `mcp-builder` | Complex skill for building MCP servers |

---

## Deep Understanding

For those who want to understand how skills work internally.

| Resource | Description |
|----------|-------------|
| [Inside Claude Code Skills](https://mikhail.io/2025/10/claude-code-skills/) | Structure, prompts, and invocation mechanics |
| [Claude Agent Skills: First Principles Deep Dive](https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/) | Technical analysis of skill architecture |
| [Simon Willison's Analysis](https://simonwillison.net/2025/Oct/16/claude-skills/) | Practical perspective on skill value and impact |

---

## Help Center Articles

Official support documentation.

| Resource | Description |
|----------|-------------|
| [Using Skills in Claude](https://support.claude.com/en/articles/12512180-using-skills-in-claude) | End-user guide for using skills |
| [How to Create Custom Skills](https://support.claude.com/en/articles/12512198-how-to-create-custom-skills) | Step-by-step creation guide |

---

## Related Topics

### Slash Commands (User-Invoked)
- [Slash Commands Documentation](https://docs.anthropic.com/en/docs/claude-code/slash-commands)
- Different from skills: explicitly triggered with `/command`

### MCP (Model Context Protocol)
- [MCP Documentation](https://modelcontextprotocol.io/)
- For external data integration, not instruction storage

### Claude Code General
- [Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)
- General patterns for working with Claude Code

---

## Community

Connect with other skill creators.

| Resource | Description |
|----------|-------------|
| [Claude Code GitHub Discussions](https://github.com/anthropics/claude-code/discussions) | Official community discussions |
| [Anthropic Discord](https://discord.gg/anthropic) | Real-time community chat |

---

## Staying Updated

Skills are an evolving feature. Stay current with:

1. **Official Documentation** - Check periodically for updates
2. **Anthropic Blog** - Announcements of new features
3. **GitHub Releases** - Claude Code release notes
4. **Community Resources** - awesome-claude-skills tracks new patterns

---

## Resource Categories Summary

| Category | When to Use |
|----------|-------------|
| **Quick Reference** | Creating your first skill |
| **Decision Making** | Unsure if skill is right solution |
| **Examples** | Learning patterns from real skills |
| **Deep Understanding** | Want to know how skills work |
| **Help Center** | Step-by-step guidance |
| **Community** | Questions and discussion |
