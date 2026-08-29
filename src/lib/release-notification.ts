export type NotificationTargetKind = "user" | "chat" | "department" | "all";

export type NotificationTarget = {
  id: string;
  kind: NotificationTargetKind;
  name: string;
  departmentIdType?: "department_id" | "open_department_id";
};

export type ReleaseNotificationPreference = {
  enabled: boolean;
  targets: NotificationTarget[];
};

export type ReleaseNotificationDraft = {
  content: string;
  generationError?: string;
};
