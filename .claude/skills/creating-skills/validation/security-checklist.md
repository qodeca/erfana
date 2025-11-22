# Security Checklist

Security considerations for skill creation.

---

## Secrets & Credentials

- [ ] **No hardcoded API keys:** API keys must use environment variables
  - ❌ `api_key = "sk-abc123..."`
  - ✅ `api_key = os.environ.get("API_KEY")`

- [ ] **No hardcoded passwords:** Passwords must never appear in skill files

- [ ] **No tokens in examples:** Example code uses placeholders, not real tokens
  - ✅ `Authorization: Bearer $TOKEN`
  - ❌ `Authorization: Bearer eyJhbG...`

- [ ] **No sensitive paths:** No user-specific paths with personal information
  - ❌ `/Users/john.smith/secrets/`
  - ✅ `~/.config/your-app/`

---

## Scripts & Code

- [ ] **Error handling:** Scripts fail gracefully with helpful messages
  - ❌ Silent failures or cryptic errors
  - ✅ Clear error messages explaining what went wrong

- [ ] **Input validation:** User input is validated before use
  - Especially for file paths, URLs, and shell commands

- [ ] **No arbitrary code execution:** Scripts don't execute user input as code
  - ❌ `eval(user_input)`
  - ❌ `exec(user_input)`

- [ ] **Sandboxed operations:** Destructive operations have safeguards
  - Confirm before deleting files
  - Backup before overwriting

---

## File Handling

- [ ] **Forward slashes:** All paths use `/`, not `\`
  - ✅ `templates/file.md`
  - ❌ `templates\file.md`

- [ ] **Relative paths:** Use relative paths within the skill
  - ✅ `See templates/example.md`
  - ❌ `See /home/user/skills/my-skill/templates/example.md`

- [ ] **No path traversal:** Instructions don't encourage `../../../` patterns

- [ ] **Safe file operations:** Read/write to expected locations only

---

## External Resources

- [ ] **Trusted sources only:** External links point to reputable sources
  - Official documentation
  - Well-known repositories
  - Established community resources

- [ ] **HTTPS:** All URLs use HTTPS, not HTTP

- [ ] **Stable links:** Links are to stable resources, not temporary or user-generated content

---

## Dependencies

- [ ] **Dependencies documented:** Required packages/tools are listed

- [ ] **Version constraints:** If specific versions needed, document them

- [ ] **Installation verified:** Instructions for installing dependencies are accurate

- [ ] **No malicious packages:** Dependencies are from trusted sources

---

## Data Handling

- [ ] **No data collection:** Skill doesn't send user data to external services (unless explicitly needed and documented)

- [ ] **Privacy respected:** User file contents aren't logged or stored unnecessarily

- [ ] **Minimal permissions:** Skill requests only the permissions it needs

---

## Review Questions

Before releasing, ask yourself:

1. **Would I be comfortable if this skill ran on my personal machine?**

2. **Could a malicious user abuse this skill to cause harm?**

3. **Are there any "escape hatches" that could bypass intended restrictions?**

4. **Is sensitive information (mine or users') protected?**

---

## Red Flags

Stop and reconsider if your skill:

| Red Flag | Risk |
|----------|------|
| Executes arbitrary shell commands from user input | Command injection |
| Downloads and runs external scripts | Malware execution |
| Accesses files outside the project directory | Data exfiltration |
| Sends data to external servers | Privacy violation |
| Requires excessive permissions | Privilege escalation |
| Uses `eval()` or `exec()` on user input | Code injection |

---

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/) - Common security risks
- [CWE Top 25](https://cwe.mitre.org/top25/) - Most dangerous software weaknesses
