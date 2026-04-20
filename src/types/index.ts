import type { LanguageModelChatInformation } from "vscode";
import * as vscode from "vscode";

export type ModelConfig = Pick<
  LanguageModelChatInformation,
  "id" | "name" | "maxInputTokens" | "maxOutputTokens" | "capabilities"
>;
export interface ProviderConfig {
  id: string;
  name: string;
  type: "openai" | "anthropic";
  baseURL?: string;
  apiKeySecretKey: string;
  models: ModelConfig[];
}

export const PROVIDER_VENDOR_ID = "copilot-byok";

export function createLanguageModelError(message: string, code: string, _cause?: Error): vscode.LanguageModelError {
  // @ts-expect-error - VS Code API farklı sürümlerde değişebilir
  return vscode.LanguageModelError.create(message, code);
}

declare module "vscode" {
  interface LanguageModelChatInformation {
    isUserSelectable?: boolean;
    groupId: string;
  }

  interface LanguageModelChatCapabilities {
    thinking?: boolean;
  }

  class LanguageModelThinkingPart {
    constructor(value: string, metadata?: Record<string, unknown>);
    readonly value: string;
    readonly metadata?: Record<string, unknown>;
  }
}
