export interface ActionContext {
  goal: string;
  trigger: string;
  parentAction?: string;
}

export function validateContext(ctx: unknown): ctx is ActionContext {
  if (typeof ctx !== "object" || ctx === null) return false;
  const obj = ctx as Record<string, unknown>;
  if (typeof obj["goal"] !== "string" || obj["goal"] === "") return false;
  if (typeof obj["trigger"] !== "string" || obj["trigger"] === "") return false;
  if ("parentAction" in obj && typeof obj["parentAction"] !== "string") return false;
  return true;
}
