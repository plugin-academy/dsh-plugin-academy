import type { Context } from '@deepseek-ai/cordis'
import type { MarketIndexSummary } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

export interface IndexRegistry {
  isAvailable(signal: AbortSignal): Promise<boolean>
  listIndexes(): Promise<MarketIndexSummary[]>
  setIndexes(urls: string[]): Promise<void>
}

function valueOf<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw result.error
  return result.value
}

export function indexRegistry(
  remote: Pick<Context['remote']['pluginMarket'], 'listIndexes' | 'setIndexes'>,
  isAvailable: IndexRegistry['isAvailable'],
): IndexRegistry {
  return {
    isAvailable,
    listIndexes: async () => valueOf(await remote.listIndexes()),
    setIndexes: async urls => { valueOf(await remote.setIndexes(urls)) },
  }
}
