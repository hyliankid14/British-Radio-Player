import SwiftUI

enum TVGuideCategory: String, CaseIterable, Identifiable {
    case national = "national"
    case favourites = "favourites"
    case regions = "regions"
    case local = "local"
    
    var id: String { rawValue }
    
    var title: String {
        switch self {
        case .national: return "National"
        case .favourites: return "Favourites"
        case .regions: return "Regional"
        case .local: return "Local Radio"
        }
    }
}

struct TVGridBlock: Identifiable, Hashable {
    let id: String
    let item: TVScheduleItem?
    let station: TVStation
    let leftMinutes: Double
    let durationMinutes: Double
    let width: CGFloat
    let isFiller: Bool
    
    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
    
    static func == (lhs: TVGridBlock, rhs: TVGridBlock) -> Bool {
        lhs.id == rhs.id
    }
}

struct GuideView: View {
    @Bindable var controller = TVPlaybackController.shared
    @Bindable var metadata = TVNowPlayingMetadata.shared
    @Bindable var favourites = TVFavouritesManager.shared
    let onNavigateToNowPlaying: () -> Void
    
    @State private var selectedCategory: TVGuideCategory = .national
    @State private var selectedDateOffset: Int = 0 // 0 (Today), 1 (Tomorrow), etc.
    @State private var stationSchedules: [String: [TVScheduleItem]] = [:]
    @State private var loadingStationIds: Set<String> = []
    @State private var shouldScrollToNow: Bool = false
    
    // Focus tracking for the Top Inspector
    @State private var focusedStation: TVStation? = nil
    @State private var focusedItem: TVScheduleItem? = nil
    @FocusState private var focusedBlockId: String?
    
    // Selected program for detail popover modal
    @State private var selectedDetailProgram: (item: TVScheduleItem, station: TVStation)? = nil
    
    // Grid geometry constants
    private let timeRulerHeight: CGFloat = 60.0
    private let stationColWidth: CGFloat = 310.0
    private let pixelsPerMinute: CGFloat = 5.0
    private let rowHeight: CGFloat = 112.0
    private let timelineMinutes: Double = 1440.0
    
    private var timelineWidth: CGFloat {
        CGFloat(timelineMinutes) * pixelsPerMinute // 7200 pt
    }
    
    // Date tabs: Today (0), Tomorrow (1), +2 ... +7 (Removed Yesterday)
    private let dateOffsets: [(offset: Int, label: String)] = [
        (0, "Today"),
        (1, "Tomorrow"),
        (2, dayLabel(offset: 2)),
        (3, dayLabel(offset: 3)),
        (4, dayLabel(offset: 4)),
        (5, dayLabel(offset: 5)),
        (6, dayLabel(offset: 6)),
        (7, dayLabel(offset: 7))
    ]
    
    private static func dayLabel(offset: Int) -> String {
        let date = Calendar.current.date(byAdding: .day, value: offset, to: Date()) ?? Date()
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE d MMM"
        return formatter.string(from: date)
    }
    
    private var currentDateStr: String {
        let date = Calendar.current.date(byAdding: .day, value: selectedDateOffset, to: Date()) ?? Date()
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
    
    private var activeStations: [TVStation] {
        switch selectedCategory {
        case .national:
            return TVStationCatalogue.stations(for: .national)
        case .favourites:
            let favs = TVStationCatalogue.favourites(from: favourites.favouriteIds)
            return favs.isEmpty ? TVStationCatalogue.featuredStations() : favs
        case .regions:
            return TVStationCatalogue.stations(for: .regions)
        case .local:
            return TVStationCatalogue.stations(for: .local)
        }
    }
    
    private var nowMinuteOfDay: Double {
        let now = Date()
        let cal = Calendar.current
        let hour = cal.component(.hour, from: now)
        let min = cal.component(.minute, from: now)
        return Double(hour * 60 + min)
    }
    
    var body: some View {
        VStack(spacing: 16) {
            
            // 1. Top Bar: Category Filter, Date Tabs, and Jump to Now
            topFilterBar
                .padding(.horizontal, 60)
                .padding(.top, 16)
            
            // 2. Focused Programme Inspector Panel
            focusedInspectorPanel
                .padding(.horizontal, 60)
            
            // 3. EPG Grid: Pinned Left Station Column + Scrollable Horizontal Timeline
            ScrollView(.vertical, showsIndicators: true) {
                HStack(alignment: .top, spacing: 14) {
                    
                    // PINNED LEFT STATION COLUMN
                    VStack(alignment: .leading, spacing: 12) {
                        
                        // Corner Header above station list (No TV icon to give full space)
                        Text("STATIONS")
                            .font(.system(size: 22, weight: .bold))
                            .foregroundColor(.secondary)
                            .padding(.horizontal, 16)
                            .frame(width: stationColWidth, height: timeRulerHeight, alignment: .leading)
                            .background(Color.white.opacity(0.06))
                            .cornerRadius(8)
                        
                        // Vertical list of station cards
                        ForEach(activeStations) { station in
                            stationIdentCard(for: station)
                        }
                    }
                    .frame(width: stationColWidth)
                    .fixedSize(horizontal: true, vertical: false)
                    .layoutPriority(1)
                    
                    // SCROLLABLE HORIZONTAL TIMELINE
                    ScrollViewReader { timelineProxy in
                        ScrollView(.horizontal, showsIndicators: true) {
                            VStack(alignment: .leading, spacing: 12) {
                                
                                // Time Ruler Header
                                timeRulerHeader
                                
                                // Station Timeline Rows
                                ForEach(activeStations) { station in
                                    stationTimelineRow(for: station)
                                }
                            }
                            .frame(width: timelineWidth)
                        }
                        .coordinateSpace(name: "TimelineScrollView")
                        .onAppear {
                            scrollToCurrentTimeIfToday(proxy: timelineProxy, animated: false)
                        }
                        .onChange(of: selectedDateOffset) { _, newOffset in
                            if newOffset == 0 {
                                scrollToCurrentTimeIfToday(proxy: timelineProxy, animated: true)
                            }
                        }
                        .onChange(of: shouldScrollToNow) { _, shouldScroll in
                            if shouldScroll {
                                scrollToCurrentTimeIfToday(proxy: timelineProxy, animated: true)
                                shouldScrollToNow = false
                            }
                        }
                    }
                }
                .padding(.horizontal, 60)
                .padding(.top, 6)
                .padding(.bottom, 40)
            }
        }
        .edgesIgnoringSafeArea(.horizontal)
        .onAppear {
            loadSchedulesForCurrentCategory()
            setDefaultFocusedInspector()
        }
        .onChange(of: selectedCategory) { _, _ in
            loadSchedulesForCurrentCategory()
            setDefaultFocusedInspector()
        }
        .onChange(of: selectedDateOffset) { _, _ in
            loadSchedulesForCurrentCategory()
            setDefaultFocusedInspector()
        }
        .sheet(item: Binding(
            get: { selectedDetailProgram.map { IdentifiableDetail(item: $0.item, station: $0.station) } },
            set: { if $0 == nil { selectedDetailProgram = nil } }
        )) { detail in
            programmeDetailModal(item: detail.item, station: detail.station)
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("BRPTVOpenGuideDetail"))) { _ in
            if let st = focusedStation ?? activeStations.first {
                let scheduleKey = "\(st.serviceId)_\(currentDateStr)"
                let items = stationSchedules[scheduleKey] ?? []
                let chosenItem = focusedItem ?? items.first(where: { $0.isLiveNow }) ?? items.first
                if let item = chosenItem {
                    selectedDetailProgram = (item: item, station: st)
                }
            }
        }
    }
    
    // MARK: - 1. Top Filter Bar
    
    private var topFilterBar: some View {
        HStack(spacing: 24) {
            
            // Category Switcher
            HStack(spacing: 24) {
                ForEach(TVGuideCategory.allCases) { cat in
                    Button(action: {
                        selectedCategory = cat
                    }) {
                        HStack(spacing: 6) {
                            if cat == .favourites {
                                Image(systemName: "star.fill")
                                    .font(.caption)
                                    .foregroundColor(.yellow)
                            }
                            Text(cat.title)
                                .font(.headline)
                                .fontWeight(selectedCategory == cat ? .bold : .medium)
                                .lineLimit(1)
                                .fixedSize(horizontal: true, vertical: false)
                        }
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                        .background(
                            selectedCategory == cat ? Color.red.opacity(0.35) : Color.clear
                        )
                    }
                    .buttonStyle(.card)
                }
            }
            .padding(.vertical, 10)
            
            Spacer()
            
            // Jump to "Now" Button (when on Today)
            if selectedDateOffset == 0 {
                Button(action: {
                    shouldScrollToNow = true
                }) {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(Color.red)
                            .frame(width: 8, height: 8)
                        Text("Jump to Now")
                            .font(.headline)
                            .fontWeight(.bold)
                            .foregroundColor(.white)
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(Color.red.opacity(0.25))
                }
                .buttonStyle(.card)
                .padding(.vertical, 10)
            }
            
            // Date Switcher (No Yesterday)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 24) {
                    ForEach(dateOffsets, id: \.offset) { item in
                        Button(action: {
                            selectedDateOffset = item.offset
                        }) {
                            HStack(spacing: 8) {
                                if selectedDateOffset == item.offset {
                                    Circle()
                                        .fill(Color.red)
                                        .frame(width: 8, height: 8)
                                }
                                Text(item.label)
                                    .font(.headline)
                                    .fontWeight(selectedDateOffset == item.offset ? .bold : .medium)
                                    .lineLimit(1)
                                    .fixedSize(horizontal: true, vertical: false)
                            }
                            .padding(.horizontal, 20)
                            .padding(.vertical, 10)
                            .background(
                                selectedDateOffset == item.offset ? Color.white.opacity(0.2) : Color.clear
                            )
                        }
                        .buttonStyle(.card)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 14)
            }
            .frame(maxWidth: 720)
        }
    }
    
    // MARK: - 2. Focused Programme Inspector Panel
    
    private var focusedInspectorPanel: some View {
        HStack(alignment: .center, spacing: 28) {
            
            // Left: Station Ident & Name with Star Overlay (No "Favourite" text)
            if let st = focusedStation {
                HStack(spacing: 14) {
                    ZStack(alignment: .topLeading) {
                        TVStationIdentView(stationId: st.id, width: 76, height: 46, cornerRadius: 8)
                        
                        if favourites.isFavourite(st.id) {
                            Image(systemName: "star.fill")
                                .font(.system(size: 11))
                                .foregroundColor(.yellow)
                                .padding(3)
                                .background(Circle().fill(Color.black.opacity(0.8)))
                                .offset(x: -3, y: -3)
                        }
                    }
                    
                    VStack(alignment: .leading, spacing: 3) {
                        Text(st.title)
                            .font(.system(size: 24, weight: .bold))
                            .foregroundColor(.primary)
                            .lineLimit(1)
                        
                        if controller.currentStation?.id == st.id && controller.isPlaying {
                            HStack(spacing: 4) {
                                Image(systemName: "waveform")
                                    .font(.system(size: 13))
                                    .foregroundColor(.red)
                                Text("Playing Now")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundColor(.red)
                            }
                        }
                    }
                }
                .frame(width: 250, alignment: .leading)
            } else {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.white.opacity(0.05))
                    .frame(width: 250, height: 50)
            }
            
            Divider()
                .frame(height: 52)
                .background(Color.white.opacity(0.2))
            
            // Middle: Programme Details
            VStack(alignment: .leading, spacing: 4) {
                if let item = focusedItem {
                    HStack(spacing: 12) {
                        Text(item.displayTitle)
                            .font(.system(size: 28, weight: .bold))
                            .foregroundColor(.primary)
                            .lineLimit(1)
                        
                        if item.isLiveNow {
                            LiveBadgeView()
                        }
                        
                        Text(item.timeWindowFormatted)
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundColor(item.isLiveNow ? .red : .secondary)
                    }
                    
                    if !item.detail.isEmpty && item.detail != item.displayTitle {
                        Text(item.detail)
                            .font(.system(size: 20, weight: .regular))
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    } else if let tagline = focusedStation?.tagline {
                        Text(tagline)
                            .font(.system(size: 20, weight: .regular))
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                } else if let st = focusedStation {
                    Text(st.title)
                        .font(.system(size: 28, weight: .bold))
                    
                    if let tagline = st.tagline {
                        Text(tagline)
                            .font(.system(size: 20, weight: .regular))
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                } else {
                    Text("Select a programme to view details")
                        .font(.system(size: 22, weight: .medium))
                        .foregroundColor(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            
            // Right: Action Buttons
            HStack(spacing: 14) {
                if let st = focusedStation {
                    Button(action: {
                        controller.playStation(st)
                        onNavigateToNowPlaying()
                    }) {
                        HStack(spacing: 8) {
                            Image(systemName: "play.fill")
                            Text("Listen Live")
                        }
                        .font(.system(size: 22, weight: .semibold))
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                    }
                    .buttonStyle(.card)
                }
                
                if let item = focusedItem, let st = focusedStation {
                    Button(action: {
                        selectedDetailProgram = (item: item, station: st)
                    }) {
                        HStack(spacing: 6) {
                            Image(systemName: "info.circle")
                            Text("Show Info")
                        }
                        .font(.system(size: 22, weight: .semibold))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                    }
                    .buttonStyle(.card)
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 14)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color.black.opacity(0.45))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(Color.white.opacity(0.12), lineWidth: 1)
                )
        )
    }
    
    // MARK: - 3. Pinned Left Station Ident Card (Full Row Height & 2-Line Wrapping)
    
    @ViewBuilder
    private func stationIdentCard(for station: TVStation) -> some View {
        Button(action: {
            controller.playStation(station)
            onNavigateToNowPlaying()
        }) {
            HStack(spacing: 12) {
                
                // Station Ident with Star Badge in Top-Left Corner (No Favourite Text)
                ZStack(alignment: .topLeading) {
                    TVStationIdentView(stationId: station.id, width: 70, height: 44, cornerRadius: 8)
                    
                    if favourites.isFavourite(station.id) {
                        Image(systemName: "star.fill")
                            .font(.system(size: 13))
                            .foregroundColor(.yellow)
                            .padding(3.5)
                            .background(Circle().fill(Color.black.opacity(0.85)))
                            .offset(x: -3, y: -3)
                    }
                }
                
                VStack(alignment: .leading, spacing: 3) {
                    Text(station.title)
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundColor(.primary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                        .truncationMode(.tail)
                        .multilineTextAlignment(.leading)
                    
                    if controller.currentStation?.id == station.id && controller.isPlaying {
                        HStack(spacing: 5) {
                            Image(systemName: "waveform")
                                .font(.system(size: 13))
                                .foregroundColor(.red)
                            Text("Playing")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundColor(.red)
                        }
                    }
                }
                
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
        .frame(width: stationColWidth, height: rowHeight - 4)
        .buttonStyle(.card)
        .focused($focusedBlockId, equals: "station_\(station.id)")
        .onChange(of: focusedBlockId) { _, newId in
            if newId == "station_\(station.id)" {
                focusedStation = station
                let scheduleKey = "\(station.serviceId)_\(currentDateStr)"
                let items = stationSchedules[scheduleKey] ?? []
                focusedItem = items.first(where: { $0.isLiveNow }) ?? items.first
            }
        }
    }
    
    // MARK: - 4. Time Ruler Header (Spacious, Timestamps Not Cut Off)
    
    @ViewBuilder
    private var timeRulerHeader: some View {
        ZStack(alignment: .leading) {
            HStack(spacing: 0) {
                ForEach(0..<48, id: \.self) { slotIndex in
                    let minute = slotIndex * 30
                    let hours = minute / 60
                    let mins = minute % 60
                    let timeString = String(format: "%02d:%02d", hours, mins)
                    
                    VStack(alignment: .leading, spacing: 6) {
                        Text(timeString)
                            .font(.system(size: 24, weight: .semibold))
                            .monospacedDigit()
                            .foregroundColor(.secondary)
                            .padding(.leading, 8)
                        
                        Spacer(minLength: 0)
                        
                        Rectangle()
                            .fill(Color.white.opacity(0.2))
                            .frame(width: 1, height: 12)
                    }
                    .padding(.top, 8)
                    .padding(.bottom, 4)
                    .frame(width: 30.0 * pixelsPerMinute, height: timeRulerHeight, alignment: .leading)
                    .id("timeslot_\(minute)")
                }
            }
            
            // Red "NOW" Line Marker on Ruler
            if selectedDateOffset == 0 {
                let nowX = CGFloat(nowMinuteOfDay) * pixelsPerMinute
                VStack(spacing: 2) {
                    Text("NOW")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(Color.red))
                    
                    Rectangle()
                        .fill(Color.red)
                        .frame(width: 2, height: 18)
                }
                .offset(x: max(0, nowX - 22))
                .padding(.top, 4)
            }
        }
        .frame(width: timelineWidth, height: timeRulerHeight, alignment: .leading)
        .background(Color.white.opacity(0.06))
        .cornerRadius(8)
    }
    
    // MARK: - 5. Station Timeline Row
    
    @ViewBuilder
    private func stationTimelineRow(for station: TVStation) -> some View {
        let scheduleKey = "\(station.serviceId)_\(currentDateStr)"
        let items = stationSchedules[scheduleKey] ?? []
        let isLoading = loadingStationIds.contains(station.id)
        let blocks = buildBlocks(for: station, date: targetDateForOffset(), items: items)
        
        ZStack(alignment: .leading) {
            
            // Background 30-min grid guidelines
            HStack(spacing: 0) {
                ForEach(0..<48, id: \.self) { _ in
                    Rectangle()
                        .fill(Color.white.opacity(0.04))
                        .frame(width: 1, height: rowHeight - 4)
                        .frame(width: 30.0 * pixelsPerMinute, alignment: .leading)
                }
            }
            .frame(width: timelineWidth, height: rowHeight - 4, alignment: .leading)
            
            // Red "NOW" Line across the row
            if selectedDateOffset == 0 {
                let nowX = CGFloat(nowMinuteOfDay) * pixelsPerMinute
                Rectangle()
                    .fill(Color.red.opacity(0.85))
                    .frame(width: 2, height: rowHeight - 4)
                    .offset(x: nowX - 1)
                    .zIndex(2)
            }
            
            // Programme Cards
            if isLoading && items.isEmpty {
                HStack(spacing: 12) {
                    ProgressView()
                        .scaleEffect(0.8)
                    Text("Loading \(station.title) schedule…")
                        .font(.callout)
                        .foregroundColor(.secondary)
                }
                .padding(.horizontal, 16)
                .frame(width: 360, height: rowHeight - 4, alignment: .leading)
                .background(Color.white.opacity(0.04))
                .cornerRadius(8)
            } else {
                HStack(spacing: 4) {
                    ForEach(blocks) { block in
                        programmeBlockView(block: block)
                    }
                }
                .frame(width: timelineWidth, height: rowHeight - 4, alignment: .leading)
            }
        }
        .frame(width: timelineWidth, height: rowHeight - 4, alignment: .leading)
    }
    
    // MARK: - 6. Simplified Programme Block View
    
    @ViewBuilder
    private func programmeBlockView(block: TVGridBlock) -> some View {
        if block.isFiller {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.white.opacity(0.03))
                .frame(width: block.width, height: rowHeight - 4)
                .overlay(
                    Text(block.durationMinutes >= 60 ? "No programming listed" : "")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                )
        } else if let item = block.item {
            let isFocused = focusedBlockId == block.id
            let isNow = selectedDateOffset == 0 && item.isLiveNow
            let isNarrow = block.width < 90
            
            Button(action: {
                if isNow {
                    controller.playStation(block.station)
                    onNavigateToNowPlaying()
                } else {
                    selectedDetailProgram = (item: item, station: block.station)
                }
            }) {
                GeometryReader { proxy in
                    let minX = proxy.frame(in: .named("TimelineScrollView")).minX
                    let minContentWidth: CGFloat = isNarrow ? 60 : 180
                    let maxOffset = max(0, block.width - minContentWidth - 16)
                    let stickyOffset = min(max(0, -minX), maxOffset)
                    let availableWidth = max(minContentWidth, block.width - stickyOffset)
                    
                    VStack(alignment: .leading, spacing: 4) {
                        
                        // Show Time header only if card has sufficient width
                        if !isNarrow {
                            HStack(spacing: 6) {
                                Text(item.startTimeFormatted)
                                    .font(.system(size: 18, weight: .bold))
                                    .monospacedDigit()
                                    .foregroundColor(isFocused ? (isNow ? .white.opacity(0.9) : .black.opacity(0.65)) : (isNow ? .red : .secondary))
                                
                                if isNow {
                                    Circle()
                                        .fill(isFocused ? (isNow ? Color.white : Color.red) : Color.red)
                                        .frame(width: 7, height: 7)
                                    
                                    Spacer(minLength: 0)
                                    
                                    Image(systemName: "play.circle.fill")
                                        .font(.system(size: 16))
                                        .foregroundColor(isFocused ? Color.white : Color.red)
                                }
                            }
                        }
                        
                        // Show Title - kept visible even if show started before visible window
                        Text(item.displayTitle)
                            .font(isNarrow ? .system(size: 21, weight: .bold) : .system(size: 26, weight: .bold))
                            .foregroundColor(isFocused ? (isNow ? .white : .black) : .primary)
                            .lineLimit(2)
                            .truncationMode(.tail)
                            .minimumScaleFactor(0.85)
                        
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, isNarrow ? 8 : 12)
                    .padding(.vertical, 8)
                    .frame(width: availableWidth, height: rowHeight - 4, alignment: .topLeading)
                    .offset(x: stickyOffset)
                }
                .frame(width: block.width, height: rowHeight - 4)
                .clipped()
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(
                            isFocused
                                ? (isNow ? Color.red : Color.white)
                                : (isNow ? Color.red.opacity(0.24) : Color.white.opacity(0.07))
                        )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(
                            isFocused
                                ? Color.white
                                : (isNow ? Color.red.opacity(0.85) : Color.white.opacity(0.12)),
                            lineWidth: isFocused ? 2.5 : 1
                        )
                )
                .shadow(
                    color: isFocused ? (isNow ? Color.red.opacity(0.6) : Color.white.opacity(0.45)) : Color.clear,
                    radius: isFocused ? 12 : 0,
                    x: 0,
                    y: isFocused ? 3 : 0
                )
            }
            .buttonStyle(.plain)
            .zIndex(isFocused ? 10 : 1)
            .focused($focusedBlockId, equals: block.id)
            .onChange(of: focusedBlockId) { _, newId in
                if newId == block.id {
                    focusedStation = block.station
                    focusedItem = item
                }
            }
        }
    }
    
    // MARK: - 7. Programme Detail Modal
    
    private struct IdentifiableDetail: Identifiable {
        var id: String { "\(station.id)_\(item.id)" }
        let item: TVScheduleItem
        let station: TVStation
    }
    
    @ViewBuilder
    private func programmeDetailModal(item: TVScheduleItem, station: TVStation) -> some View {
        ZStack {
            Color.black.opacity(0.9)
                .edgesIgnoringSafeArea(.all)
            
            VStack(spacing: 28) {
                
                // Station Ident & Name Header
                HStack(spacing: 20) {
                    TVStationIdentView(stationId: station.id, width: 100, height: 60, cornerRadius: 8)
                    
                    VStack(alignment: .leading, spacing: 4) {
                        Text(station.title)
                            .font(.title2)
                            .fontWeight(.bold)
                        
                        Text(item.timeWindowFormatted)
                            .font(.headline)
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                    
                    if item.isLiveNow {
                        LiveBadgeView()
                    }
                }
                
                Divider()
                    .background(Color.white.opacity(0.2))
                
                // Programme Title & Synopsis
                VStack(alignment: .leading, spacing: 14) {
                    Text(item.displayTitle)
                        .font(.system(size: 38, weight: .bold))
                        .foregroundColor(.primary)
                        .lineLimit(2)
                    
                    if let episode = item.episodeTitle, !episode.isEmpty, episode != item.displayTitle {
                        Text(episode)
                            .font(.title3)
                            .fontWeight(.semibold)
                            .foregroundColor(.red)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    
                    if let synopsis = item.shortSynopsis, !synopsis.isEmpty {
                        ScrollView(.vertical, showsIndicators: true) {
                            Text(synopsis)
                                .font(.body)
                                .foregroundColor(.secondary)
                                .lineSpacing(6)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(maxHeight: 360)
                    } else if let tagline = station.tagline {
                        Text(tagline)
                            .font(.body)
                            .foregroundColor(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                
                Spacer(minLength: 16)
                
                // Action Buttons
                HStack(spacing: 24) {
                    Button(action: {
                        selectedDetailProgram = nil
                        controller.playStation(station)
                        onNavigateToNowPlaying()
                    }) {
                        HStack(spacing: 10) {
                            Image(systemName: "play.fill")
                            Text("Listen Live to \(station.title)")
                        }
                        .font(.headline)
                        .padding(.horizontal, 28)
                        .padding(.vertical, 14)
                    }
                    .buttonStyle(.card)
                    
                    Button(action: {
                        selectedDetailProgram = nil
                    }) {
                        Text("Dismiss")
                            .font(.headline)
                            .padding(.horizontal, 28)
                            .padding(.vertical, 14)
                    }
                    .buttonStyle(.card)
                }
            }
            .padding(.horizontal, 48)
            .padding(.vertical, 36)
            .frame(width: 1050, height: 780)
            .background(
                RoundedRectangle(cornerRadius: 24)
                    .fill(Color(white: 0.12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 24)
                            .stroke(Color.white.opacity(0.2), lineWidth: 1)
                    )
            )
        }
    }
    
    // MARK: - Helpers & Layout Calculations
    
    private func targetDateForOffset() -> Date {
        Calendar.current.date(byAdding: .day, value: selectedDateOffset, to: Date()) ?? Date()
    }
    
    private func buildBlocks(for station: TVStation, date: Date, items: [TVScheduleItem]) -> [TVGridBlock] {
        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: date)
        let endOfDay = calendar.date(byAdding: .day, value: 1, to: startOfDay) ?? startOfDay.addingTimeInterval(86400)
        let dayStartMs = startOfDay.timeIntervalSince1970
        let dayEndMs = endOfDay.timeIntervalSince1970
        
        if items.isEmpty {
            return [
                TVGridBlock(
                    id: "\(station.id)_empty",
                    item: nil,
                    station: station,
                    leftMinutes: 0,
                    durationMinutes: timelineMinutes,
                    width: timelineWidth - 4,
                    isFiller: true
                )
            ]
        }
        
        var blocks: [TVGridBlock] = []
        var currentMinute: Double = 0.0
        
        for (index, item) in items.enumerated() {
            let itemStartMs = item.startDate.timeIntervalSince1970
            let itemEndMs = item.endDate.timeIntervalSince1970
            
            let clampStartMs = max(itemStartMs, dayStartMs)
            let clampEndMs = min(itemEndMs, dayEndMs)
            
            guard clampEndMs > clampStartMs else { continue }
            
            let startMin = max(0.0, (clampStartMs - dayStartMs) / 60.0)
            let endMin = min(timelineMinutes, (clampEndMs - dayStartMs) / 60.0)
            let durMin = max(1.0, endMin - startMin)
            
            // Gap filler before this item
            if startMin > currentMinute + 0.5 {
                let gapDur = startMin - currentMinute
                let gapWidth = max(8.0, CGFloat(gapDur) * pixelsPerMinute - 4.0)
                blocks.append(TVGridBlock(
                    id: "\(station.id)_gap_\(Int(currentMinute))",
                    item: nil,
                    station: station,
                    leftMinutes: currentMinute,
                    durationMinutes: gapDur,
                    width: gapWidth,
                    isFiller: true
                ))
                currentMinute = startMin
            }
            
            let width = max(32.0, CGFloat(durMin) * pixelsPerMinute - 4.0)
            blocks.append(TVGridBlock(
                id: "\(station.id)_\(item.id)_\(index)",
                item: item,
                station: station,
                leftMinutes: startMin,
                durationMinutes: durMin,
                width: width,
                isFiller: false
            ))
            
            currentMinute = endMin
        }
        
        // Gap filler to end of day
        if currentMinute < timelineMinutes - 0.5 {
            let gapDur = timelineMinutes - currentMinute
            let gapWidth = max(8.0, CGFloat(gapDur) * pixelsPerMinute - 4.0)
            blocks.append(TVGridBlock(
                id: "\(station.id)_endgap_\(Int(currentMinute))",
                item: nil,
                station: station,
                leftMinutes: currentMinute,
                durationMinutes: gapDur,
                width: gapWidth,
                isFiller: true
            ))
        }
        
        return blocks
    }
    
    private func scrollToCurrentTimeIfToday(proxy: ScrollViewProxy, animated: Bool) {
        guard selectedDateOffset == 0 else { return }
        let nowMin = Int(nowMinuteOfDay)
        let slot = max(0, ((nowMin - 30) / 30) * 30)
        let targetId = "timeslot_\(slot)"
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            if animated {
                withAnimation(.easeInOut(duration: 0.4)) {
                    proxy.scrollTo(targetId, anchor: .leading)
                }
            } else {
                proxy.scrollTo(targetId, anchor: .leading)
            }
        }
    }
    
    private func setDefaultFocusedInspector() {
        if let first = activeStations.first {
            focusedStation = first
            let scheduleKey = "\(first.serviceId)_\(currentDateStr)"
            if let items = stationSchedules[scheduleKey] {
                focusedItem = items.first(where: { $0.isLiveNow }) ?? items.first
            }
        }
    }
    
    private func loadSchedulesForCurrentCategory() {
        let stations = activeStations
        let targetDate = targetDateForOffset()
        let dateStr = currentDateStr
        
        for station in stations {
            let key = "\(station.serviceId)_\(dateStr)"
            if let cached = stationSchedules[key], !cached.isEmpty {
                continue
            }
            
            loadingStationIds.insert(station.id)
            metadata.fetchSchedule(for: station.serviceId, date: targetDate) { items in
                DispatchQueue.main.async {
                    self.stationSchedules[key] = items
                    self.loadingStationIds.remove(station.id)
                    
                    if self.focusedStation?.id == station.id && self.focusedItem == nil {
                        self.focusedItem = items.first(where: { $0.isLiveNow }) ?? items.first
                    }
                }
            }
        }
    }
}
