import Foundation
import Compression

struct RemoteIndexMeta: Decodable, Equatable {
    let generatedAt: String
    let podcastCount: Int
    let episodeCount: Int

    enum CodingKeys: String, CodingKey {
        case generatedAt = "generated_at"
        case podcastCount = "podcast_count"
        case episodeCount = "episode_count"
    }
}

struct RemoteIndexData: Decodable {
    let podcasts: [RemoteIndexPodcast]
    let episodes: [RemoteIndexEpisode]
}

struct RemoteIndexPodcast: Decodable {
    let id: String
    let title: String
    let description: String
}

struct RemoteIndexEpisode: Decodable {
    let podcastId: String
    let title: String
    let description: String
    let audioUrl: String?
    let pubEpoch: Int?
    
    enum CodingKeys: String, CodingKey {
        case podcastId = "podcastId"
        case title
        case description
        case audioUrl = "audioUrl"
        case pubEpoch = "pubEpoch"
    }
}

struct RemoteIndexClient {
    static let indexURL = URL(string: "https://hyliankid14.github.io/BBC-Radio-Player/podcast-index.json.gz")!
    static let metaURL = URL(string: "https://hyliankid14.github.io/BBC-Radio-Player/podcast-index-meta.json")!

    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func fetchMeta() async throws -> RemoteIndexMeta {
        let (data, response) = try await session.data(from: Self.metaURL)
        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(RemoteIndexMeta.self, from: data)
    }

    func fetchIndex() async throws -> RemoteIndexData {
        let (data, response) = try await session.data(from: Self.indexURL)
        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }

        // Decompress gzip data
        let decompressed = try decompressGzip(data)
        return try JSONDecoder().decode(RemoteIndexData.self, from: decompressed)
    }

    private func decompressGzip(_ data: Data) throws -> Data {
        guard data.count > 0 else { return data }

        // Check for gzip magic number (1f 8b)
        let gzipMagic: [UInt8] = [0x1f, 0x8b]
        let header = data.prefix(2)
        let isGzip = Array(header) == gzipMagic

        guard isGzip else {
            // Already decompressed or not gzip
            return data
        }

        let bufferSize = 256 * 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }

        var decompressed = Data()

        let result = try data.withUnsafeBytes { compressedBytes in
            guard let compressedPtr = compressedBytes.baseAddress?.assumingMemoryBound(to: UInt8.self) else {
                throw URLError(.unknown)
            }

            // compression_decode_buffer with COMPRESSION_ZLIB handles both raw deflate and gzip
            let status = compression_decode_buffer(
                buffer,
                bufferSize,
                compressedPtr,
                data.count,
                nil,
                COMPRESSION_ZLIB
            )

            guard status > 0 else {
                throw URLError(.cannotDecodeRawData)
            }

            decompressed = Data(bytes: buffer, count: status)
            return status
        }

        guard result > 0 else {
            throw URLError(.cannotDecodeRawData)
        }

        return decompressed
    }
}
