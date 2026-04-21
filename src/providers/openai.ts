import OpenAI from "openai";
import * as vscode from "vscode";
import type { ProviderConfig } from "../types";
import { BaseProvider } from "./base";

interface PendingToolCall {
  id?: string;
  name?: string;
  arguments: string;
}

class OpenAITransport extends OpenAI {
  private readonly noAuth: boolean;

  constructor(options: ConstructorParameters<typeof OpenAI>[0] & { noAuth?: boolean }) {
    const { noAuth, ...rest } = options;
    super(rest);
    this.noAuth = !!noAuth;
  }

  protected override defaultHeaders(
    opts: Parameters<OpenAI["defaultHeaders"]>[0],
  ): Record<string, string | null | undefined> {
    const headers = super.defaultHeaders(opts);
    if (!this.noAuth) {
      return headers;
    }

    return Object.fromEntries(
      Object.entries(headers).filter(([name]) => {
        const lower = name.toLowerCase();
        return lower !== "authorization" && lower !== "api-key";
      }),
    ) as Record<string, string | null | undefined>;
  }
}

export class OpenAIProvider extends BaseProvider {
  private client?: OpenAI;

  constructor(config: ProviderConfig, context: vscode.ExtensionContext) {
    super(config, context);
  }

  override setConfig(config: ProviderConfig): void {
    this.client = undefined;
    super.setConfig(config);
  }

  async getClient(): Promise<OpenAI> {
    if (this.client) {
      return this.client;
    }

    const apiKey = await this.getApiKey();

    this.client = new OpenAITransport({
      noAuth: !apiKey,
      apiKey: apiKey ?? "",
      baseURL: this.config.baseURL ?? "https://api.openai.com/v1",
    });

    return this.client;
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    void options;

    return this.config.models.map(
      (model) =>
        ({
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
        }) as vscode.LanguageModelChatInformation,
    );
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
    const toolChoice = tools?.length
      ? options.toolMode === vscode.LanguageModelChatToolMode.Required
        ? "required"
        : "auto"
      : undefined;

    const mappedMessages = this.extractMessagesForOpenAI(messages);
    const toolCalls = new Map<number, PendingToolCall>();

    const stream = await client.chat.completions.create({
      model: model.id,
      messages: mappedMessages,
      tools,
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      stream: true,
      stream_options: { include_usage: true },
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
          const pending = toolCalls.get(toolCall.index) ?? { arguments: "" };
          if (toolCall.id) {
            pending.id = toolCall.id;
          }
          if (toolCall.function?.name) {
            pending.name = toolCall.function.name;
          }
          if (toolCall.function?.arguments) {
            pending.arguments += toolCall.function.arguments;
          }
          toolCalls.set(toolCall.index, pending);

          if (pending.id && pending.name) {
            try {
              progress.report(
                new vscode.LanguageModelToolCallPart(
                  pending.id,
                  pending.name,
                  pending.arguments ? JSON.parse(pending.arguments) : {},
                ),
              );
              toolCalls.delete(toolCall.index);
            } catch {
              // Keep accumulating until the JSON is complete.
            }
          }
        }
      }
    }

    for (const pending of toolCalls.values()) {
      if (pending.id && pending.name) {
        try {
          progress.report(
            new vscode.LanguageModelToolCallPart(
              pending.id,
              pending.name,
              pending.arguments ? JSON.parse(pending.arguments) : {},
            ),
          );
        } catch {
          progress.report(new vscode.LanguageModelToolCallPart(pending.id, pending.name, {}));
        }
      }
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    return Math.ceil(text.toString().length / 4);
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

  private extractMessagesForOpenAI(
    messages: readonly vscode.LanguageModelChatRequestMessage[],
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const mappedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    for (const message of messages) {
      const { text, toolCalls, toolResults } = this.extractTextAndToolParts(message);

      const role = this.getRole(message.role);

      if (!text && toolCalls.length === 0 && toolResults.length === 0) {
        continue;
      }

      if (toolCalls.length > 0) {
        const assistantMessage: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
          role: "assistant",
          content: text || undefined,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.callId,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input),
            },
          })),
        };

        if (!assistantMessage.content) {
          delete assistantMessage.content;
        }

        mappedMessages.push(assistantMessage);
        continue;
      }

      if (toolResults.length > 0) {
        if (text) {
          mappedMessages.push({ role, content: text } as OpenAI.Chat.ChatCompletionMessageParam);
        }

        for (const toolResult of toolResults) {
          const toolMessage: OpenAI.Chat.ChatCompletionToolMessageParam = {
            role: "tool",
            tool_call_id: toolResult.callId,
            content: typeof toolResult.content === "string" ? toolResult.content : JSON.stringify(toolResult.content),
          };

          mappedMessages.push(toolMessage);
        }

        continue;
      }

      mappedMessages.push({
        role,
        content: text || undefined,
      } as OpenAI.Chat.ChatCompletionMessageParam);
    }

    return mappedMessages.filter(
      (m) => m.content !== undefined || (m as OpenAI.Chat.ChatCompletionAssistantMessageParam).tool_calls !== undefined,
    );
  }
}
