import AppKit

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."

let letterforms = [
  "M15 35.7 L35 35.7 L104.28 107.3 L84.28 107.3 L32.97 54.28 L32.97 107.3 L15 107.3ZM85.72 35.7 L104.28 35.7 L104.28 102.51 L85.72 83.33Z",
  "M115.58 35.7 L134.13 35.7 L160.51 69.21 L186.88 35.7 L205.43 35.7 L205.43 107.3 L188.33 107.3 L188.33 58.51 L160.51 92.78 L132.68 58.51 L132.68 107.3 L115.58 107.3Z",
  "M215.29 35.7 L232.68 35.7 L232.68 107.3 L215.29 107.3ZM270.94 35.7 L293.84 35.7 L257.75 69.21 L295 107.3 L271.52 107.3 L235.87 69.38Z",
]

func color(_ hex: String) -> NSColor {
  let v = Int(hex.dropFirst(), radix: 16)!
  return NSColor(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
}

func canvas(_ w: Int, _ h: Int, _ draw: () -> Void) -> NSBitmapImageRep {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4,
                             hasAlpha: true, isPlanar: false, colorSpaceName: .calibratedRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  let ctx = NSGraphicsContext(bitmapImageRep: rep)!
  NSGraphicsContext.saveGraphicsState()

  let flipped = NSGraphicsContext(cgContext: ctx.cgContext, flipped: true)
  NSGraphicsContext.current = flipped
  ctx.cgContext.translateBy(x: 0, y: CGFloat(h))
  ctx.cgContext.scaleBy(x: 1, y: -1)
  ctx.imageInterpolation = .high
  ctx.shouldAntialias = true
  draw()
  NSGraphicsContext.restoreGraphicsState()
  return rep
}

func text(_ s: String, _ x: CGFloat, _ baseline: CGFloat, _ font: NSFont, _ fill: NSColor, kern: CGFloat = 0) {
  let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: fill, .kern: kern]
  NSAttributedString(string: s, attributes: attrs).draw(at: NSPoint(x: x, y: baseline - font.ascender))
}

func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ fill: NSColor) {
  fill.setFill(); NSRect(x: x, y: y, width: w, height: h).fill()
}

func mark(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ fill: NSColor) {
  let sx = w / 310, sy = h / 145
  let path = NSBezierPath()
  for d in letterforms {
    let tokens = d.replacingOccurrences(of: "M", with: " M ").replacingOccurrences(of: "L", with: " L ")
      .replacingOccurrences(of: "Z", with: " Z ").split(separator: " ").map(String.init)
    var i = 0
    while i < tokens.count {
      switch tokens[i] {
      case "M": path.move(to: NSPoint(x: x + CGFloat(Double(tokens[i + 1])!) * sx, y: y + CGFloat(Double(tokens[i + 2])!) * sy)); i += 3
      case "L": path.line(to: NSPoint(x: x + CGFloat(Double(tokens[i + 1])!) * sx, y: y + CGFloat(Double(tokens[i + 2])!) * sy)); i += 3
      case "Z": path.close(); i += 1
      default: i += 1
      }
    }
  }
  path.windingRule = .nonZero
  fill.setFill(); path.fill()
}

func save(_ rep: NSBitmapImageRep, _ name: String) {
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(outDir)/\(name)"))
  print("wrote \(outDir)/\(name)")
}

let ink = color("#1d1b19")

let labelW: CGFloat = 276, labelH: CGFloat = 117
let S = 1024 / labelW
let label = canvas(1024, Int((1024 * labelH / labelW).rounded())) {
  let g = NSGradient(starting: color("#ebe7e3"), ending: color("#e5e0dc"))!
  g.draw(in: NSRect(x: 0, y: 0, width: 1024, height: 1024 * labelH / labelW), angle: 90)
  func r(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ c: NSColor) { rect(x * S, y * S, w * S, h * S, c) }
  func t(_ s: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat, _ weight: NSFont.Weight, _ c: NSColor, width: CGFloat? = nil, right: Bool = false) {
    let font = NSFont(name: "Inter-Bold", size: size * S).flatMap { weight == .bold ? $0 : nil } ?? .systemFont(ofSize: size * S, weight: weight)
    let natural = NSAttributedString(string: s, attributes: [.font: font]).size().width
    let kern = width.map { ($0 * S - natural) / CGFloat(max(1, s.count - 1)) } ?? 0
    let w = natural + kern * CGFloat(max(0, s.count - 1))
    text(s, right ? x * S - w : x * S, y * S, font, c, kern: min(0, kern))
  }
  r(5, 5.5, labelW - 10, 3.6, ink)
  t("NAIMAKES FORUM", 8, 37, 21, .bold, ink, width: 176)
  r(193, 21, 75, 15, ink)
  for (x, w) in [(247.0, 3.0), (253, 2), (258, 4), (264, 1.6)] { r(CGFloat(x), 24, CGFloat(w), 9, color("#e9e4e0")) }
  t("INTERNAL DATABASE", 10, 55, 8.5, .medium, color("#b7afa8"), width: 122)
  t("INFO", 268, 58, 17.5, .semibold, ink, right: true)
  r(5, 61.5, labelW - 10, 1.2, ink.withAlphaComponent(0.5))
  r(202.5, 63, 1, 47, ink.withAlphaComponent(0.22))
  t("NO.001", 10, 101, 33, .medium, ink, width: 124)
  let k: CGFloat = 57 / 280
  mark((210 - 15 * k) * S, (80 - 35.7 * k) * S, 310 * k * S, 145 * k * S, ink)
  r(5, 111.5, labelW - 10, 1.2, ink.withAlphaComponent(0.28))
}
save(label, "nmk_label.png")
