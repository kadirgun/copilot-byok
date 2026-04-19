import * as vscode from "vscode";

export interface ProviderConfig {
  id: string;
  name: string;
  type: "openai" | "anthropic";
  baseURL?: string;
  apiKeySecretKey?: string;
  models: string[];
  enabled: boolean;
}

export interface StoredProviderConfig {
  id: string;
  name: string;
  type: "openai" | "anthropic";
  baseURL?: string;
  models: string[];
  enabled: boolean;
}

export const PROVIDER_VENDOR_ID = "copilot-byok";
export const CONFIG_COMMAND = "copilot-byok.configure";

export function createLanguageModelError(message: string, code: string, _cause?: Error): vscode.LanguageModelError {
  // @ts-expect-error - VS Code API farklı sürümlerde değişebilir
  return vscode.LanguageModelError.create(message, code);
}
