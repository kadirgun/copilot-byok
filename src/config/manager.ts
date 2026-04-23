import * as vscode from "vscode";
import { PROVIDER_VENDOR_ID, type ProviderConfig } from "../types";

const PROVIDERS_KEY = "copilot-byok.providers";

export class ConfigManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async loadProviders(): Promise<ProviderConfig[]> {
    return this.context.globalState.get<ProviderConfig[]>(PROVIDERS_KEY) ?? [];
  }

  async saveProvider(provider: ProviderConfig): Promise<void> {
    const providers = await this.loadProviders();
    const index = providers.findIndex((p) => p.id === provider.id);
    if (index >= 0) {
      providers[index] = provider;
    } else {
      providers.push(provider);

      try {
        await vscode.commands.executeCommand("lm.migrateLanguageModelsProviderGroup", {
          groupId: provider.id,
          vendor: PROVIDER_VENDOR_ID,
          name: provider.name,
        });
      } catch {
        console.warn("Failed to migrate language model provider group");
      }
    }

    await this.context.globalState.update(PROVIDERS_KEY, providers);
  }

  async deleteProvider(selector: string): Promise<void> {
    const providers = await this.loadProviders();
    const provider = providers.find((p) => p.name === selector || p.id === selector);

    if (!provider) {
      return;
    }

    if (provider.apiKeySecretKey) {
      const apiKey = await this.context.secrets.get(provider.apiKeySecretKey);
      if (apiKey) {
        this.context.secrets.delete(provider.apiKeySecretKey);
      }
    }

    await this.context.globalState.update(
      PROVIDERS_KEY,
      providers.filter((p) => p.id !== provider.id),
    );
  }
}
