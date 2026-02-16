export type ActionType =
  | "message.send"
  | "message.read"
  | "file.read"
  | "file.write"
  | "file.delete"
  | "api.call"
  | "api.auth"
  | "exec.command"
  | "exec.script"
  | "web.search"
  | "web.fetch"
  | "web.browse"
  | "payment.initiate"
  | "payment.confirm"
  | "calendar.create"
  | "calendar.modify"
  | "skill.invoke"
  | "memory.write"
  | "memory.read"
  | "session.spawn"
  | "session.send"
  | "elevated.enable"
  | "elevated.command";

export const ACTION_TYPES: readonly ActionType[] = [
  "message.send",
  "message.read",
  "file.read",
  "file.write",
  "file.delete",
  "api.call",
  "api.auth",
  "exec.command",
  "exec.script",
  "web.search",
  "web.fetch",
  "web.browse",
  "payment.initiate",
  "payment.confirm",
  "calendar.create",
  "calendar.modify",
  "skill.invoke",
  "memory.write",
  "memory.read",
  "session.spawn",
  "session.send",
  "elevated.enable",
  "elevated.command",
] as const;

const actionTypeSet = new Set<string>(ACTION_TYPES);

export function isActionType(value: string): value is ActionType {
  return actionTypeSet.has(value);
}
