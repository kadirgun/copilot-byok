import * as vscode from "vscode";
import { PROVIDER_VENDOR_ID, type ProviderConfig } from "../types";

const PROVIDERS_KEY = "copilot-byok.providers";

export class ConfigManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async loadProviders(): Promise<ProviderConfig[]> {
    return this.context.workspaceState.get<ProviderConfig[]>(PROVIDERS_KEY) ?? [];
  }

  async saveProvider(provider: ProviderConfig): Promise<void> {
    const providers = await this.loadProviders();
    const index = providers.findIndex((p) => p.name === provider.name);
    if (index >= 0) {
      providers[index] = provider;
    } else {
      providers.push(provider);
      await vscode.commands.executeCommand("lm.addLanguageModelsProviderGroup", {
        groupId: provider.id,
        vendor: PROVIDER_VENDOR_ID,
        name: provider.name,
      });
    }
    await this.context.workspaceState.update(PROVIDERS_KEY, providers);
  }

  async deleteProvider(providerName: string): Promise<void> {
    const providers = await this.loadProviders();
    const provider = providers.find((p) => p.name === providerName);

    if (!provider) {
      return;
    }

    if (provider.apiKeySecretKey) {
      const apiKey = await this.context.secrets.get(provider.apiKeySecretKey);
      if (apiKey) {
        this.context.secrets.delete(provider.apiKeySecretKey);
      }
    }

    await this.context.workspaceState.update(
      PROVIDERS_KEY,
      providers.filter((p) => p.name !== providerName),
    );

    await vscode.commands.executeCommand("lm.removeLanguageModelsProviderGroup", {
      groupId: providerName,
      vendor: PROVIDER_VENDOR_ID,
      name: providerName,
    });
  }
}
