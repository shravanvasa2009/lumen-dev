import SwiftUI
import WidgetKit
import os

private let hour: TimeInterval = 3600
// How far ahead one timeline reaches; .atEnd then asks for the next one.
private let timelineHours = 12

struct SnapshotEntry: TimelineEntry {
  let date: Date
  // nil before the app first publishes, or when the App Group cannot be read: the widget then shows only the
  // Lumen mark and still opens a check.
  let content: WidgetContent?
}

struct SnapshotProvider: TimelineProvider {
  private let log = Logger(subsystem: "lumen.widget", category: "snapshot")

  func placeholder(in context: Context) -> SnapshotEntry {
    SnapshotEntry(date: Date(), content: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
    completion(SnapshotEntry(date: Date(), content: storedContent()))
  }

  // "Last check n h ago" moves on every hour after the reading, and the inline line switches back from "next
  // check" once that time passes, so the timeline redraws at those moments. The app reloads it on every publish.
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
  let status: String?
  let inline: String
  let lastCheck: String?
  let bpm: String?
  let bpmUnit: String
  let streak: String?
  let checkNow: String
  let fullScan: String

  init(_ content: WidgetContent, at date: Date) {
    let snapshot = content.snapshot
    let display = content.display
    name = display.name
    status = snapshot.status.flatMap { display.status[$0] }
    if let nextCheck = snapshot.nextConfirmationAt, nextCheck > date {
      let style = Date.FormatStyle(date: .omitted, time: .shortened, locale: Locale(identifier: display.language))
      inline = display.nextCheck.replacingOccurrences(of: "{{time}}", with: nextCheck.formatted(style))
    } else {
      inline = snapshot.status.flatMap { display.inline[$0] } ?? display.name
    }
    lastCheck = snapshot.lastReadingAt.map {
      let hours = max(0, Int(date.timeIntervalSince($0) / hour))
      return display.lastCheck.replacingOccurrences(of: "{{hours}}", with: String(hours))
    }
    // The snapshot already drops hrBpm when values are hidden; checking hideValues too keeps a stale snapshot
    // from ever showing a number the user asked to hide.
    bpm = snapshot.hideValues ? nil : snapshot.hrBpm.map { String($0) }
    bpmUnit = display.bpm
    streak =
      snapshot.streakDays > 0
      ? display.streak.replacingOccurrences(of: "{{days}}", with: String(snapshot.streakDays)) : nil
    checkNow = display.checkNow
    fullScan = display.fullScan
  }
}

struct LumenWidgetView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme
  let entry: SnapshotEntry

  var body: some View {
    switch family {
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        LumenMark().padding(12)
      }
      .widgetURL(LumenLink.check)
      .widgetBackground(.clear, padded: false)
    case .accessoryRectangular:
      lockRectangle.widgetURL(LumenLink.check).widgetBackground(.clear, padded: false)
    case .accessoryInline:
      // Inline widgets draw one line of system-styled text; it opens a check like the others.
      Text(entry.content.map { WidgetLines($0, at: entry.date).inline } ?? appDisplayName)
        .widgetURL(LumenLink.check)
        .widgetBackground(.clear, padded: false)
    default:
      homeWidget
    }
  }

  // Lock screen (WID-2): only the name and the status line, both from lockscreen.json. No number, ever.
  @ViewBuilder private var lockRectangle: some View {
    if let content = entry.content {
      let lines = WidgetLines(content, at: entry.date)
      VStack(alignment: .leading, spacing: 2) {
        Text(lines.name).font(.headline).widgetAccentable()
        if let status = lines.status {
          Text(status).font(.body).lineLimit(2)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    } else {
      LumenMark().frame(maxHeight: 28)
    }
  }

  @ViewBuilder private var homeWidget: some View {
    if let content = entry.content {
      let colors = WidgetColors(content.display.palette, theme: content.snapshot.theme, scheme: scheme)
      let lines = WidgetLines(content, at: entry.date)
      Group {
        if family == .systemMedium {
          MediumWidget(lines: lines, colors: colors)
        } else {
          SmallWidget(lines: lines, colors: colors)
        }
      }
      .widgetURL(LumenLink.check)
      .widgetBackground(colors.surface, padded: true)
    } else {
      EmptyWidget(medium: family == .systemMedium)
        .widgetURL(LumenLink.check)
        .widgetBackground(Color(uiColor: .systemBackground), padded: true)
    }
  }
}

// Before the app first publishes (and in the widget gallery): mockup 32's layout with the empty-state copy, in
// system colors because no palette has been published yet.
private struct EmptyWidget: View {
  let medium: Bool

  var body: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        LumenMark().frame(width: 26, height: 26).foregroundColor(fallbackAccentFill)
        Spacer(minLength: 0)
        Text(fallbackCopy.emptyTitle).font(.headline).foregroundColor(.primary).lineLimit(2)
        Text(fallbackCopy.emptyBody).font(.caption).foregroundColor(.secondary).lineLimit(1)
        if !medium {
          Pill(label: fallbackCopy.checkNow, fill: fallbackAccentFill, content: fallbackOnAccentFill)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      if medium {
        VStack(spacing: 8) {
          Link(destination: LumenLink.check) {
            Pill(label: fallbackCopy.checkNow, fill: fallbackAccentFill, content: fallbackOnAccentFill)
          }
          Link(destination: LumenLink.fullScan) {
            Pill(label: fallbackCopy.fullScan, fill: Color(uiColor: .secondarySystemFill), content: .primary)
          }
        }
        .frame(maxWidth: 140)
      }
    }
  }
}

private struct WidgetHeader: View {
  let name: String
  let colors: WidgetColors

  var body: some View {
    HStack(spacing: 6) {
      LumenMark().frame(width: 16, height: 16)
      Text(name).font(.caption.weight(.bold))
    }
    .foregroundColor(colors.accentFill)
  }
}

private struct Pill: View {
  let label: String
  let fill: Color
  let content: Color

  var body: some View {
    Text(label)
      .font(.subheadline.weight(.medium))
      .foregroundColor(content)
      .lineLimit(1)
      .minimumScaleFactor(0.8)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 8)
      .background(Capsule().fill(fill))
  }
}

// Mockup 32: the status, how long ago, and "Check now". A small widget takes only one tap target, so the
// whole widget opens the Quick Check.
private struct SmallWidget: View {
  let lines: WidgetLines
  let colors: WidgetColors

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      WidgetHeader(name: lines.name, colors: colors)
      if let status = lines.status {
        Text(status).font(.headline).foregroundColor(colors.text).lineLimit(2)
      }
      if let lastCheck = lines.lastCheck {
        Text(lastCheck).font(.caption).foregroundColor(colors.textDim)
      }
      Spacer(minLength: 0)
      Pill(label: lines.checkNow, fill: colors.accentFill, content: colors.onAccentFill)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

// Mockup 32: heart rate (unless hidden), status and streak, with "Check now" and "Full Scan" as their own links.
private struct MediumWidget: View {
  let lines: WidgetLines
  let colors: WidgetColors

  var body: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        WidgetHeader(name: lines.name, colors: colors)
        Spacer(minLength: 0)
        if let bpm = lines.bpm {
          HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(bpm).font(.system(size: 34, weight: .bold)).foregroundColor(colors.text)
            Text(lines.bpmUnit).font(.subheadline).foregroundColor(colors.textDim)
          }
        }
        // Mockup 32 reads "Up to date · streak 5 days"; the separator is the one lockscreen.json uses.
        Text([lines.status, lines.streak].compactMap { $0 }.joined(separator: " · "))
          .font(.subheadline)
          .foregroundColor(colors.textDim)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      VStack(spacing: 8) {
        Link(destination: LumenLink.check) {
          Pill(label: lines.checkNow, fill: colors.accentFill, content: colors.onAccentFill)
        }
        Link(destination: LumenLink.fullScan) {
          Pill(label: lines.fullScan, fill: colors.line, content: colors.text)
        }
      }
      .frame(maxWidth: 140)
    }
  }
}

struct LumenWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "LumenWidget", provider: SnapshotProvider()) { entry in
      LumenWidgetView(entry: entry)
    }
    // The gallery shows the app's name (spec §2), this line, and EmptyWidget as the preview until the app
    // first publishes. https://developer.apple.com/documentation/widgetkit/staticconfiguration
    .configurationDisplayName(appDisplayName)
    .description(fallbackCopy.description)
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}
