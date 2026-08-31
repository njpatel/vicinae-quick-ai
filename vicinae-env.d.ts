/// <reference types="@vicinae/api">

/*
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 */

type ExtensionPreferences = {
  /** API Base URL - OpenAI-compatible base URL. Leave empty to use codex-pooled (CLIProxyAPI from ~/codex-pooled/config.toml). */
	"baseUrl": string;

	/** API Key - Bearer token. Leave empty to use the codex-pooled token from ~/.bashrc. */
	"apiKey": string;

	/** Fallback Model - Used only when no model has been picked with Select AI Model. Leave empty to use the codex-pooled default. */
	"model": string;

	/** Primary Action on Answers - What Enter does on an answer (Raycast defaults to paste) */
	"primaryAction": "paste" | "copy";

	/** Sidebar Conversations - How many recent conversations to show in the Quick AI sidebar */
	"sidebarCount": string;

	/** Continue Last Chat Within (minutes) - 0 (default) = every launch starts a new chat; pick recent ones from the sidebar. N = a launch within N minutes continues the last chat. "never" = always continue. */
	"newChatMinutes": string;

	/** System Prompt - Sets the answer style */
	"systemPrompt": string;
}

declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Command: Ask AI */
	export type Ask = ExtensionPreferences & {
		
	}

	/** Command: Ask AI about Selection */
	export type AskSelection = ExtensionPreferences & {
		
	}

	/** Command: Ask AI about Clipboard */
	export type AskClipboard = ExtensionPreferences & {
		
	}

	/** Command: Select AI Model */
	export type ModelList = ExtensionPreferences & {
		
	}

	/** Command: Quick AI History */
	export type History = ExtensionPreferences & {
		
	}

	/** Command: AI Presets */
	export type Presets = ExtensionPreferences & {
		
	}

	/** Command: AI Commands */
	export type AiCommands = ExtensionPreferences & {
		
	}
}

declare namespace Arguments {
  /** Command: Ask AI */
	export type Ask = {
		/** Ask anything… */
		"query": string
	}

	/** Command: Ask AI about Selection */
	export type AskSelection = {
		/** Ask about the selection… */
		"query": string
	}

	/** Command: Ask AI about Clipboard */
	export type AskClipboard = {
		/** Ask about the clipboard… */
		"query": string
	}

	/** Command: Select AI Model */
	export type ModelList = {
		
	}

	/** Command: Quick AI History */
	export type History = {
		
	}

	/** Command: AI Presets */
	export type Presets = {
		
	}

	/** Command: AI Commands */
	export type AiCommands = {
		
	}
}