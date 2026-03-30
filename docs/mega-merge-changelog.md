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
## 2026-03-30 14:35 — 7 PRs merged

**Base:** `18bb4d9a3420` → **Head:** `cb87eca955f5` on `mega/latest`  
**Build:** skipped/failed  
**Duration:** 0m

### security/crash (7)

- [#48134](https://github.com/openclaw/openclaw/pull/48134) security(openshell): prevent host environment variable leakage to SSH subprocesses (@kn1ghtc)
- [#48133](https://github.com/openclaw/openclaw/pull/48133) security(firecrawl): validate scraped URL to prevent SSRF + cap cache size (@kn1ghtc)
- [#48001](https://github.com/openclaw/openclaw/pull/48001) fix(browser): prevent gateway crash from unhandled MCP handshake rejection in existing-session (@openperf)
- [#47652](https://github.com/openclaw/openclaw/pull/47652) fix(feishu): isolate per-account credential resolution to prevent full plugin crash (@alex-xuweilong)
- [#47225](https://github.com/openclaw/openclaw/pull/47225) feat(context-engine): add toolsOverride to AssembleResult for selective tool schema injection (@DSMediaDev)
- [#46813](https://github.com/openclaw/openclaw/pull/46813) perf: add contextInjection option to skip workspace re-injection (#9157) (@anup00900)
- [#45782](https://github.com/openclaw/openclaw/pull/45782) fix: improve error handling and logging for security-critical operations (@NickyLam)

---
## 2026-03-30 14:41 — 11 PRs merged

**Base:** `22e9bfd35bdf` → **Head:** `fa67bce14cc4` on `mega/latest`  
**Build:** passed  
**Duration:** 3m

### security/crash (11)

- [#45526](https://github.com/openclaw/openclaw/pull/45526) fix(skills): validate frontmatter archive field against argument injection (@MastrXplorer)
- [#45383](https://github.com/openclaw/openclaw/pull/45383) fix(security): wrap inbound media file content to prevent prompt injection (#11207) (@kirs-hi)
- [#45228](https://github.com/openclaw/openclaw/pull/45228) docs(subagents): fix bootstrap file injection list (5 files, not 2) (@qiuyuemartin-max)
- [#45081](https://github.com/openclaw/openclaw/pull/45081) fix(models): lazy-init ANTHROPIC_MODEL_ALIASES to avoid TDZ crash (@laolin5564)
- [#44892](https://github.com/openclaw/openclaw/pull/44892) fix(link-understanding): prevent command injection via URL templates (CWE-78) (@kvenux)
- [#44860](https://github.com/openclaw/openclaw/pull/44860) feat(extensions): add security-shield plugin (@Yapie0)
- [#44736](https://github.com/openclaw/openclaw/pull/44736) fix(sandbox): detect silent data loss in write_atomic on fakeowner/network mounts, fix #44657 (@haoruilee)
- [#44098](https://github.com/openclaw/openclaw/pull/44098) fix(security): add default pidsLimit for sandbox containers (@Jackey0903)
- [#43212](https://github.com/openclaw/openclaw/pull/43212) docs(security): add Security Defaults Audit and Hardening Guide (@chengjialu8888)
- [#42906](https://github.com/openclaw/openclaw/pull/42906) fix(security): block non-self messages in WhatsApp self-chat mode (@LakshmanTurlapati)
- [#42810](https://github.com/openclaw/openclaw/pull/42810) feat(acp): add audit logging system for control plane security (@ahua2020qq)

---
