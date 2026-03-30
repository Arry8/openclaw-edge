## 2026-03-30 11:27 — 1 PRs merged

**Base:** `a449b543c841` → **Head:** `3d3009eaa334` on `mega/latest`  
**Build:** passed  
**Duration:** 0m

### security/crash (1)

- [#56923](https://github.com/openclaw/openclaw/pull/56923) fix(security): include dangerous commands in known commands list (@chziyue)

---
## 2026-03-30 12:36 — 2 PRs merged

**Base:** `2fc7e7a813b9` → **Head:** `a57f9514d2e3` on `mega/latest`  
**Build:** skipped/failed  
**Duration:** 2m

### security/crash (2)

- [#57614](https://github.com/openclaw/openclaw/pull/57614) fix(sandbox): pass global browser SSRF policy to sandbox browser (@zuoanCo)
- [#57088](https://github.com/openclaw/openclaw/pull/57088) fix(cron): add defensive prune before reading run log to prevent OOM (@karanuppal)

---
## 2026-03-30 13:51 — 9 PRs merged

**Base:** `bf3485d07fea` → **Head:** `8c541c1b70e2` on `mega/latest`  
**Build:** skipped/failed  
**Duration:** 0m

### security/crash (9)

- [#55513](https://github.com/openclaw/openclaw/pull/55513) fix(gateway): prevent OOM and socket hang up via Claim Check pattern for large attachments [media://inbound/<id> contract] (@Syysean)
- [#55176](https://github.com/openclaw/openclaw/pull/55176) fix: allow RFC2544 benchmark IPs in image tool SSRF guard (@karanuppal)
- [#55139](https://github.com/openclaw/openclaw/pull/55139) fix: prevent infinite recursion in resolveConsoleSettings() during startup (@keepmind9)
- [#54386](https://github.com/openclaw/openclaw/pull/54386) fix(skill-creator): default to workspace skills directory to prevent data loss on upgrade (@ymrdf)
- [#52619](https://github.com/openclaw/openclaw/pull/52619) fix(cron): catch schedule errors in createJob to prevent Gateway crash (@artwalker)
- [#52506](https://github.com/openclaw/openclaw/pull/52506) docs(zh-CN): complete gateway/security frontmatter + fix sandboxing links (@AIwork4me)
- [#51910](https://github.com/openclaw/openclaw/pull/51910) fix(security): exclude logical OR (||) from pipe-to-shell obfuscation detector (@TurboTheTurtle)
- [#51722](https://github.com/openclaw/openclaw/pull/51722) fix (ssrf): 修复浏览器 SSRF 策略缺失导致的导航阻断问题，补充 dangerouslyAllowPrivateNetwork 配置 (@fengqiliang93)
- [#51311](https://github.com/openclaw/openclaw/pull/51311) fix(ios): guard sendPing continuation against double-resume crash (@yuntan)

---
