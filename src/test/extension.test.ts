import * as assert from "assert";
import type { ModalFormField } from "../types";
import { normalizeModalFormSubmission } from "../ui/modal-form-helpers";

suite("Modal Form Helpers", () => {
  test("normalizes submitted values", () => {
    const fields: ModalFormField[] = [
      {
        id: "name",
        type: "text",
        label: "Name",
        required: true,
      },
      {
        id: "maxTokens",
        type: "number",
        label: "Max Tokens",
        required: true,
        integer: true,
        min: 1,
      },
      {
        id: "provider",
        type: "select",
        label: "Provider",
        required: true,
        options: [
          { label: "OpenAI", value: "openai" },
          { label: "Anthropic", value: "anthropic" },
        ],
      },
      {
        id: "enabled",
        type: "checkbox",
        label: "Enabled",
        value: false,
      },
    ];

    const result = normalizeModalFormSubmission(fields, {
      name: "  Demo Provider  ",
      maxTokens: "2048",
      provider: "openai",
      enabled: true,
    });

    assert.deepStrictEqual(result.errors, {});
    assert.deepStrictEqual(result.values, {
      name: "Demo Provider",
      maxTokens: 2048,
      provider: "openai",
      enabled: true,
    });
  });

  test("keeps optional blank values as undefined", () => {
    const fields: ModalFormField[] = [
      {
        id: "notes",
        type: "text",
        label: "Notes",
      },
      {
        id: "timeout",
        type: "number",
        label: "Timeout",
      },
      {
        id: "active",
        type: "checkbox",
        label: "Active",
      },
    ];

    const result = normalizeModalFormSubmission(fields, {
      notes: "",
      timeout: "",
      active: false,
    });

    assert.deepStrictEqual(result.errors, {});
    assert.strictEqual(result.values.notes, undefined);
    assert.strictEqual(result.values.timeout, undefined);
    assert.strictEqual(result.values.active, false);
  });

  test("reports validation errors", () => {
    const fields: ModalFormField[] = [
      {
        id: "name",
        type: "text",
        label: "Name",
        required: true,
        notIn: ["taken"],
      },
      {
        id: "maxTokens",
        type: "number",
        label: "Max Tokens",
        required: true,
        integer: true,
        min: 1,
      },
      {
        id: "provider",
        type: "select",
        label: "Provider",
        required: true,
        options: [{ label: "OpenAI", value: "openai" }],
      },
      {
        id: "accepted",
        type: "checkbox",
        label: "Accepted",
        required: true,
      },
    ];

    const result = normalizeModalFormSubmission(fields, {
      name: "taken",
      maxTokens: "0",
      provider: "anthropic",
      accepted: false,
    });

    assert.deepStrictEqual(result.errors, {
      name: "Name must be unique",
      maxTokens: "Max Tokens must be at least 1",
      provider: "Provider is invalid",
      accepted: "Accepted must be checked",
    });
  });
});
