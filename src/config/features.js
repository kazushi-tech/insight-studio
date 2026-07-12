// The v2 project API is implemented. Keep the production rollout explicit so
// it is enabled only after Clerk, database migrations and browser E2E pass in
// that environment.
export const isProjectManagementEnabled =
  import.meta.env.VITE_ENABLE_PROJECT_MANAGEMENT === 'true'
