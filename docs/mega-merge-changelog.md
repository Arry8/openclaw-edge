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
## 2026-03-30 14:27 — 16 PRs merged

**Base:** `3ba98bcd4e7b` → **Head:** `e36cd35ddf1f` on `mega/latest`  
**Build:** passed  
**Duration:** 2m

### security/crash (16)

- [#51277](https://github.com/openclaw/openclaw/pull/51277) fix(reply): redact sandbox security errors from public channels (@viraj1995)
- [#50527](https://github.com/openclaw/openclaw/pull/50527) security: add input length limits to hook agent payload metadata fields (@teddytennant)
- [#50525](https://github.com/openclaw/openclaw/pull/50525) security: add periodic cleanup to control plane rate limiter (@teddytennant)
- [#50521](https://github.com/openclaw/openclaw/pull/50521) security: reject null bytes in archive entry paths (@teddytennant)
- [#50518](https://github.com/openclaw/openclaw/pull/50518) security: replace Math.random with crypto.randomInt in session slug generation (@teddytennant)
- [#50516](https://github.com/openclaw/openclaw/pull/50516) security: use crypto.timingSafeEqual for Nextcloud Talk webhook signatures (@teddytennant)
- [#50515](https://github.com/openclaw/openclaw/pull/50515) security: sanitize control characters in channel error logging (@teddytennant)
- [#50180](https://github.com/openclaw/openclaw/pull/50180) fix(ssrf): honor empty URL allowlists as deny-all (@dims)
- [#49234](https://github.com/openclaw/openclaw/pull/49234) fix(hooks): suppress system event injection when deliver is false (@BrennerSpear)
- [#49120](https://github.com/openclaw/openclaw/pull/49120) fix(security): reject private/internal hosts in cron webhook URLs (@frankentini)
- [#49083](https://github.com/openclaw/openclaw/pull/49083) fix(security): use constant-time comparison for TLS fingerprint verification (@haoyu-haoyu)
- [#48958](https://github.com/openclaw/openclaw/pull/48958) fix: prevent phantom image injection from memory context into agent prompt (@LittleBreak)
- [#48930](https://github.com/openclaw/openclaw/pull/48930) fix(ui): defer fs.constants eval to prevent browser bundle crash (@Valentinws)
- [#48565](https://github.com/openclaw/openclaw/pull/48565) feat(rag): local RAG pipeline for workspace context injection (@oshoulson)
- [#48339](https://github.com/openclaw/openclaw/pull/48339) fix(gateway): add Cache-Control: no-store to default security headers (@frankentini)
- [#48149](https://github.com/openclaw/openclaw/pull/48149) security: prevent requester self-approval in exec.approval.resolve (@kn1ghtc)

---
