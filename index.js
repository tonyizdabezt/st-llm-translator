import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";
import { eventSource, event_types, saveSettingsDebounced, updateMessageBlock } from "../../../../script.js";
import { ConnectionManagerRequestService } from "../../shared.js";
import { SlashCommand } from "../../../slash-commands/SlashCommand.js";
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from "../../../slash-commands/SlashCommandArgument.js";
import { SlashCommandParser } from "../../../slash-commands/SlashCommandParser.js";

const extensionName = "st-llm-translator";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

const autoModeOptions = {
    NONE: 'none',
    RESPONSES: 'responses',
    INPUTS: 'inputs',
    BOTH: 'both'
};

const defaultPromptTemplate = `Translate the following text to {{language}}. Only output the translation, nothing else.

Text to translate:
{{targetmessage}}`;

const defaultSettings = {
    targetLanguage: "English",
    profileId: "",
    selectedPresetIndex: 0,
    promptPresets: [
        {
            name: "Default",
            prompt: defaultPromptTemplate
        }
    ],
    filterCodeBlock: false,
    autoMode: autoModeOptions.NONE,
    maxTokens: 1024
};

async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
    
    if (!extension_settings[extensionName].promptPresets) {
        extension_settings[extensionName].promptPresets = defaultSettings.promptPresets;
        extension_settings[extensionName].selectedPresetIndex = 0;
    }
    
    if (!extension_settings[extensionName].autoMode) {
        extension_settings[extensionName].autoMode = autoModeOptions.NONE;
    }
    
    if (!extension_settings[extensionName].maxTokens) {
        extension_settings[extensionName].maxTokens = 1024;
    }
    
    $("#llm_translator_language").val(extension_settings[extensionName].targetLanguage);
    $("#llm_translator_filter_codeblock").prop("checked", extension_settings[extensionName].filterCodeBlock);
    $("#llm_translator_auto_mode").val(extension_settings[extensionName].autoMode);
    $("#llm_translator_max_tokens").val(extension_settings[extensionName].maxTokens);
    
    updatePresetDropdown();
}

function updatePresetDropdown() {
    const settings = extension_settings[extensionName];
    const $dropdown = $("#llm_translator_preset");
    $dropdown.empty();
    
    settings.promptPresets.forEach((preset, index) => {
        $dropdown.append(`<option value="${index}">${preset.name}</option>`);
    });
    
    $dropdown.val(settings.selectedPresetIndex);
    updatePromptTextarea();
}

function updatePromptTextarea() {
    const settings = extension_settings[extensionName];
    const preset = settings.promptPresets[settings.selectedPresetIndex];
    if (preset) {
        $("#llm_translator_prompt").val(preset.prompt);
    }
}

function onLanguageChange(event) {
    const value = $(event.target).val();
    extension_settings[extensionName].targetLanguage = value;
    saveSettingsDebounced();
}

function onProfileChange(profile) {
    const profileId = profile?.id || "";
    extension_settings[extensionName].profileId = profileId;
    saveSettingsDebounced();
}

function onPresetChange(event) {
    const index = parseInt($(event.target).val());
    extension_settings[extensionName].selectedPresetIndex = index;
    saveSettingsDebounced();
    updatePromptTextarea();
}

function onPromptChange(event) {
    const settings = extension_settings[extensionName];
    const value = $(event.target).val();
    settings.promptPresets[settings.selectedPresetIndex].prompt = value;
    saveSettingsDebounced();
}

function onFilterCodeBlockChange(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].filterCodeBlock = value;
    saveSettingsDebounced();
}

function onAutoModeChange(event) {
    const value = $(event.target).val();
    extension_settings[extensionName].autoMode = value;
    saveSettingsDebounced();
}

function onMaxTokensChange(event) {
    const value = parseInt($(event.target).val()) || 1024;
    extension_settings[extensionName].maxTokens = value;
    saveSettingsDebounced();
}

function shouldAutoTranslate(types) {
    const autoMode = extension_settings[extensionName]?.autoMode || autoModeOptions.NONE;
    return types.includes(autoMode);
}

async function autoTranslateIncoming(messageId) {
    const context = getContext();
    const message = context.chat[messageId];
    
    if (!message || message.is_user) {
        return;
    }
    
    if (message.extra?.llm_translated) {
        return;
    }
    
    if (!extension_settings[extensionName].profileId) {
        return;
    }
    
    const originalText = message.mes;
    if (!originalText?.trim()) {
        return;
    }
    
    try {
        const translation = await translateText(originalText);
        
        if (translation) {
            if (typeof message.extra !== 'object') {
                message.extra = {};
            }
            message.extra.display_text = translation;
            message.extra.llm_translated = true;
            updateMessageBlock(Number(messageId), message);
            await context.saveChat();
        }
    } catch (error) {
        console.error(`[${extensionName}] Auto-translate error:`, error);
    }
}

async function autoTranslateOutgoing(messageId) {
    const context = getContext();
    const message = context.chat[messageId];
    
    if (!message || !message.is_user) {
        return;
    }
    
    if (message.extra?.llm_translated) {
        return;
    }
    
    if (!extension_settings[extensionName].profileId) {
        return;
    }
    
    const originalText = message.mes;
    if (!originalText?.trim()) {
        return;
    }
    
    try {
        const translation = await translateText(originalText);
        
        if (translation) {
            if (typeof message.extra !== 'object') {
                message.extra = {};
            }
            message.extra.display_text = originalText;
            message.extra.llm_translated = true;
            message.mes = translation;
            updateMessageBlock(Number(messageId), message);
            await context.saveChat();
        }
    } catch (error) {
        console.error(`[${extensionName}] Auto-translate error:`, error);
    }
}

async function handleIncomingMessage(messageId) {
    const incomingTypes = [autoModeOptions.RESPONSES, autoModeOptions.BOTH];
    if (shouldAutoTranslate(incomingTypes)) {
        await autoTranslateIncoming(messageId);
    }
}

async function handleOutgoingMessage(messageId) {
    const outgoingTypes = [autoModeOptions.INPUTS, autoModeOptions.BOTH];
    if (shouldAutoTranslate(outgoingTypes)) {
        await autoTranslateOutgoing(messageId);
    }
}

function onNewPreset() {
    const name = prompt("Enter preset name:", "New Preset");
    if (!name) return;
    
    const settings = extension_settings[extensionName];
    settings.promptPresets.push({
        name: name,
        prompt: defaultPromptTemplate
    });
    settings.selectedPresetIndex = settings.promptPresets.length - 1;
    saveSettingsDebounced();
    updatePresetDropdown();
}

function onRenamePreset() {
    const settings = extension_settings[extensionName];
    const preset = settings.promptPresets[settings.selectedPresetIndex];
    const name = prompt("Enter new name:", preset.name);
    if (!name) return;
    
    preset.name = name;
    saveSettingsDebounced();
    updatePresetDropdown();
}

function onDeletePreset() {
    const settings = extension_settings[extensionName];
    
    if (settings.promptPresets.length <= 1) {
        toastr.warning("Cannot delete the last preset", "LLM Translator");
        return;
    }
    
    const preset = settings.promptPresets[settings.selectedPresetIndex];
    if (!confirm(`Delete preset "${preset.name}"?`)) return;
    
    settings.promptPresets.splice(settings.selectedPresetIndex, 1);
    settings.selectedPresetIndex = Math.max(0, settings.selectedPresetIndex - 1);
    saveSettingsDebounced();
    updatePresetDropdown();
}

function extractFromCodeBlock(text) {
    if (!extension_settings[extensionName].filterCodeBlock) {
        return text;
    }
    
    let result = text;
    
    const codeBlockMatch = result.match(/^[\s\S]*?```[\w]*\r?\n?([\s\S]*?)```[\s\S]*$/);
    if (codeBlockMatch) {
        result = codeBlockMatch[1];
    } else {
        result = result.replace(/^```[\w]*\r?\n?/gm, '');
        result = result.replace(/\r?\n?```$/gm, '');
    }
    
    const inlineCodeMatch = result.match(/^`([^`]+)`$/);
    if (inlineCodeMatch) {
        result = inlineCodeMatch[1];
    }
    
    return result.trim();
}

async function translateText(text) {
    const settings = extension_settings[extensionName];
    
    if (!settings.profileId) {
        toastr.error("Please select a Connection Profile first", "LLM Translator");
        return null;
    }
    
    if (!settings.targetLanguage) {
        toastr.error("Please set a target language first", "LLM Translator");
        return null;
    }
    
    const preset = settings.promptPresets[settings.selectedPresetIndex];
    if (!preset) {
        toastr.error("No prompt preset selected", "LLM Translator");
        return null;
    }
    
    const prompt = preset.prompt
        .replace(/\{\{language\}\}/g, settings.targetLanguage)
        .replace(/\{\{targetmessage\}\}/g, text);
    
    try {
        const result = await ConnectionManagerRequestService.sendRequest(
            settings.profileId,
            prompt,
            settings.maxTokens || 1024
        );
        
        let translation = result?.content || result?.text || result;
        
        translation = extractFromCodeBlock(translation);
        
        return translation;
    } catch (error) {
        console.error(`[${extensionName}] Translation error:`, error);
        toastr.error(`Translation failed: ${error.message}`, "LLM Translator");
    }
}

async function onMessageTranslateClick() {
    const $mes = $(this).closest('.mes');
    const messageId = $mes.attr('mesid');
    const context = getContext();
    const message = context.chat[messageId];
    
    if (!message) {
        return;
    }
    
    const originalText = message.mes;
    
    if (!originalText || !originalText.trim()) {
        return;
    }
    
    if (message.extra?.llm_translated) {
        delete message.extra.display_text;
        delete message.extra.llm_translated;
        updateMessageBlock(Number(messageId), message);
        await context.saveChat();
        return;
    }
    
    const $button = $(this);
    const originalIcon = $button.find('i').attr('class');
    $button.find('i').attr('class', 'fa-solid fa-spinner fa-spin');
    
    try {
        const translation = await translateText(originalText);
        
        if (translation) {
            if (typeof message.extra !== 'object') {
                message.extra = {};
            }
            message.extra.display_text = translation;
            message.extra.llm_translated = true;
            
            updateMessageBlock(Number(messageId), message);
            await context.saveChat();
        }
    } finally {
        $button.find('i').attr('class', originalIcon);
    }
}

function addTranslateButtons() {
    $('#chat .mes').each(function() {
        const $extraButtons = $(this).find('.extraMesButtons');
        if ($extraButtons.length && !$extraButtons.find('.mes_llm_translate').length) {
            const button = `<div title="LLM Translate" class="mes_button mes_llm_translate fa-solid fa-globe" data-i18n="[title]LLM Translate" style="color: #8bc34a;"></div>`;
            $extraButtons.prepend(button);
        }
    });
}

function initConnectionDropdown() {
    try {
        ConnectionManagerRequestService.handleDropdown(
            "#llm_translator_profile",
            extension_settings[extensionName].profileId,
            onProfileChange,  // onChange
            onProfileChange,  // onCreate
            () => {},         // onUpdate
            onProfileChange   // onDelete
        );
    } catch (error) {
        console.warn(`[${extensionName}] Connection Manager not available:`, error.message);
        $("#llm_translator_profile_block").html(
            '<p class="error"><small>⚠️ Connection Manager extension is required but not available.</small></p>'
        );
    }
}

jQuery(async () => {
    try {
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        
        $("#extensions_settings2").append(settingsHtml);
        
        await loadSettings();
        
        $("#llm_translator_language").on("input", onLanguageChange);
        $("#llm_translator_preset").on("change", onPresetChange);
        $("#llm_translator_prompt").on("input", onPromptChange);
        $("#llm_translator_filter_codeblock").on("input", onFilterCodeBlockChange);
        $("#llm_translator_auto_mode").on("change", onAutoModeChange);
        $("#llm_translator_max_tokens").on("input", onMaxTokensChange);
        $("#llm_translator_new_preset").on("click", onNewPreset);
        $("#llm_translator_rename_preset").on("click", onRenamePreset);
        $("#llm_translator_delete_preset").on("click", onDeletePreset);
        
        $(document).on('click', '.mes_llm_translate', onMessageTranslateClick);
        
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, handleIncomingMessage);
        eventSource.on(event_types.USER_MESSAGE_RENDERED, handleOutgoingMessage);
        eventSource.on(event_types.MESSAGE_SWIPED, handleIncomingMessage);
        
        addTranslateButtons();
        
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.addedNodes.length) {
                    addTranslateButtons();
                }
            }
        });
        
        const chatContainer = document.getElementById('chat');
        if (chatContainer) {
            observer.observe(chatContainer, { childList: true, subtree: true });
        }
        
        initConnectionDropdown();
        
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'llm-translate',
            helpString: 'Translate text using the configured LLM API. If no text is provided, translates the latest message. Uses the current extension settings for language and prompt.',
            namedArgumentList: [
                new SlashCommandNamedArgument(
                    'lang',
                    'Override the target language (e.g., "Japanese", "Spanish")',
                    ARGUMENT_TYPE.STRING,
                    false,
                    false,
                    ''
                ),
            ],
            unnamedArgumentList: [
                new SlashCommandArgument(
                    'The text to translate (optional)',
                    ARGUMENT_TYPE.STRING,
                    false, // Not required anymore
                    false,
                    ''
                ),
            ],
            callback: async (args, value) => {
                const context = getContext();
                const settings = extension_settings[extensionName];
                const originalLang = settings.targetLanguage;
                
                if (args?.lang) {
                    settings.targetLanguage = String(args.lang);
                }
                
                let textToTranslate = value ? String(value).trim() : '';
                let messageId = null;
                let message = null;
                
                if (!textToTranslate) {
                    const chat = context.chat;
                    if (chat && chat.length > 0) {
                        messageId = chat.length - 1;
                        message = chat[messageId];
                        textToTranslate = message.mes || '';
                    }
                }
                
                if (!textToTranslate) {
                    return '';
                }
                
                try {
                    const result = await translateText(textToTranslate);
                    
                    if (result && message !== null && messageId !== null) {
                        if (typeof message.extra !== 'object') {
                            message.extra = {};
                        }
                        message.extra.display_text = result;
                        message.extra.llm_translated = true;
                        updateMessageBlock(Number(messageId), message);
                        await context.saveChat();
                    }
                    
                    return result || '';
                } finally {
                    settings.targetLanguage = originalLang;
                }
            },
            returns: ARGUMENT_TYPE.STRING,
        }));
        
        console.log(`[${extensionName}] ✅ Loaded successfully`);
    } catch (error) {
        console.error(`[${extensionName}] ❌ Failed to load:`, error);
    }
});
