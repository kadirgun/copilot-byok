import OpenAI from "openai";
import * as vscode from "vscode";
import type { ProviderConfig } from "../types";
import { BaseProvider } from "./base";

export class OpenAIProvider extends BaseProvider {
  private client?: OpenAI;

  constructor(config: ProviderConfig, context: vscode.ExtensionContext) {
    super(config, context);
  }

  async getClient(): Promise<OpenAI> {
    if (this.client) {
      return this.client;
    }

    const apiKey = await this.getApiKey();

    this.client = new OpenAI({
      apiKey,
      baseURL: this.config.baseURL ?? "https://api.openai.com/v1",
    });

    return this.client;
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    return this.config.models.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      family: "OpenAI",
      detail: this.config.name,
      version: "1.0.0",
      maxInputTokens: model.maxInputTokens ?? 128000,
      maxOutputTokens: model.maxOutputTokens ?? 16384,
      isUserSelectable: true,
      capabilities: model.capabilities ?? {
        imageInput: true,
        toolCalling: true,
      },
      groupId: this.config.id,
    } as vscode.LanguageModelChatInformation));
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const client = await this.getClient();
    const tools = options.tools ? this.mapToolsToOpenAIFormat(options.tools) : undefined;

    const mappedMessages = this.extractMessagesForOpenAI(messages);

    const stream = await client.chat.completions.create({
      model: model.id,
      messages: mappedMessages,
      tools,
      tool_choice: "auto",
      stream: true,
    });

    for await (const chunk of stream) {
      if (token.isCancellationRequested) {
        break;
      }

      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        progress.report(new vscode.LanguageModelTextPart(delta.content));
      }

      if (delta?.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          if (toolCall.function?.name && toolCall.id) {
            progress.report(new vscode.LanguageModelToolCallPart(
              toolCall.id,
              toolCall.function.name,
              toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {},
            ));
          }
        }
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

  private mapToolsToOpenAIFormat(tools: readonly vscode.LanguageModelChatTool[]): OpenAI.Chat.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description || "",
        parameters:
          typeof tool.inputSchema === "object" && tool.inputSchema !== null
            ? (tool.inputSchema as Record<string, unknown>)
            : { type: "object", properties: {} },
      },
    }));
  }

  private extractMessagesForOpenAI(messages: readonly vscode.LanguageModelChatRequestMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map((message) => {
      const { text, toolCalls, toolResults } = this.extractTextAndToolParts(message);

      const role = this.getRole(message.role);

      if (toolCalls.length > 0 || toolResults.length > 0) {
        const msg: OpenAI.Chat.ChatCompletionAssistantMessageParam | OpenAI.Chat.ChatCompletionToolMessageParam = {
          role,
        } as OpenAI.Chat.ChatCompletionAssistantMessageParam | OpenAI.Chat.ChatCompletionToolMessageParam;

        if (text) {
          msg.content = text;
        }

        if (toolCalls.length > 0) {
          (msg as OpenAI.Chat.ChatCompletionAssistantMessageParam).tool_calls = toolCalls.map((tc) => ({
            id: tc.callId,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input),
            },
          }));
        }

        if (toolResults.length > 0) {
          (msg as OpenAI.Chat.ChatCompletionToolMessageParam).tool_call_id = toolResults[0].callId;
          (msg as OpenAI.Chat.ChatCompletionToolMessageParam).content = toolResults.map((tr) =>
            typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content)
          ).join("\n");
        }

        return msg;
      }

      return {
        role,
        content: text || undefined,
      } as OpenAI.Chat.ChatCompletionMessageParam;
    }).filter((m) => m.content !== undefined || (m as OpenAI.Chat.ChatCompletionAssistantMessageParam).tool_calls !== undefined);
  }
}