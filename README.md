# LLM Translator

A SillyTavern extension that translates chat messages using your configured LLM APIs.

## Features

- **LLM-Powered Translation**: Uses your existing LLM API connections (via Connection Profiles) for translation
- **Customizable Prompts**: Create and manage multiple prompt presets with placeholders
- **Auto Mode**: Automatically translate incoming/outgoing messages
- **Manual Translation**: On-demand translation via message buttons or slash commands
- **Code Block Filter**: Option to extract text from code blocks in LLM responses

## Configuration

1. Open **Extensions** → **LLM Translator**
2. Set your **Target Language** (e.g., "English", "Japanese", "Spanish")
3. Select a **Connection Profile**
4. Choose an **Auto Mode**:
   - **None**: Manual translation only
   - **Responses**: Auto-translate character messages
   - **Inputs**: Auto-translate your messages
   - **Both**: Translate all messages

## Usage

### Message Button
- Hover over any message
- Click the **"..."** button to reveal extra options
- Click the **green language icon** to translate
- Click again to revert to original

### Slash Command
```
/llm-translate Hello, how are you?
/llm-translate lang=Japanese Hello, how are you?
/llm-translate
```

If no text is provided, translates the latest message in the chat.

### Prompt Presets

Create custom translation prompts using placeholders:
- `{{language}}` - Target language
- `{{targetmessage}}` - Text to translate


## Options

| Option | Description |
|--------|-------------|
| **Target Language** | The language to translate messages into |
| **Connection Profile** | Which LLM API to use for translation |
| **Auto Mode** | When to automatically translate |
| **Prompt Preset** | Which translation prompt template to use |
| **Filter Code Block** | Extract text from code blocks in responses |

### Debug mode

The response inspector opens on screen; close it to continue chatting and use the floating **Debug** button to reopen it. On desktop it is a floating panel, and on mobile it uses the bottom of the screen. Closing the panel keeps capture running; **Stop capture** or the settings checkbox disables capture.

The inspector records translation results (before code-block filtering), rendered assistant chat messages, browser console output and uncaught errors, and recognized `fetch` generation responses. Network entries include HTTP status, elapsed time, raw JSON/text or streamed SSE, and available model/provider authentication settings. Other extensions are covered when they use those generation endpoints or browser console methods. Expand entries to read them, filter by source or error, clear history, or download a JSON log.

Capture is browser-side: it cannot read server-only terminal logs, earlier activity, WebSocket/XHR traffic, or requests made through a previously cached `fetch` function. Custom endpoints without a recognized generation path may not appear. Streaming entries preserve the raw event data; the Chat and Translation filters show readable final output when available.

Logs remain in this tab's memory, with up to 100 entries and about 5 million characters total. Individual responses are limited to 1,048,576 characters; truncation is marked. Common credential fields are redacted, but logs can contain private chat content and unrecognized credentials. Review downloaded logs before sharing. Reloading clears the logs; the debug toggle is saved.

## License

MIT License - See [LICENSE](LICENSE) for details.
