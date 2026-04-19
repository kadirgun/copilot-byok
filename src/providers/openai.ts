import OpenAI from "openai";
import * as vscode from "vscode";
import type { ProviderConfig } from "../types";
import { BaseProvider } from "./base";

export class OpenAIProvider extends BaseProvider {
  constructor(config: ProviderConfig, context: vscode.ExtensionContext) {
    super(config, context);
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const models: vscode.LanguageModelChatInformation[] = [];

    for (const modelId of this.config.models) {
      models.push({
        id: modelId,
        name: modelId,
        family: modelId,
        detail: this.config.name,
        version: "1.0.0",
        maxInputTokens: 128000,
        maxOutputTokens: 16384,
        isUserSelectable: true,
        capabilities: {
          imageInput: true,
          toolCalling: true,
        },
      });
    }

    return models;
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new Error("API key not configured");
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.config.baseURL ?? "https://api.openai.com/v1",
    });

    const response = await client.chat.completions.create({
      model: model.id,
      messages: messages.map((message) => ({
        role: String(message.role) === "system" ? "system" : String(message.role) === "user" ? "user" : "assistant",
        content: message.content
          .filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
          .map((part) => part.value)
          .join(""),
      })),
      stream: true,
    });

    for await (const chunk of response) {
      if (token.isCancellationRequested) {
        break;
      }
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        progress.report(new vscode.LanguageModelTextPart(content));
      }
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    const content =
      typeof text === "string"
        ? text
        : text.content
            .filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
            .map((part) => part.value)
            .join("");
    return Math.ceil(content.length / 4);
  }
}
