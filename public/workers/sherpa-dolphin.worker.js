/*
 * Dolphin ASR worker (classic script — the sherpa-onnx runtime glue is a
 * pre-ESM Emscripten build loaded via importScripts).
 *
 * Responsibilities:
 *   1. Own the sherpa-onnx wasm runtime (Apache-2.0, github.com/k2-fsa/sherpa-onnx).
 *      The runtime is staged (and patched) into public/wasm by
 *      scripts/prepare-sherpa-wasm.mjs; this file must stay a plain classic
 *      script with no module syntax or bundler imports.
 *   2. Download the DataoceanAI Dolphin CTC model (Apache-2.0, sherpa-onnx
 *      int8 export) on first use, cache it in IndexedDB, and write it into the
 *      Emscripten virtual filesystem where the recognizer expects it.
 *   3. Run transcription. Chunking is done by audioCapture in the offscreen
 *      document, so each TRANSCRIBE message is a complete utterance.
 */
;(function () {
  'use strict'

  var RUNTIME_BASE_URL = '/wasm/sherpa-onnx-vad-asr/'
  var MODEL_ID = 'dolphin-small-ctc-multi-lang-int8'
  var DB_NAME = 'auralang-dolphin-models'
  var DB_STORE = 'files'
  var FS_MODEL_PATH = '/dolphin.onnx'
  var FS_TOKENS_PATH = '/tokens.txt'

  // Sources are tried in order; the first responding mirror wins. Hugging Face
  // sends permissive CORS headers (like the Whisper download this extension
  // already does), hf-mirror is the China-reachable mirror, and ModelScope is
  // a last-resort CDN.
  var MODEL_FILES = [
    {
      name: 'model.int8.onnx',
      expectedBytes: 249658954,
      sources: [
        'https://huggingface.co/csukuangfj/sherpa-onnx-dolphin-small-ctc-multi-lang-int8-2025-04-02/resolve/main/model.int8.onnx',
        'https://hf-mirror.com/csukuangfj/sherpa-onnx-dolphin-small-ctc-multi-lang-int8-2025-04-02/resolve/main/model.int8.onnx',
        'https://www.modelscope.cn/api/v1/models/csukuangfj/sherpa-onnx-dolphin-small-ctc-multi-lang-int8-2025-04-02/repo?Revision=master&FilePath=model.int8.onnx',
      ],
    },
    {
      name: 'tokens.txt',
      expectedBytes: 504662,
      sources: [
        'https://huggingface.co/csukuangfj/sherpa-onnx-dolphin-small-ctc-multi-lang-int8-2025-04-02/resolve/main/tokens.txt',
        'https://hf-mirror.com/csukuangfj/sherpa-onnx-dolphin-small-ctc-multi-lang-int8-2025-04-02/resolve/main/tokens.txt',
        'https://www.modelscope.cn/api/v1/models/csukuangfj/sherpa-onnx-dolphin-small-ctc-multi-lang-int8-2025-04-02/repo?Revision=master&FilePath=tokens.txt',
      ],
    },
  ]

  // Download progress is reported across all model files combined.
  var TOTAL_BYTES = MODEL_FILES.reduce(function (sum, file) {
    return sum + file.expectedBytes
  }, 0)

  var dbPromise = null
  var modelLoadPromise = null
  var recognizer = null
  var runtimeModule = null
  var runtimeReady = false

  function post(message) {
    self.postMessage(message)
  }

  function describeError(error) {
    return error instanceof Error ? error.message : String(error)
  }

  // ---------------------------------------------------------------------------
  // IndexedDB cache
  // ---------------------------------------------------------------------------

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        var request = indexedDB.open(DB_NAME, 1)
        request.onupgradeneeded = function () {
          request.result.createObjectStore(DB_STORE)
        }
        request.onsuccess = function () {
          resolve(request.result)
        }
        request.onerror = function () {
          reject(request.error || new Error('Cannot open the model cache'))
        }
      })
    }
    return dbPromise
  }

  function readCachedBlob(key) {
    return openDb().then(
      (db) =>
        new Promise(function (resolve, reject) {
          var request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key)
          request.onsuccess = function () {
            var value = request.result
            resolve(value instanceof Blob ? value : null)
          }
          request.onerror = function () {
            reject(request.error || new Error('Cannot read the model cache'))
          }
        }),
    )
  }

  function writeCachedBlob(key, blob) {
    return openDb().then(
      (db) =>
        new Promise(function (resolve, reject) {
          var request = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(blob, key)
          request.onsuccess = function () {
            resolve()
          }
          request.onerror = function () {
            reject(request.error || new Error('Cannot write the model cache'))
          }
        }),
    )
  }

  // ---------------------------------------------------------------------------
  // Model download (mirror fallback + progress)
  // ---------------------------------------------------------------------------

  // A hanging mirror (DNS black hole, stalled CDN) must not wedge the
  // download: this is a STALL timeout — no bytes for this long aborts the
  // source and the next mirror is tried. A slow-but-alive download is never
  // interrupted.
  var SOURCE_TIMEOUT_MS = 30000

  function fetchFromSource(source, expectedBytes, onProgress) {
    var controller = new AbortController()
    var stallTimer = setTimeout(function () {
      controller.abort()
    }, SOURCE_TIMEOUT_MS)
    var resetStallTimer = function () {
      clearTimeout(stallTimer)
      stallTimer = setTimeout(function () {
        controller.abort()
      }, SOURCE_TIMEOUT_MS)
    }

    return fetch(source, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${source} → HTTP ${response.status}`)

        var reader = response.body ? response.body.getReader() : null
        if (!reader) {
          var buffer = await response.arrayBuffer()
          if (buffer.byteLength !== expectedBytes) {
            throw new Error(`${source} → unexpected size ${buffer.byteLength}`)
          }
          onProgress(expectedBytes)
          return buffer
        }

        var received = 0
        var chunks = []
        for (;;) {
          var step = await reader.read()
          if (step.done) break
          chunks.push(step.value)
          received += step.value.byteLength
          resetStallTimer()
          onProgress(received)
        }
        var merged = new Uint8Array(received)
        var offset = 0
        for (var chunk of chunks) {
          merged.set(chunk, offset)
          offset += chunk.byteLength
        }
        if (received !== expectedBytes) {
          throw new Error(`${source} → unexpected size ${received}`)
        }
        return merged.buffer
      })
      .finally(function () {
        clearTimeout(stallTimer)
      })
  }

  function downloadFile(file, onProgress) {
    var lastError = null
    var attempt = function (index) {
      if (index >= file.sources.length) {
        return Promise.reject(new Error(`Dolphin model download failed: ${describeError(lastError)}`))
      }
      return fetchFromSource(file.sources[index], file.expectedBytes, onProgress).catch(function (error) {
        lastError = error
        return attempt(index + 1)
      })
    }
    return attempt(0)
  }

  function ensureModelBuffers() {
    var buffers = {}
    var loadedBytes = 0

    var loadNext = function (index) {
      if (index >= MODEL_FILES.length) return Promise.resolve(buffers)

      var file = MODEL_FILES[index]
      var cacheKey = `${MODEL_ID}:${file.name}`
      return readCachedBlob(cacheKey).then(async (cached) => {
        if (cached && cached.size === file.expectedBytes) {
          loadedBytes += cached.size
          post({
            type: 'MODEL_PROGRESS',
            progress: Math.min(100, Math.round((loadedBytes / TOTAL_BYTES) * 100)),
          })
          buffers[file.name] = await cached.arrayBuffer()
          return loadNext(index + 1)
        }

        var downloaded = await downloadFile(file, function (received) {
          var total = loadedBytes + received
          post({
            type: 'MODEL_PROGRESS',
            progress: Math.min(100, Math.round((total / TOTAL_BYTES) * 100)),
          })
        })
        // Cache writes are best-effort: a failure only costs a re-download next
        // session and must not abort a successful download.
        try {
          await writeCachedBlob(cacheKey, new Blob([downloaded]))
        } catch (error) {
          console.warn('[AuraLang] Dolphin model cache write failed:', describeError(error))
        }
        loadedBytes += file.expectedBytes
        buffers[file.name] = downloaded
        return loadNext(index + 1)
      })
    }

    return loadNext(0)
  }

  // ---------------------------------------------------------------------------
  // sherpa-onnx runtime
  // ---------------------------------------------------------------------------

  function loadRuntime() {
    return new Promise(function (resolve) {
      runtimeModule = {
        // Skip the glue's build-time-embedded .data package (an older Dolphin
        // base + VAD bundle); this worker loads the model files itself.
        skipBundledDataPackage: true,
        // In a worker, self.location.href is THIS script (workers/…), not the
        // glue's — Emscripten would 404 the .wasm and spawn pthread workers
        // from the wrong script. Pin both explicitly.
        mainScriptUrlOrBlob: RUNTIME_BASE_URL + 'sherpa-onnx-wasm-main-vad-asr.js',
        locateFile: function (path) {
          return RUNTIME_BASE_URL + path
        },
        print: function () {},
        printErr: function (text) {
          console.error('[AuraLang] Dolphin runtime:', text)
        },
        onRuntimeInitialized: function () {
          runtimeReady = true
          resolve()
        },
      }
      // The glue reads `Module` from global scope when imported.
      self.Module = runtimeModule
      importScripts(
        RUNTIME_BASE_URL + 'sherpa-onnx-wasm-main-vad-asr.js',
        RUNTIME_BASE_URL + 'sherpa-onnx-asr.js',
      )
    })
  }

  function createRecognizer(buffers) {
    // Same call shape the runtime's own file packager uses; this build exports
    // only the function, not the whole FS object.
    runtimeModule.FS_createDataFile(
      FS_MODEL_PATH,
      null,
      new Uint8Array(buffers['model.int8.onnx']),
      true,
      true,
      true,
    )
    runtimeModule.FS_createDataFile(
      FS_TOKENS_PATH,
      null,
      new Uint8Array(buffers['tokens.txt']),
      true,
      true,
      true,
    )

    return new OfflineRecognizer(
      {
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          dolphin: { model: FS_MODEL_PATH },
          tokens: FS_TOKENS_PATH,
          numThreads: 1,
          provider: 'cpu',
          debug: 0,
        },
      },
      runtimeModule,
    )
  }

  function ensureModel() {
    if (recognizer) return Promise.resolve()
    if (modelLoadPromise) return modelLoadPromise

    modelLoadPromise = (async () => {
      try {
        if (!runtimeReady) await loadRuntime()
        var buffers = await ensureModelBuffers()
        try {
          recognizer = createRecognizer(buffers)
        } catch (error) {
          throw new Error(`Dolphin model load failed: ${describeError(error)}`)
        }
        post({ type: 'MODEL_READY' })
      } catch (error) {
        modelLoadPromise = null
        post({ type: 'MODEL_ERROR', message: describeError(error) })
        throw error
      }
    })()

    return modelLoadPromise
  }

  function transcribe(message) {
    ensureModel()
      .then(function () {
        var stream = recognizer.createStream()
        stream.acceptWaveform(16000, message.samples)
        recognizer.decode(stream)
        var result = recognizer.getResult(stream)
        stream.free()
        post({ type: 'TRANSCRIBE_RESULT', id: message.id, text: (result && result.text) || '' })
      })
      .catch(function (error) {
        var described = describeError(error)
        // Download/load failures already carry their own prefix.
        if (described.startsWith('Dolphin model ')) {
          post({ type: 'TRANSCRIBE_ERROR', id: message.id, message: described })
          return
        }
        post({
          type: 'TRANSCRIBE_ERROR',
          id: message.id,
          message: `Dolphin transcription failed: ${described}`,
        })
      })
  }

  self.onmessage = function (event) {
    var message = event.data
    if (!message || typeof message.type !== 'string') return
    if (message.type === 'ENSURE_MODEL') {
      void ensureModel()
      return
    }
    if (message.type === 'TRANSCRIBE' && typeof message.id === 'number' && message.samples) {
      transcribe(message)
    }
  }
})()
