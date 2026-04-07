"""Audit logger — append-only JSONL."""
import json, datetime

class AuditLog:
    def __init__(self, cfg):
        self.enabled = cfg.get("audit", {}).get("enabled", False)
        self.path = cfg.get("audit", {}).get("file", "audit.log")

    def log(self, user, action, path, status, detail=""):
        if not self.enabled:
            return
        entry = {"ts": datetime.datetime.utcnow().isoformat() + "Z",
                 "user": user, "action": action, "path": path, "status": status}
        if detail:
            entry["detail"] = detail
        with open(self.path, "a") as f:
            f.write(json.dumps(entry) + "\n")
