"""RBAC permission checker."""

# URL prefix → permission category
PATH_MAP = {
    "chat": "chat", "api": "chat", "whoami": "chat",
    "tools": "tools", "skills": "skills",
    "cron": "cron.read", "config": "config",
    "sessions": "chat", "agents": "chat",
}

def check_permission(roles, role_name, path):
    role = roles.get(role_name, {})
    perms = role.get("permissions", [])
    if "*" in perms:
        return True
    parts = path.strip("/").split("/")
    category = parts[0] if parts else ""
    needed = PATH_MAP.get(category, category)
    return needed in perms
