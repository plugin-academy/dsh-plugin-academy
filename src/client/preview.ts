import { MarketIndexError, parseMarketIndex, type MarketPlugin } from '@deepseek-ai/dsh-plugin-market-index'
import { normalizeCatalogUrl } from '../catalog.ts'

const MAX_BYTES = 16 * 1024 * 1024
const TIMEOUT_MS = 15_000

type PreviewErrorCode = 'previewUnavailable' | 'previewNeedsHttps' | 'previewTooLarge' | 'previewInvalid' | 'previewTimedOut'

export class PreviewError extends Error {
  readonly code: PreviewErrorCode

  constructor(code: PreviewErrorCode, options?: ErrorOptions) {
    super(code, options)
    this.code = code
  }
}

export async function readIndexPreview(input: string, signal: AbortSignal): Promise<readonly MarketPlugin[]> {
  let url: string
  try {
    url = normalizeCatalogUrl(input)
  } catch (error) {
    throw new PreviewError('previewNeedsHttps', { cause: error })
  }

  const deadline = AbortSignal.timeout(TIMEOUT_MS)
  let body: ArrayBuffer
  try {
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, deadline]),
      mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    })
    if (!response.ok || response.body === null) {
      await response.body?.cancel()
      throw new PreviewError('previewUnavailable')
    }
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body.cancel()
      throw new PreviewError('previewTooLarge')
    }
    let bytes = 0
    const limited = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength
        if (bytes > MAX_BYTES) throw new PreviewError('previewTooLarge')
        controller.enqueue(chunk)
      },
    }))
    body = await new Response(limited).arrayBuffer()
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof PreviewError) throw error
    throw new PreviewError(deadline.aborted ? 'previewTimedOut' : 'previewUnavailable', { cause: error })
  }

  signal.throwIfAborted()
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
    return parseMarketIndex(value, url).plugins
  } catch (error) {
    if (!(error instanceof MarketIndexError || error instanceof SyntaxError || error instanceof TypeError)) throw error
    throw new PreviewError('previewInvalid', { cause: error })
  }
}
