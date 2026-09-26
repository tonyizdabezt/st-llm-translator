const MAX_ENTRY = 1024 * 1024;
const MAX_TOTAL = 5 * MAX_ENTRY;
const MAX_ENTRIES = 100;
const SECRET_KEY = /authorization|cookie|password|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|client[_-]?secret|service[_-]?account/i;

function redactText(value) {
    return value
        .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]')
        .replace(/\bBearer\s+[^\s"',}]+/gi, 'Bearer [REDACTED]')
        .replace(/(["']?(?:authorization|cookie|password|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|client[_-]?secret)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s&,}]+)/gi, '$1"[REDACTED]"')
        .replace(/([?&](?:key|token|api_key|access_token)=)[^&#\s]+/gi, '$1[REDACTED]');
}

export function debugText(value) {
    const seen = new WeakSet();
    let remaining = MAX_ENTRY;
    let nodes = 0;
    function clean(item, depth = 0) {
        if (++nodes > 2000 || remaining <= 0) return '[Inspection limit]';
        if (typeof item === 'string') {
            const text = item.slice(0, remaining);
            remaining -= text.length;
            return redactText(text) + (text.length < item.length ? '\n[Truncated: character limit]' : '');
        }
        if (typeof item === 'bigint') return String(item);
        if (!item || typeof item !== 'object') return item;
        if (seen.has(item)) return '[Circular]';
        if (depth > 8) return '[Depth limit]';
        seen.add(item);
        if (item instanceof Error || Object.prototype.toString.call(item) === '[object Error]') {
            return { name: item.name, message: clean(item.message), stack: clean(item.stack), cause: clean(item.cause, depth + 1) };
        }
        const result = Array.isArray(item) ? [] : {};
        for (const key of Object.keys(item).slice(0, 200)) {
            try { result[key] = SECRET_KEY.test(key) ? '[REDACTED]' : clean(item[key], depth + 1); }
            catch { result[key] = '[Unreadable]'; }
        }
        return result;
    }
    try {
        const text = typeof value === 'string' ? redactText(value) : JSON.stringify(clean(value), null, 2) ?? String(value);
        return text.length > MAX_ENTRY ? `${text.slice(0, MAX_ENTRY)}\n[Truncated: 1 MiB character limit]` : text;
    } catch { return '[Unable to inspect value]'; }
}

export function generationUrl(input, base) {
    try {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, base);
        if (/\/(?:secrets|settings|presets|characters|chats)(?:\/|$)/i.test(url.pathname)) return null;
        if (!/(?:\/(?:generate|completions|responses|messages)(?:\/|$)|:(?:streamGenerateContent|generateContent)$)/i.test(url.pathname)) return null;
        return `${url.origin}${url.pathname}`;
    } catch { return null; }
}

export class DebugRecorder {
    constructor(env = globalThis) {
        this.env = env;
        this.entries = [];
        this.enabled = false;
        this.listeners = new Set();
        this.readers = new Set();
        this.sequence = 0;
        this.epoch = 0;
        this.dropped = 0;
    }

    notify() { for (const listener of this.listeners) { try { listener(); } catch { /* Debugging must not break generation. */ } } }

    add(kind, title, value, level = 'info') {
        if (!this.enabled) return null;
        const entry = { id: ++this.sequence, time: new Date().toISOString(), kind, title: debugText(title), level, text: debugText(value) };
        this.entries.push(entry);
        this.trim();
        this.notify();
        return entry;
    }

    trim() {
        let size = this.entries.reduce((total, entry) => total + entry.text.length, 0);
        while (this.entries.length > MAX_ENTRIES || size > MAX_TOTAL) {
            size -= this.entries.shift().text.length;
            this.dropped++;
        }
    }

    update(entry, title, value, level = entry?.level) {
        if (!this.enabled || !this.entries.includes(entry)) return;
        entry.title = debugText(title);
        entry.text = debugText(value);
        entry.level = level;
        this.trim();
        this.notify();
    }

    clear() {
        this.epoch++;
        this.cancelReaders();
        this.entries.length = 0;
        this.dropped = 0;
        this.notify();
    }

    cancelReaders() {
        for (const reader of this.readers) void reader.cancel().catch(() => {});
        this.readers.clear();
    }

    setEnabled(enabled) {
        if (this.enabled === enabled) return;
        this.enabled = enabled;
        this.epoch++;
        if (enabled) this.install();
        else {
            this.cancelReaders();
            this.env.removeEventListener?.('error', this.onError);
            this.env.removeEventListener?.('unhandledrejection', this.onRejection);
            if (this.env.fetch === this.fetchWrapper) this.env.fetch = this.originalFetch;
            for (const [level, wrapper] of Object.entries(this.consoleWrappers)) {
                if (this.env.console[level] === wrapper) this.env.console[level] = this.originalConsole[level];
            }
        }
        this.notify();
    }

    install() {
        const recorder = this;
        const installation = Symbol('debug hooks');
        this.installation = installation;
        const originalFetch = this.env.fetch;
        this.originalFetch = originalFetch;
        this.fetchWrapper = async function (...args) {
            const epoch = recorder.epoch;
            const url = recorder.enabled && recorder.installation === installation
                ? generationUrl(args[0], recorder.env.location?.href) : null;
            const entry = url ? recorder.add('network', `Pending · ${url}`, 'Waiting for response…') : null;
            if (entry && typeof args[1]?.body === 'string') {
                try {
                    const body = JSON.parse(args[1].body);
                    const metadata = {};
                    for (const key of ['model', 'chat_completion_source', 'api_type', 'stream', 'max_tokens', 'vertexai_auth_mode', 'vertexai_region']) {
                        if (body[key] !== undefined) metadata[key] = body[key];
                    }
                    entry.request = debugText(metadata);
                } catch {
                }
            }
            const started = Date.now();
            try {
                const response = await originalFetch.apply(this, args);
                if (entry && recorder.enabled && recorder.epoch === epoch) {
                    try {
                        void recorder.capture(response.clone(), entry, url, started, epoch).catch(error => {
                            if (recorder.epoch === epoch) recorder.update(entry, `Capture unavailable · ${url}`, error, 'warn');
                        });
                    }
                    catch (error) { recorder.update(entry, `Capture unavailable · ${url}`, error, 'warn'); }
                }
                return response;
            } catch (error) {
                if (entry && recorder.epoch === epoch) recorder.update(entry, `Request failed · ${url}`, error, 'error');
                throw error;
            }
        };
        this.env.fetch = this.fetchWrapper;
        this.onError = event => this.add('console', 'Uncaught browser error', event.error || event.message, 'error');
        this.onRejection = event => this.add('console', 'Unhandled promise rejection', event.reason, 'error');
        this.env.addEventListener?.('error', this.onError);
        this.env.addEventListener?.('unhandledrejection', this.onRejection);
        this.originalConsole = {};
        this.consoleWrappers = {};
        for (const level of ['log', 'info', 'debug', 'warn', 'error']) {
            const original = this.env.console[level];
            this.originalConsole[level] = original;
            const wrapper = function (...args) {
                if (recorder.enabled && recorder.installation === installation) {
                    recorder.add('console', `Console ${level}`, args, level);
                }
                return original.apply(this, args);
            };
            this.consoleWrappers[level] = wrapper;
            this.env.console[level] = wrapper;
        }
    }

    async capture(response, entry, url, started, epoch) {
        const level = response.ok ? 'info' : 'error';
        const title = `${response.status} ${response.statusText} · ${url}`;
        const type = response.headers.get('content-type') || '';
        if (type && !/json|text|xml/i.test(type)) {
            this.update(entry, title, `Body omitted (${type}).`, level);
            void response.body?.cancel().catch(() => {});
            return;
        }
        const reader = response.body?.getReader();
        if (!reader) { this.update(entry, title, '[Empty response]', level); return; }
        this.readers.add(reader);
        const decoder = new TextDecoder();
        let body = '';
        let lastUpdate = 0;
        let truncated = false;
        try {
            while (this.enabled && this.epoch === epoch && this.entries.includes(entry)) {
                const { value, done } = await reader.read();
                if (done) { body += decoder.decode(); break; }
                body += decoder.decode(value, { stream: true });
                if (body.length > MAX_ENTRY) {
                    body = body.slice(0, MAX_ENTRY);
                    truncated = true;
                    break;
                }
                if (Date.now() - lastUpdate > 250) {
                    this.update(entry, `${title} · receiving`, body, level);
                    lastUpdate = Date.now();
                }
            }
            if (this.enabled && this.epoch === epoch) {
                let content = body || '[Empty response]';
                if (!truncated) { try { content = JSON.parse(body); } catch { } }
                this.update(entry, `${title} · ${Date.now() - started} ms${truncated ? ' · truncated' : ''}`, content, level);
            }
        } catch (error) {
            if (this.enabled && this.epoch === epoch) this.update(entry, `${title} · stream interrupted`, { body, error }, 'error');
        } finally {
            this.readers.delete(reader);
            void reader.cancel().catch(() => {});
        }
    }
}

export function mountDebugViewer(recorder, onToggle) {
    const panel = document.createElement('section');
    panel.id = 'llm_debug_panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'llm_debug_title');
    panel.innerHTML = `
        <header><h3 id="llm_debug_title">Response inspector</h3><button type="button" data-action="close" aria-label="Close response inspector">✕</button></header>
        <div class="llm_debug_toolbar">
            <button type="button" data-action="toggle"></button>
            <button type="button" data-action="clear">Clear</button>
            <button type="button" data-action="export">Download logs</button>
            <label>Show <select aria-label="Filter debug entries"><option value="all">All entries</option><option value="error">Errors & warnings</option><option value="translation">Translations</option><option value="chat">Chat</option><option value="network">Network</option><option value="console">Console</option></select></label>
        </div>
        <p class="llm_debug_note">Browser responses and console output. Logs may contain chat content. Common credential fields are redacted.</p>
        <p class="llm_debug_status" role="status"></p>
        <div class="llm_debug_entries" tabindex="0" aria-label="Captured responses"></div>`;
    document.body.append(panel);
    const launcher = document.createElement('button');
    launcher.id = 'llm_debug_launcher';
    launcher.type = 'button';
    launcher.textContent = 'Debug';
    launcher.setAttribute('aria-controls', panel.id);
    document.body.append(launcher);
    const list = panel.querySelector('.llm_debug_entries');
    const filter = panel.querySelector('select');
    const nodes = new Map();
    let previousFocus;
    let timer;

    function render() {
        launcher.hidden = !recorder.enabled || !panel.hidden;
        if (panel.hidden) return;
        panel.querySelector('[data-action="toggle"]').textContent = recorder.enabled ? 'Stop capture' : 'Start capture';
        const entries = recorder.entries.filter(entry => filter.value === 'all'
            || (filter.value === 'error' ? ['error', 'warn'].includes(entry.level) : entry.kind === filter.value));
        const follow = list.scrollTop + list.clientHeight >= list.scrollHeight - 40;
        const ids = new Set(entries.map(entry => entry.id));
        for (const [id, node] of nodes) if (!ids.has(id)) { node.remove(); nodes.delete(id); }
        for (const entry of entries) {
            let node = nodes.get(entry.id);
            if (!node) {
                node = document.createElement('details');
                node.append(document.createElement('summary'), document.createElement('pre'));
                nodes.set(entry.id, node);
                list.append(node);
            }
            node.dataset.level = entry.level;
            node.querySelector('summary').textContent = `${new Date(entry.time).toLocaleTimeString()} · ${entry.kind} · ${entry.title}`;
            const pre = node.querySelector('pre');
            const content = entry.request ? `Request settings\n${entry.request}\n\nResponse\n${entry.text}` : entry.text;
            if (pre.textContent !== content) pre.textContent = content;
        }
        panel.querySelector('.llm_debug_status').textContent = `${recorder.enabled ? 'Capturing' : 'Stopped'} · ${entries.length} shown · ${recorder.dropped} older entries removed. ${recorder.entries.length ? 'Expand an entry to inspect it.' : 'No entries yet. Enable capture, then send a message.'}`;
        if (follow) list.scrollTop = list.scrollHeight;
    }

    function open() {
        previousFocus = document.activeElement;
        panel.hidden = false;
        render();
        panel.querySelector('[data-action="close"]').focus();
    }
    function close() {
        panel.hidden = true;
        render();
        if (previousFocus?.isConnected && !previousFocus.hidden) previousFocus.focus();
    }
    panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    });
    panel.addEventListener('click', event => {
        const action = event.target.closest('button')?.dataset.action;
        if (action === 'close') close();
        if (action === 'toggle') onToggle(!recorder.enabled);
        if (action === 'clear') recorder.clear();
        if (action === 'export') {
            const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), dropped: recorder.dropped, entries: recorder.entries }, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `sillytavern-debug-${Date.now()}.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    });
    filter.addEventListener('change', render);
    launcher.addEventListener('click', open);
    recorder.listeners.add(() => {
        if (!timer) timer = setTimeout(() => { timer = null; render(); }, 150);
    });
    render();
    return { open };
}
