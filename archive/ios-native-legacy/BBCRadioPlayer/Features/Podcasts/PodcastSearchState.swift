import Foundation

struct PodcastSearchState: Equatable {
    var query: String = ""
    var filter = PodcastFilter()
}
