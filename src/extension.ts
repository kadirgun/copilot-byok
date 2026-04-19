import * as vscode from "vscode";
import { ConfigManager } from "./config/manager";
import { QuickPickManager } from "./config/quickpick";
import { MainProvider } from "./providers/main";
import { CONFIG_COMMAND, PROVIDER_VENDOR_ID } from "./types";

export function activate(context: vscode.ExtensionContext): void {
  const configManager = new ConfigManager(context);
  const quickPickManager = new QuickPickManager(context, configManager);
  const mainProvider = new MainProvider([], context);

  vscode.lm.registerLanguageModelChatProvider(PROVIDER_VENDOR_ID, mainProvider);

  const refresh = async (): Promise<void> => {
    mainProvider.reload(await configManager.loadProviders());
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(CONFIG_COMMAND, async () => {
      await quickPickManager.showAddProvider();
      await refresh();
    }),
    vscode.commands.registerCommand("copilot-byok.addProvider", async () => {
      const name = await quickPickManager.showAddProvider();
      await refresh();
      if (name) {
        await vscode.commands.executeCommand("copilot-byok.addModel");
      }
    }),
    vscode.commands.registerCommand("copilot-byok.editProvider", async () => {
      await quickPickManager.showEditProvider();
      await refresh();
    }),
    vscode.commands.registerCommand("copilot-byok.deleteProvider", async () => {
      await quickPickManager.showDeleteProvider();
      await refresh();
    }),
    vscode.commands.registerCommand("copilot-byok.addModel", async () => {
      await quickPickManager.showAddModel();
      await refresh();
    }),
    vscode.commands.registerCommand("copilot-byok.removeModel", async () => {
      await quickPickManager.showRemoveModel();
      await refresh();
    }),
  );
}

export function deactivate(): void {}
