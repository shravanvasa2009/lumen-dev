import SwiftUI
import WidgetKit
import os

private let hour: TimeInterval = 3600
// How far ahead one timeline reaches; .atEnd then asks for the next one.
private let timelineHours = 12
// The lock-screen ring empties over the day after a check (LockWidget.kt FRESH_HOURS).
private let freshHours: Double = 24

struct SnapshotEntry: TimelineEntry {
  let date: Date
  // nil before the app first publishes, or when the App Group cannot be read: the widget then draws the empty
  // state from WidgetFallback.swift and still opens a check.
  let content: WidgetContent?
}

// https://developer.apple.com/documentation/widgetkit/timelineprovider
struct SnapshotProvider: TimelineProvider {
  private let log = Logger(subsystem: "lumen.widget", category: "snapshot")

  func placeholder(in context: Context) -> SnapshotEntry {
    SnapshotEntry(date: Date(), content: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
    completion(SnapshotEntry(date: Date(), content: storedContent()))
  }

  // "Last check n h ago" and the lock-screen ring move on every hour after the reading, and the inline line
  // switches back from "next check" once that time passes, so the timeline redraws at those moments. The app
  // reloads it on every publish (WidgetCenter.reloadAllTimelines).
  func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
    let now = Date()
    let content = storedContent()
    var dates = [now]
    if let lastReadingAt = content?.snapshot.lastReadingAt {
      let hoursSince = max(0, (now.timeIntervalSince(lastReadingAt) / hour).rounded(.down))
      dates += (1...timelineHours).map { lastReadingAt.addingTimeInterval((hoursSince + Double($0)) * hour) }
    }
    if let nextCheck = content?.snapshot.nextConfirmationAt, nextCheck > now {
      dates.append(nextCheck)
    }
    let entries = dates.sorted().map { SnapshotEntry(date: $0, content: content) }
    completion(Timeline(entries: entries, policy: dates.count > 1 ? .atEnd : .never))
  }

  // A snapshot the widget cannot read is drawn as the no-data state, which still opens a check; the log shows
  // why in Console.app.
  private func storedContent() -> WidgetContent? {
    do {
      return try WidgetStore.read()
    } catch {
      log.error("Widget snapshot unreadable: \(error.localizedDescription, privacy: .public)")
      return nil
    }
  }
}

// What the widgets draw at one moment, from the published copy (the same rules as WidgetView.kt).
struct WidgetLines {
  let name: String
  let title: String
  let detail: String?
  let inline: String
  let bpm: String?
  let bpmUnit: String
  let checkNow: String
  let fullScan: String
  // The Appendix B status ("regular", "check-again", "see-doctor", "inconclusive"); nil before the first reading.
  let statusKey: String?
  // The lock-screen rectangle's second line: the status only, never a value (WID-2).
  let lockStatus: String?
  // 1 right after a check, 0 a day later and before the first one.
  let freshness: Double

  init(_ content: WidgetContent, at date: Date) {
    let snapshot = content.snapshot
    let display = content.display
    name = display.name
    statusKey = snapshot.status
    let status = snapshot.status.flatMap { display.status[$0] }
    lockStatus = status
    title = status ?? display.empty.title
    let lastCheck = snapshot.lastReadingAt.map {
      let hours = max(0, Int(date.timeIntervalSince($0) / hour))
      return display.lastCheck.replacingOccurrences(of: "{{hours}}", with: String(hours))
    }
    detail = snapshot.status == nil ? display.empty.body : lastCheck
    if let nextCheck = snapshot.nextConfirmationAt, nextCheck > date {
      let style = Date.FormatStyle(date: .omitted, time: .shortened, locale: Locale(identifier: display.language))
      inline = display.nextCheck.replacingOccurrences(of: "{{time}}", with: nextCheck.formatted(style))
    } else {
      inline = snapshot.status.flatMap { display.inline[$0] } ?? display.name
    }
    // The snapshot already drops hrBpm when values are hidden; checking hideValues too keeps a stale snapshot
    // from ever showing a number the user asked to hide.
    bpm = snapshot.hideValues ? nil : snapshot.hrBpm.map { String($0) }
    bpmUnit = display.bpm
    checkNow = display.checkNow
    fullScan = display.fullScan
    freshness = snapshot.lastReadingAt.map {
      min(1, max(0, 1 - date.timeIntervalSince($0) / (freshHours * hour)))
    } ?? 0
  }
}

struct LumenWidgetView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme
  let entry: SnapshotEntry

  var body: some View {
    let lines = entry.content.map { WidgetLines($0, at: entry.date) }
    switch family {
    case .accessoryCircular:
      // Widgets mockup: the ring with the mark inside. The ring tells how long ago the last check was, never what
      // it found (WID-2).
      ZStack {
        AccessoryWidgetBackground()
        Ring(fraction: lines?.freshness ?? 0, track: .primary.opacity(0.25), arc: .primary, width: 5)
          .padding(3)
        LumenMark().padding(16)
      }
      .widgetURL(LumenLink.check)
      .widgetBackground(.clear, padded: false)
    case .accessoryRectangular:
      lockRectangle(lines).widgetURL(LumenLink.check).widgetBackground(.clear, padded: false)
    case .accessoryInline:
      // Inline widgets draw one line of system-styled text, with the mark as its image ("Lumen: next check 8 PM").
      Label {
        Text(lines?.inline ?? appDisplayName)
      } icon: {
        LumenMark()
      }
      .widgetURL(LumenLink.check)
      .widgetBackground(.clear, padded: false)
    default:
      homeWidget(lines)
    }
  }

  // Lock screen (WID-2): only the name and the status line, both from lockscreen.json. No number, ever.
  @ViewBuilder private func lockRectangle(_ lines: WidgetLines?) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(lines?.name ?? appDisplayName).font(.headline).widgetAccentable()
      Text(lines?.lockStatus ?? fallbackCopy.emptyTitle).font(.body).foregroundStyle(.secondary).lineLimit(2)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder private func homeWidget(_ lines: WidgetLines?) -> some View {
    let colors = entry.content.map { WidgetColors($0.display.palette, theme: $0.snapshot.theme, scheme: scheme) }
    let shown = lines.map { HomeLines(lines: $0) } ?? HomeLines.fallback
    Group {
      if family == .systemMedium {
        MediumWidget(lines: shown, colors: colors)
      } else {
        SmallWidget(lines: shown, colors: colors)
      }
    }
    .widgetURL(LumenLink.check)
    .widgetBackground(colors?.surface ?? Color(uiColor: .systemBackground), padded: true)
  }
}

// What the home-screen widgets draw: the published copy, or before the first publish (and in the widget gallery)
// the fallback copy with no status.
private struct HomeLines {
  let name: String
  let title: String
  let detail: String?
  let bpm: String?
  let bpmUnit: String
  let checkNow: String
  let fullScan: String
  let statusKey: String?

  init(lines: WidgetLines) {
    name = lines.name
    title = lines.title
    detail = lines.detail
    bpm = lines.bpm
    bpmUnit = lines.bpmUnit
    checkNow = lines.checkNow
    fullScan = lines.fullScan
    statusKey = lines.statusKey
  }

  private init(fallback: FallbackCopy) {
    name = appDisplayName
    title = fallback.emptyTitle
    detail = fallback.emptyBody
    bpm = nil
    bpmUnit = ""
    checkNow = fallback.checkNow
    fullScan = fallback.fullScan
    statusKey = nil
  }

  static let fallback = HomeLines(fallback: fallbackCopy)
}

// A ring drawn clockwise from the top, as in the Widgets mockup (40 pt, stroke 5).
private struct Ring: View {
  let fraction: Double
  let track: Color
  let arc: Color
  let width: CGFloat

  var body: some View {
    ZStack {
      Circle().stroke(track, lineWidth: width)
      Circle()
        .trim(from: 0, to: fraction)
        .stroke(arc, style: StrokeStyle(lineWidth: width, lineCap: fraction < 1 ? .round : .butt))
        .rotationEffect(.degrees(-90))
    }
  }
}

// The small widget's status ring (WidgetView.kt statusRing): full in the accent while up to date, two thirds in the
// flag color when the reading asks for another check, and in the critical color when it suggests a doctor.
private func statusRing(_ key: String?, _ colors: WidgetColors) -> (fraction: Double, color: Color)? {
  switch key {
  case nil: return nil
  case "regular": return (1, colors.accent)
  case "see-doctor": return (2.0 / 3, colors.criticalText)
  default: return (2.0 / 3, colors.flag)
  }
}

private struct Pill: View {
  let label: String
  let fill: Color
  let content: Color
  let height: CGFloat

  var body: some View {
    Text(label)
      .font(.subheadline.weight(.semibold))
      .foregroundColor(content)
      .lineLimit(1)
      .minimumScaleFactor(0.8)
      .frame(maxWidth: .infinity, minHeight: height, maxHeight: height)
      .background(Capsule().fill(fill))
  }
}

// Widgets mockup, small: the status ring and the mark, the status, how long ago, and "Check now". Before the first
// reading a larger mark stands alone. A small widget takes only one tap target, so the whole widget opens the Quick
// Check.
private struct SmallWidget: View {
  let lines: HomeLines
  let colors: WidgetColors?

  var body: some View {
    let accent = colors?.accent ?? fallbackButtonFill
    VStack(alignment: .leading, spacing: 0) {
      if let colors, let ring = statusRing(lines.statusKey, colors) {
        HStack(alignment: .top) {
          Ring(fraction: ring.fraction, track: colors.ringTrack, arc: ring.color, width: 5).frame(width: 40, height: 40)
          Spacer(minLength: 0)
          LumenMark().frame(width: 20, height: 20).foregroundColor(accent)
        }
      } else {
        LumenMark().frame(width: 28, height: 28).foregroundColor(accent)
      }
      Spacer(minLength: 4)
      Text(lines.title)
        .font(.system(size: lines.title.count <= 12 ? 17 : 15, weight: .semibold))
        .foregroundColor(colors?.text ?? .primary)
        .lineLimit(2)
        .minimumScaleFactor(0.85)
      if let detail = lines.detail {
        Text(detail).font(.caption).foregroundColor(colors?.textDim ?? .secondary).lineLimit(1)
      }
      Pill(
        label: lines.checkNow,
        fill: colors?.buttonFill ?? fallbackButtonFill,
        content: colors?.onButtonFill ?? fallbackOnButtonFill,
        height: 32
      )
      .padding(.top, 8)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

// Widgets mockup, medium: the mark and name top left, the heart rate (unless hidden) in the middle, the status and
// how long ago at the bottom left, and "Check now" over a tonal "Full Scan" on the right, each its own link.
private struct MediumWidget: View {
  let lines: HomeLines
  let colors: WidgetColors?

  var body: some View {
    let text = colors?.text ?? .primary
    let dim = colors?.textDim ?? .secondary
    HStack(spacing: 16) {
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 4) {
          LumenMark().frame(width: 16, height: 16).foregroundColor(colors?.accent ?? fallbackButtonFill)
          Text(lines.name).font(.footnote).foregroundColor(dim).lineLimit(1)
        }
        Spacer(minLength: 0)
        if let bpm = lines.bpm, lines.statusKey != nil {
          HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(bpm).font(.system(size: 44, weight: .semibold, design: .rounded)).foregroundColor(text)
            Text(lines.bpmUnit).font(.system(size: 17, weight: .medium)).foregroundColor(dim)
          }
          .lineLimit(1)
          .minimumScaleFactor(0.7)
          Spacer(minLength: 0)
        }
        Text(lines.title).font(.subheadline.weight(.semibold)).foregroundColor(text).lineLimit(2)
        if let detail = lines.detail {
          Text(detail).font(.footnote).foregroundColor(dim).lineLimit(1)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      VStack(spacing: 8) {
        Link(destination: LumenLink.check) {
          Pill(
            label: lines.checkNow,
            fill: colors?.buttonFill ?? fallbackButtonFill,
            content: colors?.onButtonFill ?? fallbackOnButtonFill,
            height: 40
          )
        }
        Link(destination: LumenLink.fullScan) {
          Pill(
            label: lines.fullScan,
            fill: colors?.tonalFill ?? Color(uiColor: .secondarySystemFill),
            content: colors?.onTonalFill ?? .primary,
            height: 40
          )
        }
      }
      .frame(width: 148)
    }
  }
}

// https://developer.apple.com/documentation/widgetkit/staticconfiguration
struct LumenWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "LumenWidget", provider: SnapshotProvider()) { entry in
      LumenWidgetView(entry: entry)
    }
    // The gallery shows the app's name (spec §2), this line, and the empty state as the preview until the app
    // first publishes.
    .configurationDisplayName(appDisplayName)
    .description(fallbackCopy.description)
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}
