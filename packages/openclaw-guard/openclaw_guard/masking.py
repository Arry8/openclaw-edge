"""Mask sensitive fields in JSON response bodies."""
import json

def _mask(v):
    if isinstance(v, str) and len(v) > 4:
        return v[:2] + "*" * (len(v) - 4) + v[-2:]
    return "****"

def mask_dict(data, fields):
    if isinstance(data, dict):
        return {k: (_mask(v) if any(f in k.lower() for f in fields) else mask_dict(v, fields))
                for k, v in data.items()}
    if isinstance(data, list):
        return [mask_dict(i, fields) for i in data]
    return data

def mask_body(body, fields):
    if not fields or not body:
        return body
    try:
        data = json.loads(body)
        return json.dumps(mask_dict(data, fields)).encode()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return body
