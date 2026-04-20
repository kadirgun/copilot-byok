import kebabCase from "lodash.kebabcase";
import * as vscode from "vscode";
import type { ModalFormField, ModelConfig, ProviderConfig } from "../types";
import type { ModalFormManager } from "../ui/modal-form";
import type { ConfigManager } from "./manager";

type ProviderType = "openai" | "anthropic";

export class QuickPickManager {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly configManager: ConfigManager,
    private readonly modalFormManager: ModalFormManager,
  ) {}

  private async selectProvider(): Promise<ProviderConfig | undefined> {
    const providers = await this.configManager.loadProviders();
    if (providers.length === 0) {
      vscode.window.showInformationMessage('No providers configured. Run "Add Provider" first.');
      return;
    }

    const selected = await vscode.window.showQuickPick(
      providers.map((provider) => ({
        label: `${provider.name} (${provider.type})`,
        provider,
      })),
      { placeHolder: "Select provider" },
    );

    return selected?.provider;
  }

  private async promptApiKey(): Promise<string | undefined> {
    return await vscode.window.showInputBox({
      placeHolder: "sk-...",
      prompt: "Enter API key",
      ignoreFocusOut: true,
    });
  }

  private async collectProviderDetails(
    providers: ProviderConfig[],
    existingProvider?: ProviderConfig,
  ): Promise<{ type: ProviderType; name: string; baseURL?: string; apiKey?: string } | undefined> {
    const typeField: ModalFormField[] = existingProvider
      ? []
      : [
          {
            id: "type",
            type: "select",
            label: "Provider Type",
            required: true,
            value: "openai",
            options: [
              { label: "OpenAI", value: "openai" },
              { label: "Anthropic", value: "anthropic" },
            ],
          },
        ];

    const submitted = await this.modalFormManager.showFormModal(
      [
        ...typeField,
        {
          id: "name",
          type: "text",
          label: "Provider Name",
          required: true,
          value: existingProvider?.name ?? "",
          placeholder: "Provider name",
          notIn: providers.filter((provider) => provider.id !== existingProvider?.id).map((provider) => provider.name),
          messages: {
            required: "Provider name is required",
            notIn: "Provider name must be unique",
          },
        },
        {
          id: "baseURL",
          type: "text",
          label: "Base URL",
          required: !existingProvider,
          value: existingProvider?.baseURL ?? "",
          placeholder: "https://api.example.com",
          format: "url",
          messages: {
            required: "Please enter a valid URL",
            format: "Please enter a valid URL",
          },
        },
        {
          id: "apiKey",
          type: "text",
          label: "API Key",
          description: "Optional. Leave empty if you want to add it later.",
          value: "",
          placeholder: "sk-...",
          password: true,
          trim: false,
        },
      ],
      {
        title: existingProvider ? "Edit Provider" : "Add Provider",
        description: existingProvider
          ? `Update settings for ${existingProvider.name}`
          : "Create a new OpenAI or Anthropic provider",
        submitLabel: existingProvider ? "Save Changes" : "Add Provider",
        cancelLabel: "Cancel",
      },
    );

    if (!submitted) {
      return;
    }

    const type = existingProvider ? existingProvider.type : submitted.type === "anthropic" ? "anthropic" : "openai";
    const name = typeof submitted.name === "string" ? submitted.name.trim() : "";
    const baseURL = typeof submitted.baseURL === "string" ? submitted.baseURL.trim() : "";
    const apiKey = typeof submitted.apiKey === "string" && submitted.apiKey ? submitted.apiKey : undefined;

    if (!name || (!existingProvider && !baseURL)) {
      return;
    }

    return { type, name, baseURL: baseURL || undefined, apiKey };
  }

  private async collectModelDetails(
    provider: ProviderConfig,
    existingModel?: ModelConfig,
  ): Promise<ModelConfig | undefined> {
    const takenIds = provider.models.filter((model) => model.id !== existingModel?.id).map((model) => model.id);

    const submitted = await this.modalFormManager.showFormModal(
      [
        {
          id: "id",
          type: "text",
          label: "Model ID",
          description: "Example: gpt-4o",
          required: true,
          value: existingModel?.id ?? "",
          placeholder: "gpt-4o",
          notIn: takenIds,
          messages: {
            required: "Model ID is required",
            notIn: "Model ID must be unique within the provider",
          },
        },
        {
          id: "name",
          type: "text",
          label: "Display Name",
          description: "Optional name shown in VS Code",
          value: existingModel?.name ?? existingModel?.id ?? "",
          placeholder: "Model display name",
        },
        {
          id: "maxInputTokens",
          type: "number",
          label: "Max Input Tokens",
          description: "Leave empty to use the provider default",
          value: existingModel?.maxInputTokens ?? 8192,
          placeholder: "8192",
          min: 1,
          integer: true,
          messages: {
            invalid: "Please enter a valid positive number",
            min: "Please enter a valid positive number",
            integer: "Please enter a valid positive number",
          },
        },
        {
          id: "maxOutputTokens",
          type: "number",
          label: "Max Output Tokens",
          description: "Leave empty to use the provider default",
          value: existingModel?.maxOutputTokens ?? 2048,
          placeholder: "2048",
          min: 1,
          integer: true,
          messages: {
            invalid: "Please enter a valid positive number",
            min: "Please enter a valid positive number",
            integer: "Please enter a valid positive number",
          },
        },
        {
          id: "imageInput",
          type: "checkbox",
          label: "Supports Image Input",
          value: Boolean(existingModel?.capabilities?.imageInput),
        },
        {
          id: "toolCalling",
          type: "checkbox",
          label: "Supports Tool Calling",
          value: Boolean(existingModel?.capabilities?.toolCalling),
        },
        {
          id: "thinking",
          type: "checkbox",
          label: "Supports Thinking",
          value: Boolean(existingModel?.capabilities?.thinking),
        },
      ],
      {
        title: existingModel ? "Edit Model" : "Add Model",
        description: `Configure the model for ${provider.name}`,
        submitLabel: existingModel ? "Save" : "Add Model",
        cancelLabel: "Cancel",
      },
    );

    if (!submitted) {
      return;
    }

    const id = typeof submitted.id === "string" ? submitted.id.trim() : "";
    if (!id) {
      return;
    }

    const name = typeof submitted.name === "string" && submitted.name.trim() ? submitted.name.trim() : id;
    const maxInputTokens =
      typeof submitted.maxInputTokens === "number" ? submitted.maxInputTokens : (existingModel?.maxInputTokens ?? 8192);
    const maxOutputTokens =
      typeof submitted.maxOutputTokens === "number"
        ? submitted.maxOutputTokens
        : (existingModel?.maxOutputTokens ?? 2048);

    return {
      id,
      name,
      maxInputTokens,
      maxOutputTokens,
      capabilities: {
        imageInput: Boolean(submitted.imageInput),
        toolCalling: Boolean(submitted.toolCalling),
        thinking: Boolean(submitted.thinking),
      },
    };
  }

  async showAddProvider(): Promise<string | undefined> {
    const providers = await this.configManager.loadProviders();
    const details = await this.collectProviderDetails(providers);
    if (!details) {
      return;
    }

    const providerId = `provider-${kebabCase(details.name)}`;
    const secretKey = `copilot-byok-${providerId}-apikey`;

    if (details.apiKey) {
      await this.context.secrets.store(secretKey, details.apiKey);
    }

    await this.configManager.saveProvider({
      id: providerId,
      name: details.name,
      type: details.type,
      baseURL: details.baseURL,
      apiKeySecretKey: secretKey,
      models: [],
    });

    vscode.window.showInformationMessage(`Provider "${details.name}" added.`);
    return details.name;
  }

  async showEditProvider(): Promise<void> {
    const existingProvider = await this.selectProvider();
    if (!existingProvider) {
      return;
    }

    const apiKeyAction = await vscode.window.showQuickPick(
      [
        { label: "Keep current API key", value: "keep" as const },
        { label: "Update API key", value: "update" as const },
        { label: "Delete API key", value: "delete" as const },
      ],
      { placeHolder: "Select API key action" },
    );

    if (!apiKeyAction) {
      return;
    }

    const providers = await this.configManager.loadProviders();
    const details = await this.collectProviderDetails(providers, existingProvider);
    if (!details) {
      return;
    }

    if (apiKeyAction.value === "delete") {
      await this.context.secrets.delete(existingProvider.apiKeySecretKey);
    } else if (apiKeyAction.value === "update") {
      const apiKey = await this.promptApiKey();
      if (!apiKey) {
        return;
      }

      await this.context.secrets.store(existingProvider.apiKeySecretKey, apiKey);
    }

    const updatedProvider: ProviderConfig = {
      ...existingProvider,
      name: details.name,
      type: details.type,
      baseURL: details.baseURL,
    };

    await this.configManager.saveProvider(updatedProvider);
    vscode.window.showInformationMessage(`Provider "${updatedProvider.name}" updated.`);
  }

  async showDeleteProvider(): Promise<string | undefined> {
    const provider = await this.selectProvider();
    if (!provider) {
      return;
    }

    const confirmed = await vscode.window.showWarningMessage(
      `Delete "${provider.name}"?`,
      { modal: true },
      "Delete",
      "Cancel",
    );

    if (confirmed !== "Delete") {
      return;
    }

    const deletedName = provider.name;
    if (provider.apiKeySecretKey) {
      await this.context.secrets.delete(provider.apiKeySecretKey);
    }

    await this.configManager.deleteProvider(provider.id);
    vscode.window.showInformationMessage(`Provider "${deletedName}" deleted.`);
    return deletedName;
  }

  async showAddModel(): Promise<void> {
    const provider = await this.selectProvider();
    if (!provider) {
      return;
    }

    const model = await this.collectModelDetails(provider);
    if (!model) {
      return;
    }

    const updatedProvider: ProviderConfig = {
      ...provider,
      models: [...provider.models, model],
    };

    await this.configManager.saveProvider(updatedProvider);
    vscode.window.showInformationMessage(`Model "${model.name}" added to "${provider.name}".`);
  }

  async showDeleteModel(): Promise<void> {
    const provider = await this.selectProvider();
    if (!provider) {
      return;
    }

    if (!provider.models || provider.models.length === 0) {
      vscode.window.showInformationMessage("No models configured for this provider.");
      return;
    }

    const selectedModel = await vscode.window.showQuickPick(
      provider.models.map((model) => ({
        label: model.name,
        value: model,
      })),
      { placeHolder: "Select model to remove" },
    );

    if (!selectedModel) {
      return;
    }

    const updatedProvider: ProviderConfig = {
      ...provider,
      models: provider.models.filter((model) => model.id !== selectedModel.value.id),
    };

    await this.configManager.saveProvider(updatedProvider);
    vscode.window.showInformationMessage(`Model "${selectedModel.label}" removed.`);
  }

  async showEditModel(): Promise<void> {
    const provider = await this.selectProvider();
    if (!provider) {
      return;
    }

    if (!provider.models || provider.models.length === 0) {
      vscode.window.showInformationMessage("No models configured for this provider.");
      return;
    }

    const selectedModel = await vscode.window.showQuickPick(
      provider.models.map((model) => ({
        label: model.name,
        value: model,
      })),
      { placeHolder: "Select model to edit" },
    );

    if (!selectedModel) {
      return;
    }

    const modelIndex = provider.models.findIndex((model) => model.id === selectedModel.value.id);
    const updatedModel = await this.collectModelDetails(provider, selectedModel.value);
    if (!updatedModel) {
      return;
    }

    const updatedModels = [...provider.models];
    updatedModels[modelIndex] = updatedModel;

    const updatedProvider: ProviderConfig = {
      ...provider,
      models: updatedModels,
    };

    await this.configManager.saveProvider(updatedProvider);
    vscode.window.showInformationMessage(`Model updated to "${updatedModel.name}".`);
  }
}
