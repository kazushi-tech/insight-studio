/**
 * UI display gate only. Server-side authorization must always come from the
 * verified JWT and case registry, never from this browser state.
 */
export function shouldShowDemoMode({ isAdsAuthenticated, user, currentCase }) {
  return isAdsAuthenticated === true
    && user?.role === 'case_user'
    && (user?.is_demo === true || currentCase?.is_demo === true)
}
