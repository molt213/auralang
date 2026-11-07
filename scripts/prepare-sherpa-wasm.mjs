// Stages the sherpa-onnx WebAssembly runtime into public/wasm/ for bundling.
//
// The upstream glue (sherpa-onnx-wasm-main-vad-asr.js) unconditionally fetches
// a build-time-embedded .data package (the Dolphin *base* model + Silero VAD =
// 104,878,318 bytes) at startup. AuraLang wants to load the model at runtime
// from a user-chosen tier instead, so the embedded package call is gated
// behind Module.skipBundledDataPackage, which the ASR worker sets before
// loading the glue. That is the only change; the asset stays byte-identical
// otherwise. The assertion below fails the build if a future upstream release
// changes the packaging shape, so this patch cannot silently rot.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = join(root, 'vendor', 'sherpa-onnx-wasm')
const outDir = join(root, 'public', 'wasm', 'sherpa-onnx-vad-asr')

const BUNDLED_PACKAGE_CALL =
  'loadPackage({files:[{filename:"/dolphin.onnx",start:0,end:103729802},{filename:"/silero_vad.onnx",start:103729802,end:104373656},{filename:"/tokens.txt",start:104373656,end:104878318}],remote_package_size:104878318})'

mkdirSync(outDir, { recursive: true })

for (const file of ['sherpa-onnx-wasm-main-vad-asr.js', 'sherpa-onnx-asr.js']) {
  const source = readFileSync(join(sourceDir, file), 'utf8')
  if (file === 'sherpa-onnx-wasm-main-vad-asr.js') {
    if (!source.includes(BUNDLED_PACKAGE_CALL)) {
      throw new Error(
        'sherpa-onnx glue no longer matches the expected data-package call. Review vendor/sherpa-onnx-wasm and update scripts/prepare-sherpa-wasm.mjs before patching.',
      )
    }
    writeFileSync(
      join(outDir, file),
      source.replace(BUNDLED_PACKAGE_CALL, `if(!Module["skipBundledDataPackage"])${BUNDLED_PACKAGE_CALL}`),
    )
    continue
  }
  writeFileSync(join(outDir, file), source)
}

copyFileSync(
  join(sourceDir, 'sherpa-onnx-wasm-main-vad-asr.wasm'),
  join(outDir, 'sherpa-onnx-wasm-main-vad-asr.wasm'),
)

console.log('[prepare-sherpa-wasm] staged patched sherpa-onnx wasm runtime →', outDir)
