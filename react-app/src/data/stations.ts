export const LOGO_BASE = "https://sounds.files.bbci.co.uk/3.11.1/services";
export const BBC_HLS_UK = "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/uk/pc_hd_abr_v2/cf";
export const BBC_HLS_NONUK = "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/nonuk/pc_hd_abr_v2/cf";
export const STREAM_BASE = "https://lsn.lv/bbcradio.m3u8";

export enum StationCategory {
  NATIONAL = "National",
  REGIONS = "Regions",
  LOCAL = "Local"
}

export type AudioQuality = "AUTO" | "HIGH" | "MEDIUM" | "LOW";

export interface AudioQualityConfig {
  bitrate: string;
  label: string;
}

export const AUDIO_QUALITIES: Record<AudioQuality, AudioQualityConfig> = {
  HIGH: { bitrate: "320000", label: "High (320 kbps)" },
  MEDIUM: { bitrate: "128000", label: "Standard (128 kbps)" },
  LOW: { bitrate: "48000", label: "Low Data (48 kbps)" },
  AUTO: { bitrate: "128000", label: "Auto (Adaptive)" }
};

export interface Station {
  id: string;
  title: string;
  serviceId: string;
  streamServiceIds: string[];
  directStreamUrls: string[];
  logoUrl: string;
  category: StationCategory;
}

function createStation(
  id: string,
  title: string,
  serviceId: string,
  category: StationCategory = StationCategory.LOCAL,
  options?: {
    streamServiceIds?: string[];
    directStreamUrls?: string[];
    logoServiceId?: string;
  }
): Station {
  const logoServiceId = options?.logoServiceId || serviceId;
  return {
    id,
    title,
    serviceId,
    streamServiceIds: options?.streamServiceIds || [serviceId],
    directStreamUrls: options?.directStreamUrls || [],
    logoUrl: `${LOGO_BASE}/${logoServiceId}/blocks-colour-black_600x600.png`,
    category
  };
}

export function getStationUri(station: Station, quality: AudioQuality = "HIGH", serviceIdOverride?: string): string {
  const resolvedServiceId = serviceIdOverride || station.serviceId;
  const bitrate = AUDIO_QUALITIES[quality]?.bitrate || "320000";
  return `${STREAM_BASE}?station=${resolvedServiceId}&bitrate=${bitrate}`;
}

export function getStreamCandidates(station: Station, quality: AudioQuality = "HIGH", geoBlocked = false): string[] {
  const candidates: string[] = [];

  if (geoBlocked) {
    for (const sid of station.streamServiceIds) {
      candidates.push(`${BBC_HLS_NONUK}/${sid}.m3u8`);
    }
    for (const url of station.directStreamUrls) {
      if (!url.includes("&uk=1")) {
        candidates.push(url);
      }
    }
    return Array.from(new Set(candidates));
  }

  // 1. Official BBC UK HLS stream
  for (const sid of station.streamServiceIds) {
    candidates.push(`${BBC_HLS_UK}/${sid}.m3u8`);
  }

  // 2. Direct working streams if provided
  for (const url of station.directStreamUrls) {
    candidates.push(url);
  }

  // 3. Official BBC International / Non-UK HLS stream
  for (const sid of station.streamServiceIds) {
    candidates.push(`${BBC_HLS_NONUK}/${sid}.m3u8`);
  }

  return Array.from(new Set(candidates));
}

export const STATIONS: Station[] = [
  // National & Digital
  createStation("radio1", "Radio 1", "bbc_radio_one", StationCategory.NATIONAL),
  createStation("1xtra", "Radio 1Xtra", "bbc_1xtra", StationCategory.NATIONAL),
  createStation("radio1dance", "Radio 1 Dance", "bbc_radio_one_dance", StationCategory.NATIONAL),
  createStation("radio1anthems", "Radio 1 Anthems", "bbc_radio_one_anthems", StationCategory.NATIONAL),
  createStation("radio2", "Radio 2", "bbc_radio_two", StationCategory.NATIONAL),
  createStation("radio3", "Radio 3", "bbc_radio_three", StationCategory.NATIONAL),
  createStation("radio3unwind", "Radio 3 Unwind", "bbc_radio_three_unwind", StationCategory.NATIONAL),
  createStation("radio4", "Radio 4", "bbc_radio_fourfm", StationCategory.NATIONAL),
  createStation("radio4extra", "Radio 4 Extra", "bbc_radio_four_extra", StationCategory.NATIONAL),
  createStation("radio5live", "Radio 5 Live", "bbc_radio_five_live", StationCategory.NATIONAL, {
    directStreamUrls: [
      "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_live&bitrate=320000&uk=1",
      "https://as-hls-ww-live.akamaized.net/pool_89021708/live/ww/bbc_radio_five_live/bbc_radio_five_live.isml/bbc_radio_five_live-audio%3d96000.norewind.m3u8",
      "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_live&bitrate=128000&uk=1",
      "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_live&bitrate=96000&uk=1",
      "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_live&bitrate=48000&uk=1"
    ]
  }),
  createStation("radio5livesportsextra", "Radio 5 Sports Extra", "bbc_radio_five_live_sports_extra", StationCategory.NATIONAL, {
    streamServiceIds: ["bbc_radio_five_live_sports_extra", "bbc_radio_five_sports_extra"],
    directStreamUrls: [
      "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_live_sports_extra&bitrate=320000&uk=1",
      "https://as-hls-uk-live.akamaized.net/pool_47700285/live/uk/bbc_radio_five_live_sports_extra/bbc_radio_five_live_sports_extra.isml/bbc_radio_five_live_sports_extra-audio%3d96000.norewind.m3u8",
      "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_live_sports_extra&bitrate=128000&uk=1",
      "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_live_sports_extra&bitrate=96000&uk=1",
      "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_live_sports_extra&bitrate=48000&uk=1"
    ]
  }),
  createStation("radio5livesportsextra2", "Radio 5 Sports Extra 2", "bbc_radio_five_sports_extra_2", StationCategory.NATIONAL, {
    streamServiceIds: ["bbc_radio_five_sports_extra_2", "bbc_radio_five_live_sports_extra_2"],
    directStreamUrls: [
      "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_sports_extra_2&bitrate=320000&uk=1",
      "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/uk/audio_syndication_high_sbr_v1/ak/bbc_radio_five_sports_extra_2.m3u8",
      "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_sports_extra_2&bitrate=128000&uk=1",
      "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_sports_extra_2&bitrate=96000&uk=1",
      "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_sports_extra_2&bitrate=48000&uk=1"
    ]
  }),
  createStation("radio5livesportsextra3", "Radio 5 Sports Extra 3", "bbc_radio_five_sports_extra_3", StationCategory.NATIONAL, {
    streamServiceIds: ["bbc_radio_five_sports_extra_3", "bbc_radio_five_live_sports_extra_3"],
    directStreamUrls: [
      "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_sports_extra_3&bitrate=320000&uk=1",
      "https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/uk/audio_syndication_high_sbr_v1/ak/bbc_radio_five_sports_extra_3.m3u8",
      "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_sports_extra_3&bitrate=128000&uk=1",
      "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_sports_extra_3&bitrate=96000&uk=1",
      "https://lsn.lv/bbcradio.m3u8?station=bbc_radio_five_sports_extra_3&bitrate=48000&uk=1"
    ]
  }),
  createStation("radio6", "Radio 6 Music", "bbc_6music", StationCategory.NATIONAL),
  createStation("worldservice", "World Service", "bbc_world_service", StationCategory.NATIONAL),
  createStation("asiannetwork", "Asian Network", "bbc_asian_network", StationCategory.NATIONAL),

  // Nations / Regions
  createStation("radiocymru", "Radio Cymru", "bbc_radio_cymru", StationCategory.REGIONS),
  createStation("radiocymru2", "Radio Cymru 2", "bbc_radio_cymru_2", StationCategory.REGIONS),
  createStation("radiofoyle", "Radio Foyle", "bbc_radio_foyle", StationCategory.REGIONS),
  createStation("radiogaidheal", "Radio nan Gaidheal", "bbc_radio_nan_gaidheal", StationCategory.REGIONS),
  createStation("radioorkney", "Radio Orkney", "bbc_radio_orkney", StationCategory.REGIONS),
  createStation("radioscotland", "Radio Scotland", "bbc_radio_scotland_fm", StationCategory.REGIONS),
  createStation("radioscotlandextra", "Radio Scotland Extra", "bbc_radio_scotland_mw", StationCategory.REGIONS),
  createStation("radioshetland", "Radio Shetland", "bbc_radio_shetland", StationCategory.REGIONS),
  createStation("radioulster", "Radio Ulster", "bbc_radio_ulster", StationCategory.REGIONS),
  createStation("radiowales", "Radio Wales", "bbc_radio_wales_fm", StationCategory.REGIONS),
  createStation("radiowalesextra", "Radio Wales Extra", "bbc_radio_wales_am", StationCategory.REGIONS),

  // Local Stations (England and Channel Islands)
  createStation("radioberkshire", "Radio Berkshire", "bbc_radio_berkshire", StationCategory.LOCAL),
  createStation("radiobristol", "Radio Bristol", "bbc_radio_bristol", StationCategory.LOCAL),
  createStation("radiocambridge", "Radio Cambridgeshire", "bbc_radio_cambridge", StationCategory.LOCAL),
  createStation("radiocornwall", "Radio Cornwall", "bbc_radio_cornwall", StationCategory.LOCAL),
  createStation("radiocoventrywarwickshire", "Radio Coventry & Warwickshire", "bbc_radio_coventry_warwickshire", StationCategory.LOCAL),
  createStation("radiocumbria", "Radio Cumbria", "bbc_radio_cumbria", StationCategory.LOCAL),
  createStation("radioderby", "Radio Derby", "bbc_radio_derby", StationCategory.LOCAL),
  createStation("radiodevon", "Radio Devon", "bbc_radio_devon", StationCategory.LOCAL),
  createStation("radioessex", "Radio Essex", "bbc_radio_essex", StationCategory.LOCAL),
  createStation("radioherefordworcester", "Radio Hereford & Worcester", "bbc_radio_hereford_worcester", StationCategory.LOCAL),
  createStation("radiogloucestershire", "Radio Gloucestershire", "bbc_radio_gloucestershire", StationCategory.LOCAL),
  createStation("radioguernsey", "Radio Guernsey", "bbc_radio_guernsey", StationCategory.LOCAL),
  createStation("radiohumberside", "Radio Humberside", "bbc_radio_humberside", StationCategory.LOCAL),
  createStation("radiojersey", "Radio Jersey", "bbc_radio_jersey", StationCategory.LOCAL),
  createStation("radiokent", "Radio Kent", "bbc_radio_kent", StationCategory.LOCAL),
  createStation("radiolancashire", "Radio Lancashire", "bbc_radio_lancashire", StationCategory.LOCAL),
  createStation("radioleeds", "Radio Leeds", "bbc_radio_leeds", StationCategory.LOCAL),
  createStation("radioleicester", "Radio Leicester", "bbc_radio_leicester", StationCategory.LOCAL),
  createStation("radiolincolnshire", "Radio Lincolnshire", "bbc_radio_lincolnshire", StationCategory.LOCAL),
  createStation("radiolon", "Radio London", "bbc_london", StationCategory.LOCAL),
  createStation("radiomanchester", "Radio Manchester", "bbc_radio_manchester", StationCategory.LOCAL),
  createStation("radiomerseyside", "Radio Merseyside", "bbc_radio_merseyside", StationCategory.LOCAL),
  createStation("radionewcastle", "Radio Newcastle", "bbc_radio_newcastle", StationCategory.LOCAL),
  createStation("radionorfolk", "Radio Norfolk", "bbc_radio_norfolk", StationCategory.LOCAL),
  createStation("radionorthampton", "Radio Northampton", "bbc_radio_northampton", StationCategory.LOCAL),
  createStation("radionottingham", "Radio Nottingham", "bbc_radio_nottingham", StationCategory.LOCAL),
  createStation("radiooxford", "Radio Oxford", "bbc_radio_oxford", StationCategory.LOCAL),
  createStation("radiosheffield", "Radio Sheffield", "bbc_radio_sheffield", StationCategory.LOCAL),
  createStation("radioshropshire", "Radio Shropshire", "bbc_radio_shropshire", StationCategory.LOCAL),
  createStation("radiosolent", "Radio Solent", "bbc_radio_solent", StationCategory.LOCAL),
  createStation("radiosolentwestdorset", "Radio Solent West Dorset", "bbc_radio_solent_west_dorset", StationCategory.LOCAL),
  createStation("radiosomerset", "Radio Somerset", "bbc_radio_somerset_sound", StationCategory.LOCAL),
  createStation("radiostoke", "Radio Stoke", "bbc_radio_stoke", StationCategory.LOCAL),
  createStation("radiosuffolk", "Radio Suffolk", "bbc_radio_suffolk", StationCategory.LOCAL),
  createStation("radiosurrey", "Radio Surrey", "bbc_radio_surrey", StationCategory.LOCAL),
  createStation("radiosussex", "Radio Sussex", "bbc_radio_sussex", StationCategory.LOCAL),
  createStation("radiotees", "Radio Tees", "bbc_tees", StationCategory.LOCAL),
  createStation("radiothreecounties", "Three Counties Radio", "bbc_three_counties_radio", StationCategory.LOCAL),
  createStation("radiowestmidlands", "Radio West Midlands", "bbc_wm", StationCategory.LOCAL),
  createStation("radiowiltshire", "Radio Wiltshire", "bbc_radio_wiltshire", StationCategory.LOCAL),
  createStation("radioyork", "Radio York", "bbc_radio_york", StationCategory.LOCAL)
];

export const StationRepository = {
  getAll: (): Station[] => STATIONS,
  getById: (id: string): Station | undefined => STATIONS.find(s => s.id === id),
  getByCategory: (category: StationCategory): Station[] => STATIONS.filter(s => s.category === category),
  getCategorized: (): Record<StationCategory, Station[]> => ({
    [StationCategory.NATIONAL]: STATIONS.filter(s => s.category === StationCategory.NATIONAL),
    [StationCategory.REGIONS]: STATIONS.filter(s => s.category === StationCategory.REGIONS),
    [StationCategory.LOCAL]: STATIONS.filter(s => s.category === StationCategory.LOCAL)
  })
};
