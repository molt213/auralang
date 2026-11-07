import { beforeEach, describe, expect, it, jest } from '@jest/globals'

interface PostedMessage {
  data: unknown
  transfer: unknown[] | undefined
}

class FakeWorker {
  static instances: FakeWorker[] = []

  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly posted: PostedMessage[] = []

  constructor(readonly url: string) {
    FakeWorker.instances.push(this)
  }

  postMessage(data: unknown, transfer?: unknown[]): void {
    this.posted.push({ data, transfer })
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent)
  }

  emitCrash(message: string): void {
    this.onerror?.({ message } as ErrorEvent)
  }
}

type DolphinClient = typeof import('./dolphinClient')

// The client owns a module-level worker singleton, so each test gets a fresh
// module instance with its own Worker registry.
async function loadClient(): Promise<DolphinClient> {
  let client!: DolphinClient
  await jest.isolateModulesAsync(async () => {
    client = await import('./dolphinClient')
  })
  return client
}

function installChromeMock(): void {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
      },
    },
  })
}

describe('Given the Dolphin ASR worker client', () => {
  beforeEach(() => {
    FakeWorker.instances = []
    installChromeMock()
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: FakeWorker,
    })
  })

  it('When a transcription is requested, Then the samples are transferred to the worker and the returned text resolves', async () => {
    const client = await loadClient()
    const samples = new Float32Array([0.1, -0.2, 0.3])

    const transcription = client.transcribeWithDolphin(samples)

    const worker = FakeWorker.instances[0]
    expect(worker.url).toBe('chrome-extension://test/workers/sherpa-dolphin.worker.js')
    expect(worker.posted[0]).toEqual({
      data: { type: 'TRANSCRIBE', id: 0, samples },
      transfer: [samples.buffer],
    })

    worker.emit({ type: 'TRANSCRIBE_RESULT', id: 0, text: 'こんにちは' })
    await expect(transcription).resolves.toBe('こんにちは')
  })

  it('When the worker reports a transcription failure, Then the promise rejects with that message', async () => {
    const client = await loadClient()

    const transcription = client.transcribeWithDolphin(new Float32Array([0.1]))

    FakeWorker.instances[0].emit({
      type: 'TRANSCRIBE_ERROR',
      id: 0,
      message: 'Dolphin transcription failed: boom',
    })
    await expect(transcription).rejects.toThrow('Dolphin transcription failed: boom')
  })

  it('When the model is preloaded twice, Then both requests go to the same worker instance', async () => {
    const client = await loadClient()

    client.ensureDolphinModel()
    client.ensureDolphinModel()

    // Deduplication is the worker's job; the client just forwards.
    expect(FakeWorker.instances).toHaveLength(1)
    expect(FakeWorker.instances[0].posted).toEqual([
      { data: { type: 'ENSURE_MODEL' }, transfer: undefined },
      { data: { type: 'ENSURE_MODEL' }, transfer: undefined },
    ])
  })

  it('When the worker reports model progress, Then status listeners receive a downloading status', async () => {
    const client = await loadClient()
    const statuses: unknown[] = []
    client.onDolphinStatus((status) => statuses.push(status))

    client.ensureDolphinModel()
    FakeWorker.instances[0].emit({ type: 'MODEL_PROGRESS', progress: 42 })

    expect(statuses).toEqual([{ phase: 'downloading', progress: 42 }])
  })

  it('When the worker reports the model as ready, Then status listeners receive the dolphin ready status', async () => {
    const client = await loadClient()
    const statuses: unknown[] = []
    client.onDolphinStatus((status) => statuses.push(status))

    client.ensureDolphinModel()
    FakeWorker.instances[0].emit({ type: 'MODEL_READY' })

    expect(statuses).toEqual([{ phase: 'ready', tier: 'dolphin' }])
  })

  it('When the worker crashes, Then pending transcriptions reject and an error status is published', async () => {
    const client = await loadClient()
    const statuses: unknown[] = []
    client.onDolphinStatus((status) => statuses.push(status))

    const transcription = client.transcribeWithDolphin(new Float32Array([0.5]))
    FakeWorker.instances[0].emitCrash('out of memory')

    await expect(transcription).rejects.toThrow('Dolphin worker crashed: out of memory')
    expect(statuses).toEqual([
      { phase: 'error', message: 'Dolphin worker crashed: out of memory' },
    ])
  })
})
