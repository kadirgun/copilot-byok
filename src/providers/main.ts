import * as vscode from "vscode";
import type { ProviderConfig } from "../types";
import type { BaseProvider } from "./base";
import { createProvider } from "./factory";

export class MainProvider implements vscode.LanguageModelChatProvider {
  private providers: Map<string, BaseProvider> = new Map();

  constructor(
    configs: ProviderConfig[],
    private readonly context: vscode.ExtensionContext,
  ) {
    this.reload(configs);
  }

  async reload(configs: ProviderConfig[]): Promise<void> {
    for (const config of configs) {
      if (!config.enabled) {
        continue;
      }

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
      return [
        {
          id: "placeholder",
          name: "(No models configured — open Manage Language Models)",
          family: "placeholder",
          detail: "BYOK",
          version: "0.0.0",
          maxInputTokens: 0,
          maxOutputTokens: 0,
          isUserSelectable: false,
          tooltip: "Configure this provider to add models.",
          capabilities: {},
        },
      ];
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
  ): Promise<void> {}

  async provideTokenCount(
    model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    token: vscode.CancellationToken,
  ): Promise<number> {
    return 0;
  }
}
