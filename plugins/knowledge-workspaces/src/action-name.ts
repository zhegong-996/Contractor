/**
 * Workspace action names become a URL path segment on the bridge
 * (`/workspace/<action>`), so the allow-list is deliberately strict: start
 * with a lowercase letter, then lowercase letters, digits and hyphens only.
 *
 * Digits are required by the v0.6 action family (`v06-plan-view`,
 * `v06-l2-status`, `v06-org-overview`, ...). The former `/^[a-z-]+$/`
 * rejected every one of them in a real Paperclip host: the panels rendered
 * but each read returned "Invalid workspace action". Static layout audits
 * could not catch it because they never executed the action transport.
 */
export const WORKSPACE_ACTION = /^[a-z][a-z0-9-]*$/;

export function assertWorkspaceAction(value: unknown): string {
  const action = String(value ?? '');
  if (!WORKSPACE_ACTION.test(action)) throw new Error('Invalid workspace action');
  return action;
}
