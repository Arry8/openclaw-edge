<!-- Authored by: cc (Claude Code) | 2026-03-30 -->

# openclaw-edge

**The integration build of [openclaw](https://github.com/openclaw/openclaw) — every open upstream PR merged onto a release tag.**

Modeled after [linux-next](https://www.kernel.org/doc/man-pages/linux-next.html): instead of waiting months for the upstream team to triage ~6,600 open pull requests, `openclaw-edge` merges everything that applies cleanly onto a fixed upstream release tag and ships a daily build.

---

## Disclaimer

`openclaw-edge` is not affiliated with the openclaw project or team. It is an independent integration experiment.

- **No stability guarantees.** This build includes unreviewed, untriaged PRs. It may break at any time.
- **Not for production use** without understanding what you are running (see Security below).
- The upstream source of truth is [openclaw/openclaw](https://github.com/openclaw/openclaw). All original work belongs to its authors.

---

## Security

**PRs merged here have not been code-reviewed or security-audited.** The only gate is that the build and type-check pass (`pnpm build` includes `tsc`). A PR that compiles cleanly can still contain malicious or broken logic.

**Specific risks:**
- A PR could exfiltrate API keys, session tokens, or conversation data to a third-party host
- A PR could introduce logic bugs, data corruption, or silent failures
- PRs are merged in priority-tier order (security/crash fixes first) but tier assignment is based on PR labels — not verified

**Mitigations in place:**
- Build and type-check must pass before any release is created
- PRs that break the build are automatically reverted and recorded
- A permanent skip list blocks known bad PRs
- PRs with git conflicts are skipped entirely (first writer wins)

**Recommendations for self-hosters:**
- Run inside Docker with `--restart unless-stopped` and no extra capabilities
- Do not expose the gateway port publicly without `OPENCLAW_GATEWAY_TOKEN` set
- Consider running behind a reverse proxy with TLS

### Egress firewall (optional but recommended)

Code-level scanning cannot reliably catch malicious code disguised as a legitimate API call. The only enforceable mitigation is restricting what the process can reach at the network level.

openclaw makes outbound calls to a well-known set of hosts (AI providers, ntfy.sh, GitHub). Anything outside that set — including attacker-controlled infrastructure — can be blocked at the container or host level.

**Options, in order of effort:**

| Option | Approach |
|---|---|
| **A — iptables in container** | Entrypoint script sets allowlist rules before starting the gateway. Requires `NET_ADMIN` cap temporarily, dropped before exec. |
| **B — Docker network + proxy** | Isolated Docker network with egress via a filtering proxy (e.g. Squid with an allowlist). More maintainable than raw iptables. |
| **C — Railway private networking** | Route egress through a proxy service on Railway's private network. Works with the existing Railway deployment. |
| **D — gVisor / Firecracker** | Run the image under `gVisor` (`runsc`) for syscall filtering, or Firecracker for full VM-level isolation. Highest overhead, strongest isolation. |

Known legitimate outbound destinations: `api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`, `api.mistral.ai`, `api.x.ai`, `api.tavily.com`, `ntfy.sh`, `api.github.com`, `github.com`.

---

## What's in this build

The `mega/latest` branch starts from upstream tag **`v2026.3.28`** and has every clean-merging open PR applied on top. Updated daily via GitHub Actions.

- All ~6,600 open PRs (`state=open`)
- Typical outcome: **~28%** of PRs merge cleanly; the remaining ~72% conflict and are skipped
- Every release includes a full changelog grouped by tier (Security / Crash → Fixes → Features → Other)

Latest release and changelog: [Releases](https://github.com/Arry8/openclaw-edge/releases)

---

## How it works

```
upstream release tag v2026.3.28 (fixed base)
        │
        ▼
  fetch all open PR refs  ──►  sort by priority tier
  (refs/pull/N/head)             1. security / crash
                                 2. fix
                                 3. feat
                                 4. other
        │
        ▼
  for each PR:
    git merge --no-commit --no-ff
    ├── clean    →  commit (--no-verify)  →  continue
    └── conflict →  abort  →  log         →  continue
        │
        ▼
  every 10 merges: pnpm build (bundler + tsc)
    ├── passes  →  continue
    └── fails   →  auto-skip: find culprit PR via git log --first-parent
                              revert merge commit
                              record in autoskip.json
                              retry build (up to 3×)
                   ├── fixed  →  continue
                   └── stuck  →  ntfy.sh alert → stop
        │
        ▼
  final pnpm build
        │
        ▼
  push mega/latest  →  fast-forward main
        │
        ▼
  create GH release  mega/YYYY-MM-DD-HHMM
```

---

## Using this build

### Docker (keep your existing openclaw data)

openclaw stores all user data in `~/.openclaw` on every platform (Mac, Windows, Linux). The Docker image mounts the same directory — your existing config, memories, and tools carry over automatically.

```sh
docker run -d \
  --name openclaw-edge \
  --restart unless-stopped \
  -p 18789:18789 \
  -v ~/.openclaw:/home/node/.openclaw \
  -e OPENCLAW_GATEWAY_TOKEN="" \
  ghcr.io/arry8/openclaw-edge:main
```

Connect a client to `http://localhost:18789`.

> Use the `main` tag — it is rebuilt daily. The `mega/YYYY-MM-DD` release tags do not have Docker images.

**Switching back to upstream openclaw:** stop the container and run the upstream image. The `~/.openclaw` volume is shared; no migration needed.

---

### Docker Compose

```yaml
services:
  openclaw-edge:
    image: ghcr.io/arry8/openclaw-edge:main
    restart: unless-stopped
    ports:
      - "${OPENCLAW_GATEWAY_PORT:-18789}:18789"
    volumes:
      - ${OPENCLAW_CONFIG_DIR:-~/.openclaw}:/home/node/.openclaw
    environment:
      OPENCLAW_GATEWAY_TOKEN: ${OPENCLAW_GATEWAY_TOKEN:-}
    cap_drop:
      - NET_RAW
      - NET_ADMIN
    security_opt:
      - no-new-privileges:true
```

```sh
docker compose up -d
```

Set `OPENCLAW_CONFIG_DIR` in a `.env` file if your data lives somewhere other than `~/.openclaw`.

---

### Config reference

| Setting | Default | Override |
|---|---|---|
| Data directory | `~/.openclaw` | `OPENCLAW_STATE_DIR` |
| Config file | `~/.openclaw/openclaw.json` | `OPENCLAW_CONFIG_PATH` |
| Gateway port | `18789` | `OPENCLAW_GATEWAY_PORT` |
| Docker image | `ghcr.io/arry8/openclaw-edge:main` | — |

---

## Automation

GitHub Actions runs daily at **08:00 UTC**. Each run merges as many PRs as possible within a 60-minute timeout (~250 PRs/run). On success, `mega/latest` and `main` are updated and a release tagged `mega/YYYY-MM-DD-HHMM` is created.

[![mega-merge](https://img.shields.io/github/actions/workflow/status/Arry8/openclaw-edge/mega-merge.yml?branch=mega%2Flatest&label=mega-merge&style=flat-square)](https://github.com/Arry8/openclaw-edge/actions/workflows/mega-merge.yml)

---

For details on running the merge script yourself, see [`docs/mega-merge-runbook.md`](docs/mega-merge-runbook.md).
