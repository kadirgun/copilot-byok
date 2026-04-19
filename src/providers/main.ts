import * as vscode from "vscode";
import type { ProviderConfig } from "../types";
import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";

export class MainProvider implements vscode.LanguageModelChatProvider {
  private providers: Map<string, vscode.LanguageModelChatProvider> = new Map();

  constructor(
    configs: ProviderConfig[],
    private readonly context: vscode.ExtensionContext,
  ) {
    this.reload(configs);
  }

  reload(configs: ProviderConfig[]): void {
    this.providers.clear();

    for (const config of configs) {
      if (!config.enabled) {
        continue;
      }

      const provider =
        config.type === "anthropic"
          ? new AnthropicProvider(config, this.context)
          : new OpenAIProvider(config, this.context);

      this.providers.set(config.name, provider);
    }
  }

  private getProvider(group?: string): vscode.LanguageModelChatProvider | undefined {
    if (group && this.providers.has(group)) {
      return this.providers.get(group);
    }

    return this.providers.values().next().value;
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean; group?: string },
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const provider = this.getProvider(options.group);
    if (!provider) {
      return [];
    }

    console.log(options);

    const models = await provider.provideLanguageModelChatInformation({ silent: options.silent }, token);

    return models || [];
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const group = model.detail;
    const provider = this.getProvider(group);
    if (!provider) {
      throw new Error(`No provider registered for group ${group ?? "<default>"}`);
    }

    return provider.provideLanguageModelChatResponse(model, messages, options, progress, token);
  }

  async provideTokenCount(
    model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    token: vscode.CancellationToken,
  ): Promise<number> {
    const group = model.detail;
    const provider = this.getProvider(group);
    if (!provider) {
      return 0;
    }

    return provider.provideTokenCount(model, text, token);
  }
}
