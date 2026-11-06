// On-device text embedding for semantic recall. Uses Apple's built-in
// NaturalLanguage word embeddings (300-dim, simplified Chinese + English).
// No API key, no download, no network. Called in batch from src/semantic-recall.ts.
// Input (stdin): {"texts":["...","..."]}
// Output (stdout): SUITME_EMBEDDING_RESULT=<json>
import Foundation
import NaturalLanguage

struct EmbeddingInput: Decodable { let texts: [String] }
struct EmbeddingOutput: Codable {
  let engine: String
  let dimension: Int
  let vectors: [[Double]]
  let oovTokens: [Int]
  let containsChinese: Bool
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(("SUITME_EMBEDDING_ERROR: " + message + "\n").data(using: .utf8)!)
  exit(2)
}

let data = FileHandle.standardInput.readDataToEndOfFile()
let input: EmbeddingInput
do { input = try JSONDecoder().decode(EmbeddingInput.self, from: data) }
catch { fail("invalid input JSON: \(error)") }
guard let zh = NLEmbedding.wordEmbedding(for: .simplifiedChinese) else { fail("device has no Chinese word embedding") }
let en = NLEmbedding.wordEmbedding(for: .english)
let half = 300

func normalise(_ values: [Double]) -> [Double] {
  var norm = 0.0
  for value in values { norm += value * value }
  norm = norm.squareRoot()
  if norm < 1e-9 { return values }
  return values.map { value in
    let rounded = (value / norm * 10000).rounded() / 10000
    return rounded
  }
}

func tokenise(_ text: String) -> [String] {
  var tokens: [String] = []
  let tokenizer = NLTokenizer(unit: .word)
  tokenizer.string = text
  let full = text.startIndex..<text.endIndex
  tokenizer.enumerateTokens(in: full) { range, _ in
    let token = String(text[range]).trimmingCharacters(in: .whitespacesAndNewlines)
    if !token.isEmpty { tokens.append(token) }
    return true
  }
  // Chinese word segmentation misses short compounds; character bigrams give
  // the embedding a second chance without inventing any external vocabulary.
  let chars = Array(text)
  for i in 0..<max(0, chars.count - 1) {
    let a = chars[i], b = chars[i + 1]
    if a.isLetter && b.isLetter && (String(a).unicodeScalars.first?.value ?? 0) > 127 {
      tokens.append(String(a) + String(b))
    }
  }
  return tokens
}

func vectorFor(_ text: String) -> ([Double], Int) {
  var zhSum = [Double](repeating: 0, count: half)
  var enSum = [Double](repeating: 0, count: half)
  var zhCount = 0, enCount = 0, oov = 0
  for token in tokenise(text) {
    if let vector = zh.vector(for: token) {
      for i in 0..<min(half, vector.count) { zhSum[i] += Double(vector[i]) }
      zhCount += 1
    } else if let embedding = en, let vector = embedding.vector(for: token.lowercased()) {
      for i in 0..<min(half, vector.count) { enSum[i] += Double(vector[i]) }
      enCount += 1
    } else { oov += 1 }
  }
  if zhCount > 0 { zhSum = zhSum.map { $0 / Double(zhCount) } }
  if enCount > 0 { enSum = enSum.map { $0 / Double(enCount) } }
  return (normalise(zhSum) + normalise(enSum), oov)
}

var vectors: [[Double]] = []
var oovCounts: [Int] = []
var hasChinese = false
for text in input.texts {
  if text.unicodeScalars.contains(where: { $0.value > 127 }) { hasChinese = true }
  let pair = vectorFor(text)
  vectors.append(pair.0)
  oovCounts.append(pair.1)
}
let output = EmbeddingOutput(engine: "apple-nl-on-device-word-embedding", dimension: half * 2,
  vectors: vectors, oovTokens: oovCounts, containsChinese: hasChinese)
let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
guard let encoded = try? encoder.encode(output), let json = String(data: encoded, encoding: .utf8) else {
  fail("cannot encode embedding output")
}
print("SUITME_EMBEDDING_RESULT=" + json)
