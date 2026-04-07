"""Tests for openclaw-guard."""
import unittest, json, hashlib
from openclaw_guard.masking import mask_body, mask_dict
from openclaw_guard.permissions import check_permission
from openclaw_guard.config import hash_token

ROLES = {
    "admin": {"permissions": ["*"]},
    "user": {"permissions": ["chat", "tools", "skills", "cron.read"],
             "mask_fields": ["api_key", "token", "secret", "password"]},
    "guest": {"permissions": ["chat"]},
}

class TestPermissions(unittest.TestCase):
    def test_admin_wildcard(self):
        self.assertTrue(check_permission(ROLES, "admin", "/config/secrets"))
        self.assertTrue(check_permission(ROLES, "admin", "/anything"))

    def test_user_allowed(self):
        self.assertTrue(check_permission(ROLES, "user", "/chat/send"))
        self.assertTrue(check_permission(ROLES, "user", "/tools/list"))
        self.assertTrue(check_permission(ROLES, "user", "/skills/weather"))

    def test_user_denied(self):
        self.assertFalse(check_permission(ROLES, "user", "/config/secrets"))

    def test_guest_limited(self):
        self.assertTrue(check_permission(ROLES, "guest", "/chat/send"))
        self.assertFalse(check_permission(ROLES, "guest", "/tools/list"))
        self.assertFalse(check_permission(ROLES, "guest", "/config/anything"))

    def test_unknown_role(self):
        self.assertFalse(check_permission(ROLES, "nobody", "/chat"))

class TestMasking(unittest.TestCase):
    def test_mask_sensitive(self):
        data = {"openai_api_key": "sk-abc123xyz", "name": "test"}
        result = mask_dict(data, ["api_key"])
        self.assertNotEqual(result["openai_api_key"], "sk-abc123xyz")
        self.assertIn("*", result["openai_api_key"])
        self.assertEqual(result["name"], "test")

    def test_mask_nested(self):
        data = {"config": {"secret_token": "tok-999888", "label": "ok"}}
        result = mask_dict(data, ["token", "secret"])
        self.assertIn("*", result["config"]["secret_token"])
        self.assertEqual(result["config"]["label"], "ok")

    def test_mask_body_json(self):
        body = json.dumps({"password": "hunter2", "user": "bob"}).encode()
        result = mask_body(body, ["password"])
        parsed = json.loads(result)
        self.assertIn("*", parsed["password"])
        self.assertEqual(parsed["user"], "bob")

    def test_mask_body_non_json(self):
        body = b"not json"
        self.assertEqual(mask_body(body, ["password"]), body)

    def test_no_fields(self):
        body = json.dumps({"secret": "x"}).encode()
        self.assertEqual(mask_body(body, []), body)

class TestTokenHash(unittest.TestCase):
    def test_hash_deterministic(self):
        self.assertEqual(hash_token("test"), hash_token("test"))

    def test_hash_different(self):
        self.assertNotEqual(hash_token("a"), hash_token("b"))

    def test_hash_is_sha256(self):
        expected = hashlib.sha256(b"hello").hexdigest()
        self.assertEqual(hash_token("hello"), expected)

if __name__ == "__main__":
    unittest.main()
