import React from "react";
import { View, Text, StyleSheet } from "react-native";

interface StationLogoConfig {
  backgroundColor: string;
  label: string;
  circleColor?: string;
  textColor?: string;
  badgeLabel?: string;
}

const STATION_ARTWORK_CONFIGS: Record<string, StationLogoConfig> = {
  // National
  radio1: { backgroundColor: "#F5247F", label: "1" },
  "1xtra": { backgroundColor: "#231F20", label: "1X", circleColor: "#CC0000" },
  radio1dance: { backgroundColor: "#0D0D0D", label: "1D", circleColor: "#CC0066" },
  radio1anthems: { backgroundColor: "#0056B8", label: "1A" },
  radio2: { backgroundColor: "#E66B21", label: "2" },
  radio3: { backgroundColor: "#C13131", label: "3" },
  radio3unwind: { backgroundColor: "#4A2080", label: "3U", circleColor: "#6A40A0" },
  radio4: { backgroundColor: "#1B6CA8", label: "4" },
  radio4extra: { backgroundColor: "#9B1D73", label: "4+" },
  radio5live: { backgroundColor: "#009EAA", label: "5" },
  radio5livesportsextra: { backgroundColor: "#009EAA", label: "5S" },
  radio5livesportsextra2: { backgroundColor: "#000000", label: "5S", circleColor: "#009EAA", badgeLabel: "2" },
  radio5livesportsextra3: { backgroundColor: "#000000", label: "5S", circleColor: "#009EAA", badgeLabel: "3" },
  radio6: { backgroundColor: "#007749", label: "6" },
  worldservice: { backgroundColor: "#BB1919", label: "WS" },
  asiannetwork: { backgroundColor: "#703FA0", label: "AN" },

  // Regions
  radiocymru: { backgroundColor: "#0057A8", label: "CY" },
  radiocymru2: { backgroundColor: "#007C55", label: "CY2" },
  radiofoyle: { backgroundColor: "#007C55", label: "FO" },
  radiogaidheal: { backgroundColor: "#0093C5", label: "GD" },
  radioorkney: { backgroundColor: "#C43A8A", label: "OR" },
  radioscotland: { backgroundColor: "#7B5EA7", label: "SC" },
  radioscotlandextra: { backgroundColor: "#7B5EA7", label: "SC+" },
  radioshetland: { backgroundColor: "#D4478A", label: "SH" },
  radioulster: { backgroundColor: "#007C55", label: "UL" },
  radiowales: { backgroundColor: "#D84315", label: "WA" },
  radiowalesextra: { backgroundColor: "#D84315", label: "WA+" },

  // Local
  radioberkshire: { backgroundColor: "#000000", label: "BE" },
  radiobristol: { backgroundColor: "#000000", label: "BR" },
  radiocambridge: { backgroundColor: "#000000", label: "CA" },
  radiocornwall: { backgroundColor: "#000000", label: "CO" },
  radiocoventrywarwickshire: { backgroundColor: "#000000", label: "CW" },
  radiocumbria: { backgroundColor: "#000000", label: "CU" },
  radioderby: { backgroundColor: "#000000", label: "DE" },
  radiodevon: { backgroundColor: "#000000", label: "DV" },
  radioessex: { backgroundColor: "#000000", label: "ES" },
  radiogloucestershire: { backgroundColor: "#000000", label: "GL" },
  radioguernsey: { backgroundColor: "#000000", label: "GU" },
  radioherefordworcester: { backgroundColor: "#000000", label: "HW" },
  radiohumberside: { backgroundColor: "#000000", label: "HU" },
  radiojersey: { backgroundColor: "#000000", label: "JE" },
  radiokent: { backgroundColor: "#000000", label: "KE" },
  radiolancashire: { backgroundColor: "#000000", label: "LA" },
  radioleeds: { backgroundColor: "#000000", label: "LE" },
  radioleicester: { backgroundColor: "#000000", label: "LR" },
  radiolincolnshire: { backgroundColor: "#000000", label: "LI" },
  radiolon: { backgroundColor: "#000000", label: "LO" },
  radiomanchester: { backgroundColor: "#000000", label: "MA" },
  radiomerseyside: { backgroundColor: "#000000", label: "ME" },
  radionewcastle: { backgroundColor: "#000000", label: "NE" },
  radionorfolk: { backgroundColor: "#000000", label: "NF" },
  radionorthampton: { backgroundColor: "#000000", label: "NO" },
  radionottingham: { backgroundColor: "#000000", label: "NT" },
  radiooxford: { backgroundColor: "#000000", label: "OX" },
  radiosheffield: { backgroundColor: "#000000", label: "SF" },
  radioshropshire: { backgroundColor: "#000000", label: "SR" },
  radiosolent: { backgroundColor: "#000000", label: "SO" },
  radiosolentwestdorset: { backgroundColor: "#000000", label: "SD" },
  radiosomerset: { backgroundColor: "#000000", label: "SM" },
  radiostoke: { backgroundColor: "#000000", label: "ST" },
  radiosuffolk: { backgroundColor: "#000000", label: "SU" },
  radiosurrey: { backgroundColor: "#000000", label: "SY" },
  radiosussex: { backgroundColor: "#000000", label: "SX" },
  radiotees: { backgroundColor: "#000000", label: "TE" },
  radiothreecounties: { backgroundColor: "#000000", label: "3C" },
  radiowestmidlands: { backgroundColor: "#000000", label: "WM" },
  radiowiltshire: { backgroundColor: "#000000", label: "WL" },
  radioyork: { backgroundColor: "#000000", label: "YO" }
};

interface StationLogoProps {
  stationId: string;
  size?: number;
  borderRadius?: number;
}

export function StationLogo({
  stationId,
  size = 56,
  borderRadius = 12
}: StationLogoProps) {
  const config = STATION_ARTWORK_CONFIGS[stationId] || {
    backgroundColor: "#4A4A8A",
    label: stationId.slice(0, 2).toUpperCase()
  };

  const circleSize = size * 0.82;
  const fontSize = config.label.length > 2 ? circleSize * 0.42 : circleSize * 0.54;

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius,
          backgroundColor: config.backgroundColor
        }
      ]}
    >
      <View
        style={[
          styles.circle,
          {
            width: circleSize,
            height: circleSize,
            borderRadius: circleSize / 2,
            backgroundColor: config.circleColor || "#1A1A1A"
          }
        ]}
      >
        <Text
          style={[
            styles.labelText,
            {
              fontSize,
              color: config.textColor || "#FFFFFF"
            }
          ]}
          numberOfLines={1}
        >
          {config.label}
        </Text>
      </View>

      {config.badgeLabel ? (
        <View
          style={[
            styles.badge,
            {
              width: size * 0.26,
              height: size * 0.26,
              borderRadius: (size * 0.26) / 2
            }
          ]}
        >
          <Text style={[styles.badgeText, { fontSize: size * 0.16 }]}>
            {config.badgeLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden"
  },
  circle: {
    justifyContent: "center",
    alignItems: "center"
  },
  labelText: {
    fontWeight: "900",
    textAlign: "center"
  },
  badge: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "#111111",
    justifyContent: "center",
    alignItems: "center"
  },
  badgeText: {
    color: "#FFFFFF",
    fontWeight: "bold"
  }
});
