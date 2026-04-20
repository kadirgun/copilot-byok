import type {
  ModalFormCheckboxInput,
  ModalFormField,
  ModalFormNumberInput,
  ModalFormResult,
  ModalFormSelectInput,
  ModalFormTextInput,
} from "../types";

export interface ModalFormNormalizationResult {
  values: ModalFormResult;
  errors: Record<string, string>;
}

export function normalizeModalFormSubmission(
  fields: ModalFormField[],
  rawValues: Record<string, unknown>,
): ModalFormNormalizationResult {
  const values: ModalFormResult = {};
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const normalized = normalizeFieldValue(field, rawValues[field.id]);
    if (normalized.error) {
      errors[field.id] = normalized.error;
      continue;
    }

    values[field.id] = normalized.value;
  }

  return { values, errors };
}

function normalizeFieldValue(
  field: ModalFormField,
  rawValue: unknown,
): { value: string | number | boolean | undefined; error?: string } {
  switch (field.type) {
    case "text":
      return normalizeTextFieldValue(field, rawValue);
    case "number":
      return normalizeNumberFieldValue(field, rawValue);
    case "select":
      return normalizeSelectFieldValue(field, rawValue);
    case "checkbox":
      return normalizeCheckboxFieldValue(field, rawValue);
    default:
      throw new Error(`Unsupported modal form field type: ${(field as { type: string }).type}`);
  }
}

function normalizeTextFieldValue(
  field: ModalFormTextInput,
  rawValue: unknown,
): { value: string | undefined; error?: string } {
  const text =
    typeof rawValue === "string" ? rawValue : rawValue === undefined || rawValue === null ? "" : String(rawValue);
  const normalized = field.trim === false ? text : text.trim();

  if (!normalized) {
    if (field.required) {
      return { value: undefined, error: field.messages?.required ?? `${field.label} is required` };
    }

    return { value: undefined };
  }

  if (field.minLength !== undefined && normalized.length < field.minLength) {
    return {
      value: undefined,
      error: field.messages?.invalid ?? `${field.label} must be at least ${field.minLength} characters`,
    };
  }

  if (field.maxLength !== undefined && normalized.length > field.maxLength) {
    return {
      value: undefined,
      error: field.messages?.invalid ?? `${field.label} must be at most ${field.maxLength} characters`,
    };
  }

  if (field.pattern) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(field.pattern);
    } catch {
      return { value: undefined, error: field.messages?.pattern ?? `${field.label} has an invalid pattern` };
    }

    if (!pattern.test(normalized)) {
      return { value: undefined, error: field.messages?.pattern ?? `${field.label} is invalid` };
    }
  }

  if (field.format === "url") {
    try {
      new URL(normalized);
    } catch {
      return { value: undefined, error: field.messages?.format ?? `${field.label} must be a valid URL` };
    }
  }

  if (field.notIn?.includes(normalized)) {
    return { value: undefined, error: field.messages?.notIn ?? `${field.label} must be unique` };
  }

  return { value: normalized };
}

function normalizeNumberFieldValue(
  field: ModalFormNumberInput,
  rawValue: unknown,
): { value: number | undefined; error?: string } {
  const text =
    typeof rawValue === "string" ? rawValue : rawValue === undefined || rawValue === null ? "" : String(rawValue);
  const normalized = text.trim();

  if (!normalized) {
    if (field.required) {
      return { value: undefined, error: field.messages?.required ?? `${field.label} is required` };
    }

    return { value: undefined };
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return { value: undefined, error: field.messages?.invalid ?? `${field.label} must be a valid number` };
  }

  if (field.integer && !Number.isInteger(value)) {
    return { value: undefined, error: field.messages?.integer ?? `${field.label} must be an integer` };
  }

  if (field.min !== undefined && value < field.min) {
    return { value: undefined, error: field.messages?.min ?? `${field.label} must be at least ${field.min}` };
  }

  if (field.max !== undefined && value > field.max) {
    return { value: undefined, error: field.messages?.max ?? `${field.label} must be at most ${field.max}` };
  }

  return { value };
}

function normalizeSelectFieldValue(
  field: ModalFormSelectInput,
  rawValue: unknown,
): { value: string | undefined; error?: string } {
  const text =
    typeof rawValue === "string" ? rawValue : rawValue === undefined || rawValue === null ? "" : String(rawValue);
  const normalized = text.trim();

  if (!normalized) {
    if (field.required) {
      return { value: undefined, error: field.messages?.required ?? `${field.label} is required` };
    }

    return { value: undefined };
  }

  const option = field.options.find((candidate) => candidate.value === normalized);
  if (!option) {
    return { value: undefined, error: field.messages?.invalid ?? `${field.label} is invalid` };
  }

  return { value: option.value };
}

function normalizeCheckboxFieldValue(
  field: ModalFormCheckboxInput,
  rawValue: unknown,
): { value: boolean; error?: string } {
  const checked = rawValue === true || rawValue === "true" || rawValue === "on" || rawValue === 1 || rawValue === "1";

  if (field.required && !checked) {
    return { value: checked, error: field.messages?.required ?? `${field.label} must be checked` };
  }

  return { value: checked };
}
