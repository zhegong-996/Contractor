// Local, offline visual model for independent acceptance review.
// Uses Apple's on-device Vision models (OCR + image classification). No network,
// no downloadable weights, no API key: business screenshots never leave the Mac.
// Output: one line prefixed with SUITME_VISION_RESULT= followed by JSON.
import Foundation
import Vision
import AppKit

struct TextHit: Codable { let text: String; let confidence: Double }
struct ClassHit: Codable { let identifier: String; let confidence: Double }
struct VisionResult: Codable {
  let engine: String
  let width: Int
  let height: Int
  let texts: [TextHit]
  let classifications: [ClassHit]
  let meanLuminance: Double
  let luminanceSpread: Double
  let combinedText: String
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(("SUITME_VISION_ERROR: " + message + "\n").data(using: .utf8)!)
  exit(2)
}

let args = CommandLine.arguments
guard args.count >= 2 else { fail("usage: apple-vision.swift <image-path>") }
let path = args[1]
guard FileManager.default.fileExists(atPath: path) else { fail("image not found: \(path)") }
let url = URL(fileURLWithPath: path)
guard let image = NSImage(contentsOf: url), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  fail("cannot decode image: \(path)")
}

let handler = VNImageRequestHandler(cgImage: cg, options: [:])
let textRequest = VNRecognizeTextRequest()
textRequest.recognitionLevel = .accurate
textRequest.usesLanguageCorrection = true
textRequest.recognitionLanguages = ["zh-Hans", "en-US"]
let classifyRequest = VNClassifyImageRequest()
do { try handler.perform([textRequest, classifyRequest]) } catch { fail("Vision requests failed: \(error)") }

let textObservations: [VNRecognizedTextObservation] = textRequest.results ?? []
var textHits: [TextHit] = []
for observation in textObservations {
  guard let candidate = observation.topCandidates(1).first else { continue }
  textHits.append(TextHit(text: candidate.string, confidence: Double(candidate.confidence)))
}
let texts: [TextHit] = textHits

let classObservations: [VNClassificationObservation] = classifyRequest.results ?? []
var classHits: [ClassHit] = []
for observation in classObservations.prefix(8) {
  classHits.append(ClassHit(identifier: observation.identifier, confidence: Double(observation.confidence)))
}
let classes: [ClassHit] = classHits.filter { $0.confidence > 0.02 }.sorted { $0.confidence > $1.confidence }

// Cheap pixel statistics: a blank / fully black screenshot is not evidence
// of a working UI, even if an OCR model hallucinated a word.
let w = 64, h = 64
let colorSpace = CGColorSpaceCreateDeviceRGB()
var pixels = [UInt8](repeating: 0, count: w * h * 4)
guard let context = CGContext(data: &pixels, width: w, height: h, bitsPerComponent: 8,
  bytesPerRow: w * 4, space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
  fail("cannot create pixel context")
}
context.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
var sum = 0.0, sumSq = 0.0
for i in stride(from: 0, to: pixels.count, by: 4) {
  let lum = 0.2126 * Double(pixels[i]) + 0.7152 * Double(pixels[i + 1]) + 0.0722 * Double(pixels[i + 2])
  sum += lum; sumSq += lum * lum
}
let n = Double(w * h)
let mean = sum / n
let spread = (sumSq / n - mean * mean).squareRoot()

let result = VisionResult(engine: "apple-vision-on-device", width: cg.width, height: cg.height,
  texts: texts, classifications: classes, meanLuminance: mean, luminanceSpread: spread,
  combinedText: texts.map(\.text).joined(separator: "\n"))
let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
guard let data = try? encoder.encode(result), let json = String(data: data, encoding: .utf8) else {
  fail("cannot encode Vision result")
}
print("SUITME_VISION_RESULT=" + json)
