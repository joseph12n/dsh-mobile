# Screenshots

Every screenshot comes from the demo host (`tools/preview/fake-host.mjs`): fake sessions, a fake
provider and fake devices. No real workspace, provider key or session title appears.

Captured at 390×844 (the list also at 360×640), 2× scale.

## 1. Pairing

![Pairing](assets/screenshots/01-pairing.png)

The pairing screen. The QR link does this automatically; the code and the host are for when the
camera is not at hand.

## 2. Sessions

![Sessions](assets/screenshots/02-sessions.png)

The folder list with the session state, the waiting-question dot and the model of each row.

## 3. Conversation, usage and a permission card

![Conversation](assets/screenshots/03-conversation.png)

The transcript with the model selector and the **usage chips**: context used over the window
(`64.0k/131.1k · 49%`), the cache-hit ratio (`74%`) and the decode speed (`41.0 tok/s`). Below,
the activity strip and a permission card answered inline.

## 4. Agent activity

![Activity](assets/screenshots/04-activity.png)

The goal, its round, the subagents and the tasks inside the panel. The panel floats over the
conversation; the transcript keeps its height.

## 5. File viewer

![File viewer](assets/screenshots/05b-file-viewer.png)

The Markdown viewer opened from a path in the conversation: headings, lists, tables and code
are sanitized (no raw HTML), and the back button returns to the turn. Images open as they are;
PDFs and Office files (converted by the host) are drawn page by page with pdf.js, so a phone
shows the document instead of asking for a download, and an "open the document" link stays as a
fallback. Paths render as cards, never as `<img>`: a workspace path has no URL in the app, so the
bytes always come from the host. A relative link inside the document opens the next file in the
same viewer instead of leaving the app.

## 6. Slash commands

![Commands](assets/screenshots/06-commands.png)

The `/` palette from the composer. The result appears above the composer and does not enter the
model transcript.

## 7. Model providers

![Providers](assets/screenshots/07-providers.png)

Settings → Model providers: the catalog, the credential state of each provider and the
add-key/connect actions. The key stays on the host.

## 8. Paired devices

![Devices](assets/screenshots/08-devices.png)

The paired list with the last-seen time and revoke. "Forget this device" revokes on the host
before clearing the phone.

## 9. Notifications

![Notifications](assets/screenshots/09-notifications.png)

The push switch with the blocked, unsupported, insecure and iOS states explained inline.

## 10. Narrow list

![Narrow list](assets/screenshots/10-sessions-360.png)

The session list at 360×640.

The set is regenerated with `tools/preview`; see the README's Development section.
