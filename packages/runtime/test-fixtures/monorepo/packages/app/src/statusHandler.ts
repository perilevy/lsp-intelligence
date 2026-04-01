import { ItemStatus } from "@fixtures/core";

/** Handle item status display — tests switch exhaustiveness */
export function getStatusLabel(status: ItemStatus): string {
  switch (status) {
    case ItemStatus.Active:
      return "Active";
    case ItemStatus.Archived:
      return "Archived";
    case ItemStatus.Draft:
      return "Draft";
  }
}

/** Validate a status string */
export function isKnownStatus(value: string): value is "active" | "archived" | "draft" {
  return ["active", "archived", "draft"].includes(value);
}
