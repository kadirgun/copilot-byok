import type { LanguageModelChatInformation } from "vscode";
import * as vscode from "vscode";

export type ModelConfig = Pick<
  LanguageModelChatInformation,
  "id" | "name" | "maxInputTokens" | "maxOutputTokens" | "capabilities"
>;

export type ModalFormValue = string | number | boolean;

export interface ModalFormFieldMessages {
  required?: string;
  invalid?: string;
  notIn?: string;
  format?: string;
  pattern?: string;
  min?: string;
  max?: string;
  integer?: string;
}

interface ModalFormFieldBase {
  id: string;
  label: string;
  description?: string;
  required?: boolean;
  messages?: ModalFormFieldMessages;
  autofocus?: boolean;
}

export interface ModalFormTextInput extends ModalFormFieldBase {
  type: "text";
  value?: string;
  placeholder?: string;
  password?: boolean;
  trim?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: "url";
  notIn?: string[];
  autofocus?: boolean;
}

export interface ModalFormNumberInput extends ModalFormFieldBase {
  type: "number";
  value?: number;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  autofocus?: boolean;
}

export interface ModalFormSelectOption {
  label: string;
  value: string;
  description?: string;
}

export interface ModalFormSelectInput extends ModalFormFieldBase {
  type: "select";
  value?: string;
  options: ModalFormSelectOption[];
  autofocus?: boolean;
}

export interface ModalFormCheckboxInput extends ModalFormFieldBase {
  type: "checkbox";
  value?: boolean;
}

export type ModalFormField = ModalFormTextInput | ModalFormNumberInput | ModalFormSelectInput | ModalFormCheckboxInput;

export type ModalFormResult = Record<string, ModalFormValue | undefined>;

export interface ModalFormOptions {
  title?: string;
  description?: string;
  submitLabel?: string;
  cancelLabel?: string;
}

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
