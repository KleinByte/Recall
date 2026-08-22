const moduleName = process.argv[2]

if (!moduleName) {
  throw new Error("Native probe requires a module name.")
}

if (moduleName === "onnxruntime-node") {
  const fs = require("node:fs")
  const path = require("node:path")
  const ort = require(moduleName)
  const modelPath = process.argv[3]
  if (!modelPath) throw new Error("ONNX Runtime probe requires a model path.")
  const manifest = JSON.parse(
    fs.readFileSync(path.join(path.dirname(path.resolve(modelPath)), "manifest.json"), "utf8"),
  )
  ;(async () => {
    const session = await ort.InferenceSession.create(path.resolve(modelPath), {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
    })
    const input = new ort.Tensor("float32", new Float32Array(3 * 256 * 256), [1, 3, 256, 256])
    const output = await session.run({ images: input })
    const prediction = output[session.outputNames[0]]
    const expectedShape = `1x${manifest.classCount + 4}x1344`
    if (!prediction || prediction.dims.join("x") !== expectedShape) {
      throw new Error("ONNX Runtime returned an unexpected minimap model shape.")
    }
    await session.release()
    console.log(
      `${moduleName} loaded and ran the minimap model successfully ` +
      `(Node ${process.versions.node}, ABI ${process.versions.modules}).`,
    )
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const Database = require(moduleName)
  const database = new Database(":memory:")

  try {
    const result = database.prepare("SELECT 1 AS healthy").get()
    if (result?.healthy !== 1) {
      throw new Error(`${moduleName} returned an unexpected SQLite result.`)
    }
    console.log(
      `${moduleName} loaded successfully (Node ${process.versions.node}, ABI ${process.versions.modules}).`,
    )
  } finally {
    database.close()
  }
}
