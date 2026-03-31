---
summary: "Utopia support status, capabilities, and configuration"
read_when:
  - Working on Utopia features or webhooks
title: "Utopia"
---

# Utopia API

Status: production-ready for DMs. Webhook is used to subscribe to a message, REST is used to send messages to Utopia.

<CardGroup cols={3}>
  <Card title="Pairing" icon="link" href="/channels/pairing">
    Default DM policy for Utopia is pairing.
  </Card>
  <Card title="Channel troubleshooting" icon="wrench" href="/channels/troubleshooting">
    Cross-channel diagnostics and repair playbooks.
  </Card>
  <Card title="Gateway configuration" icon="settings" href="/gateway/configuration">
    Full channel config patterns and examples.
  </Card>
</CardGroup>

## Quick setup

<Steps>
  <Step title="Create the API token in Utopia">
    Open Utopia → Settings → API.

    Enable API access. Copy the Host (default: 127.0.0.1), Port (default: 20000), and Token.

    See: https://udocs.gitbook.io/utopia-api/utopia-api/how-to-enable-api-access

  </Step>

  <Step title="Copy the public key">
    Copy the public key of the account from which you will write requests to yourself.
  </Step>

  <Step title="Configure token and DM policy">

```json5
{
  channels: {
    utopia: {
      enabled: true,
      host: "127.0.0.1",
      port: 22659,
      apiToken: "YOUR_UTOPIA_API_TOKEN",
      wsPort: 25000,
      dmPolicy: "allowlist",
      allowFrom: ["ADMIN_PUBLIC_KEY_HERE"],
    },
  },
}
```

  </Step>

  <Step title="Start gateway and approve first DM">

```bash
openclaw gateway
openclaw pairing list utopia
openclaw pairing approve utopia <CODE>
```

    Pairing codes expire after 1 hour.

  </Step>
</Steps>

## Access control and activation

<Tabs>
  <Tab title="DM policy">
    `channels.utopia.dmPolicy` controls direct message access:

    - `pairing` (default)
    - `allowlist` (requires at least one sender ID in `allowFrom`)
    - `open` (requires `allowFrom` to include `"*"`)
    - `disabled`

    `channels.utopia.allowFrom` accepts string Utopia user public key.
    `dmPolicy: "allowlist"` with empty `allowFrom` blocks all DMs and is rejected by config validation.

    For one-owner accounts, prefer `dmPolicy: "allowlist"` with explicit string `allowFrom` public keys to keep access policy durable in config (instead of depending on previous pairing approvals).

    ### Finding your Utopia account public key

    1. Open Utopia.
    2. Go to your profile.
    3. Your public key (pk) is displayed there — it's a 64-character hex string.

  </Tab>

</Tabs>

## Feature reference

<AccordionGroup>
  <Accordion title="Formatting and HTML fallback">
    Messages must be text messages.
  </Accordion>
</AccordionGroup>

## Troubleshooting

<AccordionGroup>

  <Accordion title="Utopia API token not configured">

    - Ensure `apiToken` is set in your config

  </Accordion>

  <Accordion title="WebSocket disconnects / reconnects">

    - The plugin automatically reconnects with exponential backoff (5s → 60s max)
    - Ensure the Utopia client is running
    - Check that wsPort isn't busy with another process: `lsof -i :25000`

  </Accordion>

  <Accordion title="Utopia API HTTP error: 403">

    - The token is invalid or expired
    - Regenerate the token in Utopia Settings → API and update the configuration

  </Accordion>

  <Accordion title="Messages not being received">

    - Verify `dmPolicy` is not set to `disabled`
    - Check that the sender's pubkey is in `allowFrom` (if using `allowlist` policy)
    - Try setting WebSocket notifications to `all` for debugging:
    -- This can be done temporarily by modifying the `setWebSocketState` call.

  </Accordion>

  <Accordion title="Responses are not being sent">

    - Check the gateway logs for errors
    - Ensure the Utopia client is accessible via `host:port`
    - Run `openclaw channels status --probe`

  </Accordion>

</AccordionGroup>

## Utopia config reference pointers

Primary reference:

| Option      | Type     | Default     | Description                                                  |
| ----------- | -------- | ----------- | ------------------------------------------------------------ |
| `enabled`   | boolean  | `true`      | Enable/disable the Utopia channel                            |
| `host`      | string   | `127.0.0.1` | Utopia API host address                                      |
| `port`      | number   | `22659`     | Utopia API port                                              |
| `apiToken`  | string   | —           | API token from Utopia settings (required)                    |
| `wsPort`    | number   | `25000`     | WebSocket port for receiving notifications                   |
| `useSsl`    | boolean  | `false`     | Use HTTPS/WSS instead of HTTP/WS                             |
| `dmPolicy`  | string   | `pairing`   | Access policy: `pairing`, `allowlist`, `open`, or `disabled` |
| `allowFrom` | string[] | `[]`        | List of allowed sender public keys                           |
