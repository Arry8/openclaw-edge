"""Load, validate, and manage guard config."""
import yaml, os, hashlib, secrets

DEFAULT_CONFIG = """\
gateway:
  upstream: "http://localhost:18789"
  listen: "0.0.0.0"
  port: 8800

roles:
  admin:
    permissions: ["*"]
  user:
    permissions: ["chat", "tools", "skills", "cron.read"]
    mask_fields: ["api_key", "token", "secret", "password", "pat"]
  guest:
    permissions: ["chat"]
    mask_fields: ["api_key", "token", "secret", "password", "pat"]

users: []
# Example:
#   - name: admin
#     token_hash: "<run 'openclaw-guard add-user admin admin' to generate>"
#     role: admin

audit:
  enabled: true
  file: "audit.log"
"""

def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()

def load_config(path):
    if not os.path.exists(path):
        raise FileNotFoundError(f"Config not found: {path}. Run 'openclaw-guard init' first.")
    with open(path) as f:
        cfg = yaml.safe_load(f)
    cfg.setdefault("gateway", {})
    cfg["gateway"].setdefault("upstream", "http://localhost:18789")
    cfg["gateway"].setdefault("listen", "0.0.0.0")
    cfg["gateway"].setdefault("port", 8800)
    cfg.setdefault("roles", {})
    cfg.setdefault("users", [])
    cfg.setdefault("audit", {"enabled": True, "file": "audit.log"})
    # index users by token_hash
    cfg["_user_index"] = {u["token_hash"]: u for u in cfg["users"] if "token_hash" in u}
    return cfg

def save_config(path, cfg):
    # strip internal keys
    out = {k: v for k, v in cfg.items() if not k.startswith("_")}
    with open(path, "w") as f:
        yaml.dump(out, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

def init_config(path="config/guard.yaml"):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    if os.path.exists(path):
        print(f"Config already exists: {path}")
        return
    with open(path, "w") as f:
        f.write(DEFAULT_CONFIG)
    print(f"Created {path}")

def add_user(config_path, name, role, token=None):
    cfg = load_config(config_path)
    token = token or secrets.token_urlsafe(24)
    th = hash_token(token)
    # check duplicate
    for u in cfg["users"]:
        if u["name"] == name:
            print(f"User '{name}' already exists.")
            return
    cfg["users"].append({"name": name, "token_hash": th, "role": role})
    save_config(config_path, cfg)
    print(f"Added user '{name}' (role={role})")
    print(f"Token (save this, shown only once): {token}")
