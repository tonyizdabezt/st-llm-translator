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

## License

MIT License - See [LICENSE](LICENSE) for details.
