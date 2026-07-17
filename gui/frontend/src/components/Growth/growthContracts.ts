export interface GrowthRequestToken {
  folioId: string
  inputSignature: string
}

type GrowthStateLike = object & { result?: unknown }

/** Stable comparison payload for a growth fit; computed output is irrelevant. */
export function growthInputSignature(state: GrowthStateLike): string {
  const { result, ...inputs } = state
  void result
  return JSON.stringify(inputs)
}

export function createGrowthRequestToken(
  folioId: string,
  state: GrowthStateLike,
): GrowthRequestToken {
  return { folioId, inputSignature: growthInputSignature(state) }
}

/** Prevent an async response from being attached to edited inputs/another folio. */
export function isGrowthRequestTokenCurrent(
  token: GrowthRequestToken,
  folioId: string,
  state: GrowthStateLike,
): boolean {
  return token.folioId === folioId
    && token.inputSignature === growthInputSignature(state)
}
