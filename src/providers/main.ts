import * as vscode from "vscode";
import type { ConfigManager } from "../config/manager";
import type { SidebarManager } from "../config/sidebar.js";
import { type ProviderConfig } from "../types";
import type { BaseProvider } from "./base";
import { createProvider } from "./factory";

export class MainProvider implements vscode.LanguageModelChatProvider {
  private providers: Map<string, BaseProvider> = new Map();

  constructor(
    private readonly context: vscode.ExtensionContext,
    protected configManager: ConfigManager,
    protected sidebarManager: SidebarManager,
  ) {}

  async reload(configs: ProviderConfig[]): Promise<void> {
    for (const config of configs) {
      if (this.providers.has(config.id)) {
        const provider = this.providers.get(config.id);
        provider?.setConfig(config);
        continue;
      }

      const provider = createProvider(config, this.context) as BaseProvider;

      this.providers.set(config.id, provider);
    }
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean; configuration?: { groupId: string } },
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    console.log("options", options);

    if (!options.configuration?.groupId || this.providers.size === 0) {
      return [];
    }

    const provider = this.providers.get(options.configuration?.groupId);

    if (!provider) {
      return [];
    }

    console.log("provider", provider);

    const models = await provider.provideLanguageModelChatInformation({ silent: options.silent }, token);

    console.log("models", models);

    return models || [];
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const provider = this.providers.get(model.groupId);

    if (!provider) {
      throw new Error("Provider not found for model: " + model.id);
    }

    await provider.provideLanguageModelChatResponse(model, messages, options, progress, token);
  }

  async provideTokenCount(
    model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    token: vscode.CancellationToken,
  ): Promise<number> {
    const provider = this.providers.get(model.groupId);

    if (!provider) {
      throw new Error("Provider not found for model: " + model.id);
    }

    return await provider.provideTokenCount(model, text, token);
  }
}
