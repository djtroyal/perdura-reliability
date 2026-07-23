export const CAPTURE_API_CONTRACT = 1

// ServerCompatibilityBoundary adds negotiation and cache-busting parameters.
// Match the endpoint path with or without those query parameters.
export const VERSION_ENDPOINT_PATTERN = /\/api\/v1\/version(?:\?.*)?$/

export function captureServerIdentity(version) {
  return {
    version,
    commit: 'dev',
    built_at: 'capture',
    api_contract: CAPTURE_API_CONTRACT,
    minimum_client_api_contract: CAPTURE_API_CONTRACT,
    maximum_client_api_contract: CAPTURE_API_CONTRACT,
  }
}
