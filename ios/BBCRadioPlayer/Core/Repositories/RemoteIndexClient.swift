import Foundation
import Compression
import zlib

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
    static let indexURL = URL(string: "https://storage.googleapis.com/bbc-radio-player-index-20260317-bc149e38/podcast-index.json.gz")!
    static let metaURL = URL(string: "https://storage.googleapis.com/bbc-radio-player-index-20260317-bc149e38/podcast-index-meta.json")!

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

        return try data.withUnsafeBytes { compressedBytes in
            guard let sourceBaseAddress = compressedBytes.baseAddress else {
                throw URLError(.unknown)
            }

            var stream = z_stream()
            stream.next_in = UnsafeMutablePointer<Bytef>(mutating: sourceBaseAddress.assumingMemoryBound(to: Bytef.self))
            stream.avail_in = uInt(data.count)

            let windowBits = Int32(MAX_WBITS) + 32
            let initResult = inflateInit2_(&stream, windowBits, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
            guard initResult == Z_OK else {
                throw URLError(.cannotDecodeRawData)
            }
            defer { inflateEnd(&stream) }

            let bufferSize = 64 * 1024
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
            defer { buffer.deallocate() }

            var output = Data()

            while true {
                stream.next_out = buffer
                stream.avail_out = uInt(bufferSize)

                let inflateResult = inflate(&stream, Z_NO_FLUSH)
                let producedCount = bufferSize - Int(stream.avail_out)
                if producedCount > 0 {
                    output.append(buffer, count: producedCount)
                }

                if inflateResult == Z_STREAM_END {
                    break
                }

                guard inflateResult == Z_OK else {
                    throw URLError(.cannotDecodeRawData)
                }

                if stream.avail_in == 0 && producedCount == 0 {
                    break
                }
            }

            guard !output.isEmpty else {
                throw URLError(.cannotDecodeRawData)
            }

            return output
        }
    }
}
